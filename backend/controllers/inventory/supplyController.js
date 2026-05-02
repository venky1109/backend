import { getClient, query } from '../../config/pg.js';
import { PurchaseOrder, PurchaseOrderItem } from '../../models/inventory/purchaseModels.js';
import { DispatchOrder, DispatchOrderItem } from '../../models/inventory/dispatchModels.js';

export const getSupplierProducts = async (req, res, next) => {
  try {
    const supplierId = req.params.supplierId;
    const { rows } = await query(
      `SELECT ip.*, b.brand_name_english, c.category_name_english
       FROM inventory.inventory_products ip
       LEFT JOIN catalog.brands b ON b.id = ip.brand_id
       LEFT JOIN catalog.categories c ON c.id = ip.category_id
       WHERE ip.stakeholders_id = $1
       ORDER BY ip.product_name`,
      [supplierId]
    );
    res.json(rows);
  } catch (err) { next(err); }
};

// import { getClient } from '../../config/pg.js';
export const getPurchaseOrdersDetailed = async (req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT
        po.*,

        s.stakeholder_name AS supplier_name,
        s.stackholder_code AS supplier_code,
        s.phone AS supplier_phone,

        w.warehouse_name,
        w.warehouse_code,

        COALESCE(
          json_agg(
            json_build_object(
              'id', poi.id,
              'product_id', poi.product_id,
              'product_name', p.product_name_eng,
              'product_code', p.product_code,

              'category_id', poi.category_id,
              'category_name', c.category_name_english,

              'brand_id', poi.brand_id,
              'brand_name', b.brand_name_english,

              'unit_id', poi.unit_id,
              'unit_name', u.unit_name,
              'unit_short_code', u.unit_short_code,

              'qty', poi.qty,
              'expected_unit_price', poi.expected_unit_price,
              'actual_unit_price', poi.actual_unit_price,

              'effective_unit_price',
                COALESCE(poi.actual_unit_price, poi.expected_unit_price),

              'no_of_units', poi.no_of_units,
              'total_prod_price', poi.total_prod_price,

              /* ✅ ADD THIS */
              'mk_barcode', pb.mk_barcode,
              'barcode', pb.barcode

            )
          ) FILTER (WHERE poi.id IS NOT NULL),
          '[]'
        ) AS items

      FROM purchases.purchase_order po

      LEFT JOIN catalog.stakeholders s
        ON s.id = po.supplier_id

      LEFT JOIN catalog.warehouses w
        ON w.id = po.warehouse_id

      LEFT JOIN purchases.purchase_order_items poi
        ON poi.purchase_order_id = po.id

      LEFT JOIN catalog.products p
        ON p.id = poi.product_id

      LEFT JOIN catalog.categories c
        ON c.id = poi.category_id

      LEFT JOIN catalog.brands b
        ON b.id = poi.brand_id

      LEFT JOIN catalog.units u
        ON u.id = poi.unit_id

      /* ✅ IMPORTANT JOIN */
      LEFT JOIN catalog.product_barcodes pb
        ON pb.product_id = poi.product_id
       AND pb.brand_id = poi.brand_id
       AND pb.category_id = poi.category_id
       AND pb.unit_id = poi.unit_id
       AND pb.quantity::numeric = poi.qty::numeric
       AND pb.is_active = true

      GROUP BY
        po.id,
        s.stakeholder_name,
        s.stackholder_code,
        s.phone,
        w.warehouse_name,
        w.warehouse_code

      ORDER BY po.id DESC
    `);

    res.json(rows);
  } catch (error) {
    next(error);
  }
};
export const verifyReceivedPurchaseOrder = async (req, res, next) => {
  const client = await getClient();

  try {
    const { id } = req.params;
    const { items = [], remarks = null } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'Items are required' });
    }

    await client.query('BEGIN');

    const poResult = await client.query(
      `SELECT * FROM purchases.purchase_order WHERE id = $1`,
      [id]
    );

    const po = poResult.rows[0];

    if (!po) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Purchase order not found' });
    }

    if (po.status !== 'received') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        message: 'Only received purchase orders can be verified',
      });
    }

    for (const item of items) {
      await client.query(
        `
        UPDATE purchases.purchase_order_items
        SET actual_unit_price = $1,
            updated_at = NOW()
        WHERE id = $2
          AND purchase_order_id = $3
        `,
        [
          Number(item.actual_unit_price),
          Number(item.id),
          Number(id),
        ]
      );
    }

    const totalResult = await client.query(
      `
      SELECT COALESCE(SUM(total_prod_price), 0) AS total_amount
      FROM purchases.purchase_order_items
      WHERE purchase_order_id = $1
      `,
      [id]
    );

    const totalAmount = totalResult.rows[0].total_amount;

    const updatedPo = await client.query(
      `
      UPDATE purchases.purchase_order
      SET status = 'verified',
          total_amount = $1,
          remarks = COALESCE($2, remarks),
          updated_at = NOW()
      WHERE id = $3
      RETURNING *
      `,
      [totalAmount, remarks, id]
    );

    await client.query('COMMIT');

    res.json({
      message: 'Purchase order verified successfully',
      purchaseOrder: updatedPo.rows[0],
    });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
};

export const createPurchaseOrderWithItems = async (req, res, next) => {
  const client = await getClient();

  try {
    const {
      supplier_id,
      warehouse_id,
      expected_date = null,
      arrived_date = null,
      remarks = null,
      status = 'draft',
      bill_details = {},
      items = [],
    } = req.body;

    if (!supplier_id || !warehouse_id) {
      return res.status(400).json({
        message: 'supplier_id and warehouse_id are required',
      });
    }

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({
        message: 'At least one item is required',
      });
    }

    for (const item of items) {
      const expectedPrice = item.expected_unit_price ?? item.unit_price;

      if (
        !item.product_id ||
        !item.brand_id ||
         !item.category_id ||
        !item.unit_id ||
        !item.qty ||
        expectedPrice === undefined ||
        expectedPrice === null
      ) {
        return res.status(400).json({
          message:
            'Each item requires product_id, brand_id, unit_id, qty and expected_unit_price',
        });
      }
    }

    await client.query('BEGIN');

    const totalAmount = items.reduce((sum, item) => {
      const effectivePrice =
        item.actual_unit_price !== undefined && item.actual_unit_price !== null
          ? Number(item.actual_unit_price)
          : Number(item.expected_unit_price ?? item.unit_price ?? 0);

      return (
        sum +
        Number(item.qty || 0) *
          Number(item.no_of_units || 1) *
          effectivePrice
      );
    }, 0);

    const poNumber = `PO-${Date.now()}-${supplier_id}`;

    const finalBillDetails = {
      ...bill_details,
      items: items.map((item) => {
        const expectedPrice = Number(
          item.expected_unit_price ?? item.unit_price ?? 0
        );

        const actualPrice =
          item.actual_unit_price !== undefined && item.actual_unit_price !== null
            ? Number(item.actual_unit_price)
            : null;

        const effectivePrice = actualPrice ?? expectedPrice;

        return {
          product_id: Number(item.product_id),
          category_id:Number(item.category_id),
          brand_id: Number(item.brand_id),
          unit_id: Number(item.unit_id),
          qty: Number(item.qty),
          no_of_units: Number(item.no_of_units || 1),
          expected_unit_price: expectedPrice,
          actual_unit_price: actualPrice,
          total:
            Number(item.qty) *
            Number(item.no_of_units || 1) *
            effectivePrice,
        };
      }),
    };

    const poResult = await client.query(
      `
      INSERT INTO purchases.purchase_order
        (
          po_number,
          supplier_id,
          warehouse_id,
          expected_date,
          arrived_date,
          remarks,
          status,
          total_amount,
          bill_details
        )
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
      RETURNING *
      `,
      [
        poNumber,
        Number(supplier_id),
        Number(warehouse_id),
        expected_date,
        arrived_date,
        remarks,
        status,
        totalAmount,
        JSON.stringify(finalBillDetails),
      ]
    );

    const purchaseOrder = poResult.rows[0];
    const insertedItems = [];

    for (const item of items) {
      const itemResult = await client.query(
        `
        INSERT INTO purchases.purchase_order_items
          (
            purchase_order_id,
            product_id,
            category_id,
            brand_id,
            qty,
            no_of_units,
            unit_id,
            expected_unit_price,
            actual_unit_price
          )
        VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8,$9)
        RETURNING *
        `,
        [
          purchaseOrder.id,
          Number(item.product_id),
          Number(item.category_id),
          Number(item.brand_id),
          Number(item.qty),
          Number(item.no_of_units || 1),
          Number(item.unit_id),
          Number(item.expected_unit_price ?? item.unit_price ?? 0),
          item.actual_unit_price !== undefined && item.actual_unit_price !== null
            ? Number(item.actual_unit_price)
            : null,
        ]
      );

      insertedItems.push(itemResult.rows[0]);
    }

    await client.query('COMMIT');

    return res.status(201).json({
      message: 'Purchase order created successfully',
      purchaseOrder,
      items: insertedItems,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
};

export const receivePurchaseOrder = async (req, res, next) => {
  const client = await getClient();
  try {
    const { purchase_order_id, items = [], source = 'supplier', destination = 'warehouse' } = req.body;
    if (!purchase_order_id || !items.length) {
      return res.status(400).json({ message: 'purchase_order_id and items are required' });
    }

    await client.query('BEGIN');

    const movements = [];
    for (const item of items) {
      const qty = Number(item.qty_in || item.qty || 0);
      if (qty <= 0) throw new Error('qty must be greater than 0');

      await client.query(
        `UPDATE inventory.inventory_products
         SET count_in_stock = count_in_stock + $1, updated_at = NOW()
         WHERE id = $2`,
        [qty, item.product_id]
      );

      const stock = await client.query(
        `SELECT count_in_stock FROM inventory.inventory_products WHERE id = $1`,
        [item.product_id]
      );
      const balanceQty = stock.rows[0]?.count_in_stock || 0;

      const movement = await client.query(
        `INSERT INTO inventory.stock_transaction
         (product_id, source, destination, ref_type, qty_in, qty_out, balance_qty)
         VALUES ($1,$2,$3,$4,$5,0,$6) RETURNING *`,
        [item.product_id, source, destination, 'PURCHASE_RECEIVE', qty, balanceQty]
      );
      movements.push(movement.rows[0]);

      await client.query(
        `UPDATE purchases.purchase_order_items
         SET updated_at = NOW()
         WHERE purchase_order_id = $1 AND product_id = $2`,
        [purchase_order_id, item.product_id]
      );
    }

    await client.query(
      `UPDATE purchases.purchase_order SET status = 'received', updated_at = NOW() WHERE id = $1`,
      [purchase_order_id]
    );

    await client.query('COMMIT');
    res.json({ message: 'Stock received successfully', movements });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

export const createDispatchWithItems = async (req, res, next) => {
  const client = await getClient();
  try {
    const { items = [], ...dispatchBody } = req.body;
    if (!items.length) return res.status(400).json({ message: 'items are required' });

    await client.query('BEGIN');

    const d = await DispatchOrder.create(dispatchBody);
    const createdItems = [];
    for (const item of items) {
      const created = await DispatchOrderItem.create({ ...item, dispatch_order_id: d.id });
      createdItems.push(created);
    }

    await client.query('COMMIT');
    res.status(201).json({ ...d, items: createdItems });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};
export const updatePurchaseOrderItems = async (req, res, next) => {
  const client = await getClient();

  try {
    const { id } = req.params;
    const { items = [] } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ message: 'Items are required' });
    }

    await client.query('BEGIN');

    const poResult = await client.query(
      `SELECT * FROM purchases.purchase_order WHERE id = $1`,
      [id]
    );

    const po = poResult.rows[0];

    if (!po) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: 'Purchase order not found' });
    }

    if (String(po.status).toLowerCase() !== 'draft') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        message: 'Items can be edited only in draft status',
      });
    }

    for (const item of items) {
      const expectedPrice = item.expected_unit_price ?? item.unit_price;

      if (
        !item.product_id ||
        !item.brand_id ||
        !item.category_id||
        !item.unit_id ||
        !item.qty ||
        expectedPrice === undefined ||
        expectedPrice === null
      ) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          message:
            'Each item requires product_id, brand_id, unit_id, qty and expected_unit_price',
        });
      }
    }

    await client.query(
      `DELETE FROM purchases.purchase_order_items WHERE purchase_order_id = $1`,
      [id]
    );

    let totalAmount = 0;
    const insertedItems = [];

    for (const item of items) {
      const expectedPrice = Number(item.expected_unit_price ?? item.unit_price ?? 0);

      const actualPrice =
        item.actual_unit_price !== undefined && item.actual_unit_price !== null
          ? Number(item.actual_unit_price)
          : null;

      const effectivePrice = actualPrice ?? expectedPrice;

      const lineTotal =
        Number(item.qty || 0) *
        Number(item.no_of_units || 1) *
        effectivePrice;

      totalAmount += lineTotal;

      const itemResult = await client.query(
        `
        INSERT INTO purchases.purchase_order_items
          (
            purchase_order_id,
            product_id,
            category_id,
            brand_id,
            qty,
            no_of_units,
            unit_id,
            expected_unit_price,
            actual_unit_price
          )
        VALUES
          ($1, $2, $3, $4, $5, $6, $7, $8,$9)
        RETURNING *
        `,
        [
          Number(id),
          Number(item.product_id),
          Number(item.category_id),
          Number(item.brand_id),
          Number(item.qty),
          Number(item.no_of_units || 1),
          Number(item.unit_id),
          expectedPrice,
          actualPrice,
        ]
      );

      insertedItems.push(itemResult.rows[0]);
    }

    const finalBillDetails = {
      ...(po.bill_details || {}),
      items: insertedItems.map((item) => ({
        product_id: Number(item.product_id),
        category_id:Number(item.category_id),
        brand_id: Number(item.brand_id),
        unit_id: Number(item.unit_id),
        qty: Number(item.qty),
        no_of_units: Number(item.no_of_units || 1),
        expected_unit_price: Number(item.expected_unit_price || 0),
        actual_unit_price:
          item.actual_unit_price !== null && item.actual_unit_price !== undefined
            ? Number(item.actual_unit_price)
            : null,
        total:
          Number(item.qty || 0) *
          Number(item.no_of_units || 1) *
          Number(
            item.actual_unit_price !== null && item.actual_unit_price !== undefined
              ? item.actual_unit_price
              : item.expected_unit_price || 0
          ),
      })),
    };

    const updatedPoResult = await client.query(
      `
      UPDATE purchases.purchase_order
      SET total_amount = $1,
          bill_details = $2::jsonb,
          updated_at = NOW()
      WHERE id = $3
      RETURNING *
      `,
      [totalAmount, JSON.stringify(finalBillDetails), Number(id)]
    );

    await client.query('COMMIT');

    return res.json({
      message: 'Purchase order items updated successfully',
      purchaseOrder: updatedPoResult.rows[0],
      items: insertedItems,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
};