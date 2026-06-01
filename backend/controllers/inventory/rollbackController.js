import asyncHandler from '../../middleware/asyncHandler.js';
import pool from '../../config/pg.js';
import Product from '../../models/productModel.js';

const toNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const toBarcodeArray = (value) => {
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  return value ? [String(value)] : [];
};

const getActor = (user = {}) =>
  user.username || user.name || user.first_name || user.email || 'SYSTEM';

const getRequestedItems = (body = {}) =>
  Array.isArray(body.items) ? body.items : [];

const findRequestedItem = (row, requestedItems = []) =>
  requestedItems.find((item) => {
    const requestedInventoryId = item.inventory_product_id ?? item.inventoryProductId;
    const requestedDispatchItemId = item.dispatch_order_item_id ?? item.dispatchOrderItemId;
    const requestedBarcodeId = item.product_barcode_id ?? item.productBarcodeId;
    const requestedMkBarcode = item.mk_barcode || item.barcode;

  return (
      (requestedInventoryId &&
        Number(requestedInventoryId) === Number(row.inventory_product_id || row.id)) ||
      (requestedDispatchItemId && Number(requestedDispatchItemId) === Number(row.id)) ||
      (requestedBarcodeId && Number(requestedBarcodeId) === Number(row.product_barcode_id)) ||
      (requestedMkBarcode &&
        String(requestedMkBarcode) === String(row.mk_barcode || row.barcode || row.bar_code || ''))
    );
  });

const getRequestedUnits = (row, requestedItems, fallbackUnits) => {
  if (!requestedItems.length) return fallbackUnits;

  const requestedItem = findRequestedItem(row, requestedItems);
  if (!requestedItem) return 0;

  return toNumber(
    requestedItem.no_of_units ??
      requestedItem.qty ??
      requestedItem.quantity ??
      requestedItem.rollback_units ??
      requestedItem.rollbackQty
  );
};

const findFinancialByMkBarcode = async (mkBarcode, catalogProductBarcodeId = null) => {
  const barcodes = toBarcodeArray(mkBarcode);
  if (!barcodes.length && !catalogProductBarcodeId) return null;

  const product =
    (catalogProductBarcodeId
      ? await Product.findOne({
          'details.financials.catalogProductBarcodeId': Number(catalogProductBarcodeId),
        })
      : null) ||
    (barcodes.length
      ? await Product.findOne({ 'details.financials.mk_barcode': { $in: barcodes } })
      : null);

  if (!product) return null;

  for (const detail of product.details || []) {
    const financial = (detail.financials || []).find(
      (item) =>
        Number(item.catalogProductBarcodeId) === Number(catalogProductBarcodeId) ||
        barcodes.includes(String(item.mk_barcode || ''))
    );

    if (financial) return { product, detail, financial };
  }

  return null;
};

const getPurchaseInventoryRows = async (client, purchaseOrderId) => {
  const { rows } = await client.query(
    `
    SELECT
      ip.*,
      COALESCE(poi.no_of_units, ip.no_of_units, 0) AS rollback_units,
      COALESCE(poi.qty, ip.purchase_qty, 0) AS rollback_purchase_qty,
      pb.product_id AS catalog_product_id,
      pb.mk_barcode,
      COALESCE(pb.barcode, pb.mk_barcode) AS barcode
    FROM inventory.inventory_products ip
    LEFT JOIN purchases.purchase_order_items poi
      ON poi.id = ip.purchase_order_item_id
    LEFT JOIN catalog.product_barcodes pb
      ON pb.id = ip.product_barcode_id
    WHERE ip.purchase_order_id = $1
      AND COALESCE(ip.is_active, true) = true
    FOR UPDATE OF ip
    `,
    [Number(purchaseOrderId)]
  );

  return rows;
};

