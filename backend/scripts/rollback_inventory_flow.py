#!/usr/bin/env python3
"""
Rollback helper for purchase verification, warehouse dispatch, and outlet receive.

Default mode is a dry run. Add --apply to commit changes.

Examples:
  python backend/backend/scripts/rollback_inventory_flow.py --purchase-order-id 12
  python backend/backend/scripts/rollback_inventory_flow.py --dispatch-order-id 44 --rollback-outlet-receive
  python backend/backend/scripts/rollback_inventory_flow.py --dispatch-order-id 44 --rollback-outlet-receive --rollback-dispatch --apply
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[3]
ENV_FILES = [
    ROOT / ".env",
    ROOT / "backend" / ".env",
    ROOT / "backend" / "backend" / ".env",
]


def load_env() -> None:
    for env_file in ENV_FILES:
        if not env_file.exists():
            continue
        for line in env_file.read_text(encoding="utf-8").splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or "=" not in stripped:
                continue
            key, value = stripped.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            os.environ.setdefault(key, value)


def require_modules():
    try:
        import psycopg2
        import psycopg2.extras
    except ImportError as exc:
        raise SystemExit(
            "Missing dependency: psycopg2. Install it with "
            "`python -m pip install psycopg2-binary`."
        ) from exc

    return psycopg2, psycopg2.extras


def optional_pymongo():
    try:
        import pymongo
    except ImportError as exc:
        raise SystemExit(
            "Missing dependency: pymongo. Install it with "
            "`python -m pip install pymongo` to rollback outlet Mongo stock."
        ) from exc
    return pymongo


def connect_pg():
    load_env()
    connection_string = os.environ.get("PG_CONNECTION_STRING")
    if not connection_string:
        raise SystemExit("PG_CONNECTION_STRING was not found in environment or .env files.")

    psycopg2, extras = require_modules()
    conn = psycopg2.connect(connection_string, cursor_factory=extras.RealDictCursor)
    conn.autocommit = False
    return conn


def one(cur, sql: str, params: tuple[Any, ...] = ()) -> dict[str, Any] | None:
    cur.execute(sql, params)
    row = cur.fetchone()
    return dict(row) if row else None


def many(cur, sql: str, params: tuple[Any, ...] = ()) -> list[dict[str, Any]]:
    cur.execute(sql, params)
    return [dict(row) for row in cur.fetchall()]


def table_exists(cur, table_name: str) -> bool:
    return bool(one(cur, "SELECT to_regclass(%s) AS name", (table_name,))["name"])


def parse_location_id(value: str | None, expected: str) -> int | None:
    match = re.match(rf"^{re.escape(expected)}:(\d+)$", str(value or ""), re.I)
    return int(match.group(1)) if match else None


def as_float(value: Any) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0


def print_json(payload: dict[str, Any]) -> None:
    print(json.dumps(payload, indent=2, default=str))


def rollback_purchase(cur, purchase_order_id: int, reason: str, target_status: str) -> dict[str, Any]:
    po = one(
        cur,
        """
        SELECT *
        FROM purchases.purchase_order
        WHERE id = %s
        FOR UPDATE
        """,
        (purchase_order_id,),
    )
    if not po:
        raise ValueError(f"Purchase order {purchase_order_id} was not found.")

    inventory_rows = many(
        cur,
        """
        SELECT
          ip.*,
          pb.product_id AS catalog_product_id,
          COALESCE(st.verified_units, 0) AS verified_units
        FROM inventory.inventory_products ip
        LEFT JOIN catalog.product_barcodes pb ON pb.id = ip.product_barcode_id
        LEFT JOIN LATERAL (
          SELECT SUM(qty_in) AS verified_units
          FROM inventory.stock_transaction st
          WHERE st.ref_type = 'PURCHASE_VERIFIED'
            AND st.source = %s
            AND st.destination = ('WAREHOUSE:' || ip.warehouse_id::text)
            AND st.product_id = pb.product_id
        ) st ON TRUE
        WHERE ip.purchase_order_id = %s
        ORDER BY ip.id
        FOR UPDATE OF ip
        """,
        (f"PURCHASE_ORDER:{purchase_order_id}", purchase_order_id),
    )

    if not inventory_rows:
        return {
            "purchase_order_id": purchase_order_id,
            "message": "No inventory rows linked to this purchase order.",
            "changed": [],
        }

    changed = []
    for row in inventory_rows:
        rollback_qty = as_float(row["verified_units"]) or as_float(row["no_of_units"])
        if rollback_qty <= 0:
            continue

        before_units = as_float(row["no_of_units"])
        before_stock = as_float(row["count_in_stock"])
        if before_units < rollback_qty or before_stock < rollback_qty:
            raise ValueError(
                f"Inventory product {row['id']} cannot rollback {rollback_qty}; "
                f"current stock is {before_stock}."
            )

        updated = one(
            cur,
            """
            UPDATE inventory.inventory_products
            SET
              no_of_units = COALESCE(no_of_units, 0) - %s,
              count_in_stock = COALESCE(count_in_stock, 0) - %s,
              purchase_qty = GREATEST(COALESCE(purchase_qty, 0) - %s, 0),
              remarks = COALESCE(%s, remarks),
              updated_at = NOW()
            WHERE id = %s
            RETURNING *
            """,
            (rollback_qty, rollback_qty, rollback_qty, reason, row["id"]),
        )

        tx = one(
            cur,
            """
            INSERT INTO inventory.stock_transaction (
              product_id, source, destination, ref_type, qty_in, qty_out, balance_qty
            )
            VALUES (%s, %s, %s, 'PURCHASE_VERIFY_ROLLBACK', 0, %s, %s)
            RETURNING *
            """,
            (
                row["catalog_product_id"],
                f"WAREHOUSE:{row['warehouse_id']}",
                f"ROLLBACK:PURCHASE_ORDER:{purchase_order_id}",
                rollback_qty,
                updated["count_in_stock"],
            ),
        )

        changed.append(
            {
                "inventory_product_id": row["id"],
                "product_barcode_id": row["product_barcode_id"],
                "stock_before": before_stock,
                "stock_after": updated["count_in_stock"],
                "rollback_qty": rollback_qty,
                "rollback_transaction_id": tx["id"],
            }
        )

    updated_po = one(
        cur,
        """
        UPDATE purchases.purchase_order
        SET status = %s, remarks = COALESCE(%s, remarks), updated_at = NOW()
        WHERE id = %s
        RETURNING id, po_number, status
        """,
        (target_status, reason, purchase_order_id),
    )

    mark_inventory_migration_requests_rolled_back(cur, purchase_order_id, reason)

    return {
        "purchase_order": updated_po,
        "changed": changed,
    }


def mark_inventory_migration_requests_rolled_back(cur, purchase_order_id: int, reason: str) -> None:
    if not table_exists(cur, "request_tracking.requests"):
        return
    cur.execute(
        """
        UPDATE request_tracking.requests
        SET
          status = 'cancelled',
          current_step_code = 'rollback',
          last_error_message = COALESCE(%s, last_error_message),
          updated_at = NOW(),
          completed_at = COALESCE(completed_at, NOW())
        WHERE request_type = 'inventory_migration'
          AND payload->>'purchase_order_id' = %s
          AND status = 'completed'
        """,
        (reason or "Purchase verification rolled back", str(purchase_order_id)),
    )


def dispatch_items(cur, dispatch_order_id: int) -> list[dict[str, Any]]:
    return many(
        cur,
        """
        SELECT
          doi.*,
          pb.product_id AS catalog_product_id,
          pb.mk_barcode,
          COALESCE(pb.barcode, pb.mk_barcode) AS barcode
        FROM dispatch.dispatch_order_items doi
        JOIN catalog.product_barcodes pb ON pb.id = doi.product_barcode_id
        WHERE doi.dispatch_order_id = %s
        ORDER BY doi.id
        """,
        (dispatch_order_id,),
    )


def get_dispatch(cur, dispatch_order_id: int) -> dict[str, Any]:
    order = one(
        cur,
        """
        SELECT *
        FROM dispatch.dispatch_order
        WHERE id = %s
        FOR UPDATE
        """,
        (dispatch_order_id,),
    )
    if not order:
        raise ValueError(f"Dispatch order {dispatch_order_id} was not found.")
    return order


def rollback_dispatch(cur, dispatch_order_id: int, reason: str, target_status: str) -> dict[str, Any]:
    order = get_dispatch(cur, dispatch_order_id)
    if order["dispatch_status"] not in ("dispatched", "received_by_stakeholder"):
        raise ValueError(
            f"Dispatch {dispatch_order_id} is {order['dispatch_status']}; "
            "rollback outlet receive first, then rollback the warehouse dispatch."
        )

    changed = []
    for item in dispatch_items(cur, dispatch_order_id):
        qty = as_float(item["no_of_units"] if item["no_of_units"] is not None else item["qty"])
        if qty <= 0:
            continue

        if item["inventory_product_id"]:
            inventory = one(
                cur,
                """
                SELECT *
                FROM inventory.inventory_products
                WHERE id = %s
                FOR UPDATE
                """,
                (item["inventory_product_id"],),
            )
        else:
            inventory = one(
                cur,
                """
                SELECT *
                FROM inventory.inventory_products
                WHERE product_barcode_id = %s
                  AND exp_date::date = %s::date
                  AND COALESCE(is_active, true) = true
                ORDER BY updated_at DESC, id DESC
                LIMIT 1
                FOR UPDATE
                """,
                (item["product_barcode_id"], item["exp_date"]),
            )

        if not inventory:
            raise ValueError(f"Inventory row not found for dispatch item {item['id']}.")

        before_stock = as_float(inventory["count_in_stock"])
        updated = one(
            cur,
            """
            UPDATE inventory.inventory_products
            SET
              no_of_units = COALESCE(no_of_units, 0) + %s,
              count_in_stock = COALESCE(count_in_stock, 0) + %s,
              remarks = COALESCE(%s, remarks),
              updated_at = NOW()
            WHERE id = %s
            RETURNING *
            """,
            (qty, qty, reason, inventory["id"]),
        )

        tx = one(
            cur,
            """
            INSERT INTO inventory.stock_transaction (
              product_id, source, destination, ref_type, qty_in, qty_out, balance_qty
            )
            VALUES (%s, %s, %s, 'INVENTORY_DISPATCH_ROLLBACK', %s, 0, %s)
            RETURNING *
            """,
            (
                item["catalog_product_id"],
                order["destination"] or "DISPATCH",
                order["source"] or "INVENTORY",
                qty,
                updated["count_in_stock"],
            ),
        )

        changed.append(
            {
                "dispatch_item_id": item["id"],
                "inventory_product_id": inventory["id"],
                "stock_before": before_stock,
                "stock_after": updated["count_in_stock"],
                "rollback_qty": qty,
                "rollback_transaction_id": tx["id"],
            }
        )

    cur.execute(
        """
        UPDATE inventory.transit_products
        SET transit_status = 'cancelled', updated_at = NOW()
        WHERE dispatch_order_id = %s
        """,
        (dispatch_order_id,),
    )

    updated_order = one(
        cur,
        """
        UPDATE dispatch.dispatch_order
        SET dispatch_status = %s, dispatch_notes = COALESCE(%s, dispatch_notes), updated_at = NOW()
        WHERE id = %s
        RETURNING id, dispatch_no, dispatch_status
        """,
        (target_status, reason, dispatch_order_id),
    )

    mark_dispatch_request(cur, dispatch_order_id, "cancelled", reason)

    return {
        "dispatch_order": updated_order,
        "changed": changed,
    }


def rollback_outlet_receive(
    cur,
    dispatch_order_id: int,
    reason: str,
    mongo_uri: str | None,
    allow_negative: bool,
    apply: bool,
) -> dict[str, Any]:
    order = get_dispatch(cur, dispatch_order_id)
    if order["dispatch_status"] != "received_to_outlet":
        raise ValueError(
            f"Dispatch {dispatch_order_id} is {order['dispatch_status']}; "
            "only received_to_outlet can rollback outlet receive."
        )

    outlet_id = parse_location_id(order["destination"], "outlet")
    if not outlet_id:
        raise ValueError(f"Dispatch destination is not outlet:<id>: {order['destination']}")

    uri = mongo_uri or os.environ.get("OUTLET_MONGO_URI") or os.environ.get("MONGO_URI")
    if not uri:
        raise ValueError("Mongo URI missing. Set OUTLET_MONGO_URI or MONGO_URI.")

    pymongo = optional_pymongo()
    client = pymongo.MongoClient(uri)
    db = client.get_default_database()
    products = db.get_collection("products")

    changed = []
    for item in dispatch_items(cur, dispatch_order_id):
        qty = as_float(item["no_of_units"] if item["no_of_units"] is not None else item["qty"])
        barcode_id = int(item["product_barcode_id"])
        if qty <= 0:
            continue

        product = products.find_one(
            {
                "$or": [
                    {"catalogProductId": int(item["catalog_product_id"])},
                    {"details.financials.catalogProductBarcodeId": barcode_id},
                    {"details.financials.mkid": barcode_id},
                    {"details.financials.barcode": {"$in": [str(item["mk_barcode"]), str(item["barcode"])]}},
                ]
            }
        )
        if not product:
            raise ValueError(f"Outlet Mongo product not found for barcode {barcode_id}.")

        updated = False
        for detail in product.get("details", []):
            for financial in detail.get("financials", []):
                matches = (
                    financial.get("catalogProductBarcodeId") == barcode_id
                    or financial.get("mkid") == barcode_id
                    or str(item["mk_barcode"]) in [str(v) for v in financial.get("barcode", [])]
                    or str(item["barcode"]) in [str(v) for v in financial.get("barcode", [])]
                )
                if not matches:
                    continue

                before = as_float(financial.get("countInStock"))
                after = before - qty
                if after < 0 and not allow_negative:
                    raise ValueError(
                        f"Outlet stock for barcode {barcode_id} would become {after}. "
                        "Use --allow-negative only if you are sure."
                    )
                financial["countInStock"] = after
                updated = True
                changed.append(
                    {
                        "dispatch_item_id": item["id"],
                        "product_barcode_id": barcode_id,
                        "outlet_stock_before": before,
                        "outlet_stock_after": after,
                        "rollback_qty": qty,
                    }
                )
                break
            if updated:
                break

        if not updated:
            raise ValueError(f"Outlet financial row not found for barcode {barcode_id}.")

        if apply:
            products.replace_one({"_id": product["_id"]}, product)

    cur.execute(
        """
        UPDATE inventory.transit_products
        SET transit_status = 'intransit', updated_at = NOW()
        WHERE dispatch_order_id = %s
        """,
        (dispatch_order_id,),
    )
    updated_order = one(
        cur,
        """
        UPDATE dispatch.dispatch_order
        SET dispatch_status = 'dispatched', dispatch_notes = COALESCE(%s, dispatch_notes), updated_at = NOW()
        WHERE id = %s
        RETURNING id, dispatch_no, dispatch_status
        """,
        (reason, dispatch_order_id),
    )

    mark_dispatch_request(cur, dispatch_order_id, "pending", reason)

    return {
        "dispatch_order": updated_order,
        "outlet_id": outlet_id,
        "changed": changed,
    }


def mark_dispatch_request(cur, dispatch_order_id: int, status: str, reason: str) -> None:
    if not table_exists(cur, "request_tracking.requests"):
        return
    cur.execute(
        """
        UPDATE request_tracking.requests
        SET
          status = %s,
          current_step_code = 'outlet_receive',
          last_error_message = COALESCE(%s, last_error_message),
          completed_at = CASE WHEN %s = 'completed' THEN NOW() ELSE completed_at END,
          updated_at = NOW()
        WHERE request_type = 'inventory_dispatch_to_outlet'
          AND reference_type = 'dispatch_order'
          AND reference_id = %s
        """,
        (status, reason, status, str(dispatch_order_id)),
    )
    cur.execute(
        """
        UPDATE request_tracking.request_steps s
        SET status = %s, updated_at = NOW()
        FROM request_tracking.requests r
        WHERE s.request_id = r.id
          AND r.request_type = 'inventory_dispatch_to_outlet'
          AND r.reference_id = %s
          AND s.step_code = 'outlet_receive'
        """,
        (status, str(dispatch_order_id)),
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Preview or apply rollback for purchase verification, dispatch, and outlet receive."
    )
    parser.add_argument("--purchase-order-id", type=int, help="Purchase order id to rollback from verified inventory.")
    parser.add_argument("--purchase-target-status", default="received", help="Purchase status after rollback.")
    parser.add_argument("--dispatch-order-id", type=int, help="Dispatch order id to rollback.")
    parser.add_argument("--rollback-outlet-receive", action="store_true", help="Undo outlet Mongo stock receive and set dispatch back to dispatched.")
    parser.add_argument("--rollback-dispatch", action="store_true", help="Undo warehouse dispatch out and set dispatch to target status.")
    parser.add_argument("--dispatch-target-status", default="packed", help="Dispatch status after rollback-dispatch.")
    parser.add_argument("--mongo-uri", help="Outlet Mongo URI. Defaults to OUTLET_MONGO_URI or MONGO_URI.")
    parser.add_argument("--allow-negative", action="store_true", help="Allow outlet rollback to make Mongo stock negative.")
    parser.add_argument("--reason", default="Manual rollback", help="Reason saved to remarks/notes where supported.")
    parser.add_argument("--apply", action="store_true", help="Actually commit. Without this, all Postgres changes are rolled back.")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    if not args.purchase_order_id and not args.dispatch_order_id:
        raise SystemExit("Pass --purchase-order-id and/or --dispatch-order-id.")

    if args.dispatch_order_id and not (args.rollback_outlet_receive or args.rollback_dispatch):
        raise SystemExit("For dispatch rollback, pass --rollback-outlet-receive and/or --rollback-dispatch.")

    conn = connect_pg()
    summary: dict[str, Any] = {"mode": "apply" if args.apply else "dry_run", "operations": []}

    try:
        with conn.cursor() as cur:
            if args.purchase_order_id:
                summary["operations"].append(
                    {
                        "operation": "rollback_purchase",
                        "result": rollback_purchase(
                            cur,
                            args.purchase_order_id,
                            args.reason,
                            args.purchase_target_status,
                        ),
                    }
                )

            if args.dispatch_order_id and args.rollback_outlet_receive:
                summary["operations"].append(
                    {
                        "operation": "rollback_outlet_receive",
                        "result": rollback_outlet_receive(
                            cur,
                            args.dispatch_order_id,
                            args.reason,
                            args.mongo_uri,
                            args.allow_negative,
                            args.apply,
                        ),
                    }
                )

            if args.dispatch_order_id and args.rollback_dispatch:
                summary["operations"].append(
                    {
                        "operation": "rollback_dispatch",
                        "result": rollback_dispatch(
                            cur,
                            args.dispatch_order_id,
                            args.reason,
                            args.dispatch_target_status,
                        ),
                    }
                )

        if args.apply:
            conn.commit()
            summary["committed"] = True
        else:
            conn.rollback()
            summary["committed"] = False
            summary["note"] = "Dry run only. Re-run with --apply to commit."

        print_json(summary)
        return 0
    except Exception as exc:
        conn.rollback()
        print_json({"error": str(exc), "committed": False})
        return 1
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