const assertPurchaseStockNotDispatched = async (client, rows) => {
  const inventoryIds = rows.map((row) => Number(row.id)).filter(Boolean);
  if (!inventoryIds.length) return;

  const dispatchResult = await client.query(
    `
    SELECT
      d.dispatch_no,
      d.dispatch_status,
      doi.inventory_product_id,
      doi.no_of_units
    FROM dispatch.dispatch_order_items doi
    JOIN dispatch.dispatch_order d
      ON d.id = doi.dispatch_order_id
    WHERE doi.inventory_product_id = ANY($1::bigint[])
      AND d.dispatch_status NOT IN ('draft', 'cancelled')
    LIMIT 1
    `,
    [inventoryIds]
  );

  if (dispatchResult.rowCount > 0) {
    const row = dispatchResult.rows[0];
    throw new Error(
      `Purchase cannot be rolled back. Stock is already linked to dispatch ${row.dispatch_no || ''} (${row.dispatch_status}).`
    );
  }
};

export const rollbackPurchaseInventory = asyncHandler(async (req, res) => {
  const purchaseOrderId = Number(req.params.id || req.body.purchase_order_id);
  const reason = req.body?.reason || 'Purchase rollback';
  const requestedItems = getRequestedItems(req.body);

  if (!purchaseOrderId) {
    res.status(400);
    throw new Error('Purchase order id is required');
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const purchaseResult = await client.query(
      `
      SELECT *
      FROM purchases.purchase_order
      WHERE id = $1
      FOR UPDATE
      `,
      [purchaseOrderId]
    );

    const purchaseOrder = purchaseResult.rows[0];
    if (!purchaseOrder) {
      res.status(404);
      throw new Error('Purchase order not found');
    }

    const inventoryRows = await getPurchaseInventoryRows(client, purchaseOrderId);
    if (!inventoryRows.length) {
      res.status(400);
      throw new Error('No inventory stock found for this purchase order');
    }

    const rollbackRows = requestedItems.length
      ? inventoryRows.filter((row) => findRequestedItem(row, requestedItems))
      : inventoryRows;

    if (!rollbackRows.length) {
      res.status(400);
      throw new Error('No matching purchase products selected for rollback');
    }

    await assertPurchaseStockNotDispatched(client, rollbackRows);

    const rolledBackItems = [];

    for (const row of rollbackRows) {
      const fullRollbackUnits = toNumber(row.rollback_units || row.no_of_units);
      const rollbackUnits = getRequestedUnits(row, requestedItems, fullRollbackUnits);
      const rollbackPurchaseQty =
        fullRollbackUnits > 0
          ? toNumber(row.rollback_purchase_qty || row.purchase_qty) *
            (rollbackUnits / fullRollbackUnits)
          : 0;
      const currentUnits = toNumber(row.no_of_units);
      const currentStock = toNumber(row.count_in_stock);

      if (rollbackUnits <= 0) continue;
      if (currentUnits < rollbackUnits || currentStock < rollbackUnits) {
        throw new Error(
          `${row.product_name || row.mk_barcode || row.id} has only ${currentStock} stock, cannot rollback ${rollbackUnits}.`
        );
      }

      const updatedResult = await client.query(
        `
        UPDATE inventory.inventory_products
        SET
          no_of_units = GREATEST(COALESCE(no_of_units, 0) - $1, 0),
          count_in_stock = GREATEST(COALESCE(count_in_stock, 0) - $1, 0),
          purchase_qty = GREATEST(COALESCE(purchase_qty, 0) - $2, 0),
          is_active = CASE
            WHEN GREATEST(COALESCE(no_of_units, 0) - $1, 0) = 0
             AND GREATEST(COALESCE(count_in_stock, 0) - $1, 0) = 0
            THEN false
            ELSE COALESCE(is_active, true)
          END,
          remarks = CONCAT_WS(' | ', NULLIF(remarks, ''), $3),
          updated_at = NOW()
        WHERE id = $4
        RETURNING *
        `,
        [rollbackUnits, rollbackPurchaseQty, reason, Number(row.id)]
      );

      const updated = updatedResult.rows[0];

      await client.query(
        `
        INSERT INTO inventory.stock_transaction (
          product_id,
          source,
          destination,
          ref_type,
          qty_in,
          qty_out,
          balance_qty
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        `,
        [
          Number(row.catalog_product_id || row.product_id),
          `WAREHOUSE:${row.warehouse_id || purchaseOrder.warehouse_id}`,
          `ROLLBACK:PURCHASE_ORDER:${purchaseOrderId}`,
          'ROLLBACK_PURCHASE',
          0,
          rollbackUnits,
          toNumber(updated.count_in_stock),
        ]
      );

      rolledBackItems.push({
        inventory_product_id: row.id,
        mk_barcode: row.mk_barcode || row.bar_code || row.barcode,
        removed_units: rollbackUnits,
        balance_qty: updated.count_in_stock,
      });
    }

    const remainingResult = await client.query(
      `
      SELECT COALESCE(SUM(count_in_stock), 0) AS remaining_stock
      FROM inventory.inventory_products
      WHERE purchase_order_id = $1
        AND COALESCE(is_active, true) = true
      `,
      [purchaseOrderId]
    );
    const fullyRolledBack = toNumber(remainingResult.rows[0]?.remaining_stock) <= 0;

    const updatedPoResult = await client.query(
      `
      UPDATE purchases.purchase_order
      SET
        status = CASE WHEN $3::boolean THEN 'rolled_back' ELSE status END,
        remarks = CONCAT_WS(' | ', NULLIF(remarks, ''), $2),
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [purchaseOrderId, reason, fullyRolledBack]
    );

    await client.query('COMMIT');

    res.json({
      message: 'Purchase inventory rolled back successfully',
      purchaseOrder: updatedPoResult.rows[0],
      rolledBackItems,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});

export const rollbackDispatch = asyncHandler(async (req, res) => {
  const dispatchOrderId = Number(req.params.id || req.body.dispatch_order_id);
  const stakeholderType = String(req.body?.stakeholder_type || '').trim().toLowerCase();
  const reason = req.body?.reason || 'Dispatch rollback';
  const requestedItems = getRequestedItems(req.body);

  if (!dispatchOrderId) {
    res.status(400);
    throw new Error('Dispatch order id is required');
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const orderResult = await client.query(
      `
      SELECT *
      FROM dispatch.dispatch_order
      WHERE id = $1
      FOR UPDATE
      `,
      [dispatchOrderId]
    );

    const order = orderResult.rows[0];
    if (!order) {
      res.status(404);
      throw new Error('Dispatch order not found');
    }

    const status = String(order.dispatch_status || '').toLowerCase();
    if (!['dispatched', 'received_to_outlet', 'received_by_stakeholder'].includes(status)) {
      res.status(400);
      throw new Error('Only dispatched or received dispatch orders can be rolled back');
    }

    const destinationType = String(order.destination || '').split(':')[0].toLowerCase();
    if (stakeholderType && stakeholderType !== destinationType) {
      res.status(400);
      throw new Error(`Selected stakeholder type ${stakeholderType} does not match ${destinationType || 'destination'}`);
    }

    const itemsResult = await client.query(
      `
      SELECT
        doi.*,
        pb.product_id AS catalog_product_id,
        pb.mk_barcode,
        COALESCE(pb.barcode, pb.mk_barcode) AS barcode
      FROM dispatch.dispatch_order_items doi
      JOIN catalog.product_barcodes pb
        ON pb.id = doi.product_barcode_id
      WHERE doi.dispatch_order_id = $1
      `,
      [dispatchOrderId]
    );

    if (!itemsResult.rows.length) {
      res.status(400);
      throw new Error('No dispatch items found');
    }

    const dispatchItems = requestedItems.length
      ? itemsResult.rows.filter((row) => findRequestedItem(row, requestedItems))
      : itemsResult.rows;

    if (!dispatchItems.length) {
      res.status(400);
      throw new Error('No matching dispatch products selected for rollback');
    }

    const rolledBackItems = [];

    for (const item of dispatchItems) {
      const remainingDispatchUnits = toNumber(item.no_of_units || item.qty);
      const rollbackUnits = getRequestedUnits(item, requestedItems, remainingDispatchUnits);
      if (rollbackUnits <= 0) continue;
      if (rollbackUnits > remainingDispatchUnits) {
        throw new Error(
          `${item.mk_barcode || item.barcode || item.id} has only ${remainingDispatchUnits} dispatch quantity available to rollback.`
        );
      }

      const inventoryResult = await client.query(
        `
        SELECT *
        FROM inventory.inventory_products
        WHERE id = $1
        FOR UPDATE
        `,
        [Number(item.inventory_product_id)]
      );

      const inventory = inventoryResult.rows[0];
      if (!inventory) {
        throw new Error(`Inventory product not found for dispatch item ${item.id}`);
      }

      const updatedInventoryResult = await client.query(
        `
        UPDATE inventory.inventory_products
        SET
          no_of_units = COALESCE(no_of_units, 0) + $1,
          count_in_stock = COALESCE(count_in_stock, 0) + $1,
          is_active = true,
          remarks = CONCAT_WS(' | ', NULLIF(remarks, ''), $2),
          updated_at = NOW()
        WHERE id = $3
        RETURNING *
        `,
        [rollbackUnits, reason, Number(inventory.id)]
      );

      const updatedInventory = updatedInventoryResult.rows[0];

      if (status === 'received_to_outlet' || destinationType === 'outlet') {
        const match = await findFinancialByMkBarcode(
          item.mk_barcode || item.barcode,
          item.product_barcode_id
        );

        if (!match) {
          throw new Error(`Mongo product not found for mk_barcode ${item.mk_barcode || item.barcode}`);
        }

        const currentStock = toNumber(match.financial.countInStock);
        if (currentStock < rollbackUnits) {
          throw new Error(
            `Mongo stock for mk_barcode ${item.mk_barcode || item.barcode} is ${currentStock}, cannot remove ${rollbackUnits}.`
          );
        }

        match.financial.countInStock = currentStock - rollbackUnits;
        await match.product.save();
      }

      await client.query(
        `
        UPDATE dispatch.dispatch_order_items
        SET
          no_of_units = GREATEST(COALESCE(no_of_units, 0) - $1, 0),
          qty = GREATEST(COALESCE(qty, 0) - $1, 0),
          notes = CONCAT_WS(' | ', NULLIF(notes, ''), $2),
          updated_at = NOW()
        WHERE id = $3
        `,
        [rollbackUnits, reason, Number(item.id)]
      );

      await client.query(
        `
        INSERT INTO inventory.stock_transaction (
          product_id,
          source,
          destination,
          ref_type,
          qty_in,
          qty_out,
          balance_qty
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        `,
        [
          Number(item.catalog_product_id || item.product_id),
          `ROLLBACK:DISPATCH_ORDER:${dispatchOrderId}`,
          order.source || 'INVENTORY',
          'ROLLBACK_DISPATCH',
          rollbackUnits,
          0,
          toNumber(updatedInventory.count_in_stock),
        ]
      );

      rolledBackItems.push({
        inventory_product_id: inventory.id,
        mk_barcode: item.mk_barcode || item.barcode,
        restored_units: rollbackUnits,
        balance_qty: updatedInventory.count_in_stock,
      });
    }

    const remainingDispatchResult = await client.query(
      `
      SELECT COALESCE(SUM(no_of_units), 0) AS remaining_units
      FROM dispatch.dispatch_order_items
      WHERE dispatch_order_id = $1
      `,
      [dispatchOrderId]
    );
    const fullyRolledBack = toNumber(remainingDispatchResult.rows[0]?.remaining_units) <= 0;

    await client.query(
      `
      UPDATE inventory.transit_products
      SET
        transit_status = CASE WHEN $2::boolean THEN 'cancelled' ELSE transit_status END,
        updated_at = NOW()
      WHERE dispatch_order_id = $1
      `,
      [dispatchOrderId, fullyRolledBack]
    );

    const updatedOrderResult = await client.query(
      `
      UPDATE dispatch.dispatch_order
      SET
        dispatch_status = CASE WHEN $3::boolean THEN 'cancelled' ELSE dispatch_status END,
        dispatch_notes = CONCAT_WS(' | ', NULLIF(dispatch_notes, ''), $2),
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [dispatchOrderId, `${reason} by ${getActor(req.user || {})}`, fullyRolledBack]
    );

    await client.query('COMMIT');

    res.json({
      message: 'Dispatch rolled back successfully',
      order: updatedOrderResult.rows[0],
      rolledBackItems,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});
