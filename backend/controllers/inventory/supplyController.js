import { getClient, query } from '../../config/pg.js';
import {
  PurchaseOrder,
  PurchaseOrderItem,
} from '../../models/inventory/purchaseModels.js';

const getEffectivePrice = (item) => {
  if (item.actual_unit_price !== undefined && item.actual_unit_price !== null) {
    return Number(item.actual_unit_price);
  }

  return Number(item.expected_unit_price ?? item.unit_price ?? 0);
};

const getLineTotal = (item) => {
  return Number(item.no_of_units || 1) * getEffectivePrice(item);
};

const getItemQuantity = (item) => Number(item.qty ?? item.quantity ?? 0);

const getCatalogBarcodeForPurchaseItem = async (client, item) => {
  const barcodeId = item.product_barcode_id ?? item.productBarcodeId;
  const mkBarcode = item.mk_barcode ?? item.barcode ?? null;
  const params = [];
  let where = '';

  if (barcodeId) {
    params.push(Number(barcodeId));
    where = 'pb.id = $1';
  } else if (mkBarcode) {
    params.push(String(mkBarcode));
    where = 'pb.mk_barcode = $1';
  } else {
    params.push(
      Number(item.product_id),
      Number(item.brand_id),
      Number(item.category_id),
      Number(item.unit_id),
      getItemQuantity(item)
    );
    where = `
      pb.product_id = $1
      AND pb.brand_id = $2
      AND pb.category_id = $3
      AND pb.unit_id = $4
      AND pb.quantity::numeric = $5::numeric
    `;
  }

  const { rows } = await client.query(
    `
    SELECT
      pb.id,
      pb.product_id,
      pb.brand_id,
      pb.category_id,
      pb.unit_id,
      pb.quantity
    FROM catalog.product_barcodes pb
    WHERE ${where}
      AND COALESCE(pb.is_active, true) = true
    LIMIT 1
    `,
    params
  );

  const barcode = rows[0];

  if (!barcode) {
    throw new Error(
      'Selected product, brand, category, unit and quantity must match an active product barcode'
    );
  }

  const checks = [
    ['product_id', 'product_id'],
    ['brand_id', 'brand_id'],
    ['category_id', 'category_id'],
    ['unit_id', 'unit_id'],
  ];

  for (const [inputKey, barcodeKey] of checks) {
    if (
      item[inputKey] !== undefined &&
      item[inputKey] !== null &&
      Number(item[inputKey]) !== Number(barcode[barcodeKey])
    ) {
      throw new Error(`${inputKey} does not match selected product_barcode_id`);
    }
  }

  if (item.qty !== undefined && Number(item.qty) !== Number(barcode.quantity)) {
    throw new Error('qty does not match selected product_barcode_id quantity');
  }

  return barcode;
};

const normalizeName = (value) => {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
};

const makeInventorySkuId = ({ productCode, batchId, expDate, productBarcodeId }) => {
  const code = String(productCode || 'MKP').replace(/\s+/g, '');
  const batch = String(batchId || Date.now()).replace(/\s+/g, '');
  const expiry = expDate ? String(expDate).replaceAll('-', '') : 'NOEXP';
  return `${code}-PB${productBarcodeId || 'NA'}-B${batch}-${expiry}`;
};

const validateCatalogSelection = (data, product) => {
  if (data.product_id && Number(data.product_id) !== Number(product.product_id)) {
    throw new Error('product_id does not match selected product_barcode_id');
  }

  const sentName = normalizeName(
    data.product_name ||
      data.productName ||
      data.product_name_eng ||
      data.productNameEng
  );

  if (sentName && sentName !== normalizeName(product.product_name)) {
    throw new Error(
      `product_name does not match selected product_barcode_id. Barcode ${product.product_barcode_id} belongs to ${product.product_name}`
    );
  }
};

export const getSupplierProducts = async (req, res, next) => {
  try {
    const supplierId = req.params.supplierId;

    const { rows } = await query(
      `
      SELECT ip.*, b.brand_name_english, c.category_name_english
      FROM inventory.inventory_products ip
      LEFT JOIN catalog.brands b ON b.id = ip.brand_id
      LEFT JOIN catalog.categories c ON c.id = ip.category_id
      WHERE ip.stakeholders_id = $1
      ORDER BY ip.product_name
      `,
      [supplierId]
    );

    res.json(rows);
  } catch (err) {
    next(err);
  }
};

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
              'product_barcode_id', poi.product_barcode_id,
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

              'mk_barcode', pb.mk_barcode,
              'barcode', pb.barcode,

              'is_verified', false,
              'exp_date', '',
              'mfg_date', '',
              'sku_id', '',
              'inventory_remarks', ''
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

      LEFT JOIN catalog.product_barcodes pb
        ON pb.id = poi.product_barcode_id
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
            'Each item requires product_id, brand_id, category_id, unit_id, qty and expected_unit_price',
        });
      }
    }

    await client.query('BEGIN');

    const resolvedItems = [];

    for (const item of items) {
      const barcode = await getCatalogBarcodeForPurchaseItem(client, item);
      resolvedItems.push({
        ...item,
        product_barcode_id: Number(barcode.id),
        product_id: Number(barcode.product_id),
        category_id: Number(barcode.category_id),
        brand_id: Number(barcode.brand_id),
        unit_id: Number(barcode.unit_id),
        qty: Number(barcode.quantity),
      });
    }

    const totalAmount = resolvedItems.reduce((sum, item) => {
      return sum + getLineTotal(item);
    }, 0);

    const poNumber = `PO-${Date.now()}-${supplier_id}`;

    const finalBillDetails = {
      ...bill_details,
      items: resolvedItems.map((item) => {
        const expectedPrice = Number(
          item.expected_unit_price ?? item.unit_price ?? 0
        );

        const actualPrice =
          item.actual_unit_price !== undefined &&
          item.actual_unit_price !== null
            ? Number(item.actual_unit_price)
            : null;

        const effectivePrice = actualPrice ?? expectedPrice;

        return {
          product_barcode_id: item.product_barcode_id
            ? Number(item.product_barcode_id)
            : null,
          product_id: Number(item.product_id),
          category_id: Number(item.category_id),
          brand_id: Number(item.brand_id),
          unit_id: Number(item.unit_id),
          qty: Number(item.qty),
          no_of_units: Number(item.no_of_units || 1),
          expected_unit_price: expectedPrice,
          actual_unit_price: actualPrice,
          total: Number(item.no_of_units || 1) * effectivePrice,
        };
      }),
    };

    const poResult = await client.query(
      `
      INSERT INTO purchases.purchase_order (
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
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
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

    for (const item of resolvedItems) {
      const itemResult = await client.query(
        `
        INSERT INTO purchases.purchase_order_items (
          purchase_order_id,
          product_barcode_id,
          product_id,
          category_id,
          brand_id,
          qty,
          no_of_units,
          unit_id,
          expected_unit_price,
          actual_unit_price
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        RETURNING *
        `,
        [
          purchaseOrder.id,
          Number(item.product_barcode_id),
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

    res.status(201).json({
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

    if (String(po.status || '').toLowerCase() !== 'draft') {
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
        !item.category_id ||
        !item.unit_id ||
        !item.qty ||
        expectedPrice === undefined ||
        expectedPrice === null
      ) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          message:
            'Each item requires product_id, brand_id, category_id, unit_id, qty and expected_unit_price',
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
      const barcode = await getCatalogBarcodeForPurchaseItem(client, item);
      const expectedPrice = Number(
        item.expected_unit_price ?? item.unit_price ?? 0
      );

      const actualPrice =
        item.actual_unit_price !== undefined && item.actual_unit_price !== null
          ? Number(item.actual_unit_price)
          : null;

      totalAmount += getLineTotal(item);

      const itemResult = await client.query(
        `
        INSERT INTO purchases.purchase_order_items (
          purchase_order_id,
          product_barcode_id,
          product_id,
          category_id,
          brand_id,
          qty,
          no_of_units,
          unit_id,
          expected_unit_price,
          actual_unit_price
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        RETURNING *
        `,
        [
          Number(id),
          Number(barcode.id),
          Number(barcode.product_id),
          Number(barcode.category_id),
          Number(barcode.brand_id),
          Number(barcode.quantity),
          Number(item.no_of_units || 1),
          Number(barcode.unit_id),
          expectedPrice,
          actualPrice,
        ]
      );

      insertedItems.push(itemResult.rows[0]);
    }

    const finalBillDetails = {
      ...(po.bill_details || {}),
      items: insertedItems.map((item) => {
        const expectedPrice = Number(item.expected_unit_price || 0);

        const actualPrice =
          item.actual_unit_price !== null && item.actual_unit_price !== undefined
            ? Number(item.actual_unit_price)
            : null;

        const effectivePrice = actualPrice ?? expectedPrice;

        return {
          product_barcode_id: item.product_barcode_id
            ? Number(item.product_barcode_id)
            : null,
          product_id: Number(item.product_id),
          category_id: Number(item.category_id),
          brand_id: Number(item.brand_id),
          unit_id: Number(item.unit_id),
          qty: Number(item.qty),
          no_of_units: Number(item.no_of_units || 1),
          expected_unit_price: expectedPrice,
          actual_unit_price: actualPrice,
          total: Number(item.no_of_units || 1) * effectivePrice,
        };
      }),
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

    res.json({
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

export const receivePurchaseOrder = async (req, res, next) => {
  const client = await getClient();

  try {
    const {
      purchase_order_id,
      items = [],
      source = 'supplier',
      destination = 'warehouse',
    } = req.body;

    if (!purchase_order_id || !items.length) {
      return res.status(400).json({
        message: 'purchase_order_id and items are required',
      });
    }

    await client.query('BEGIN');

    const movements = [];

    for (const item of items) {
      const qty = Number(item.qty_in || item.qty || 0);

      if (qty <= 0) {
        throw new Error('qty must be greater than 0');
      }

      await client.query(
        `
        UPDATE inventory.inventory_products
        SET count_in_stock = count_in_stock + $1,
            updated_at = NOW()
        WHERE id = $2
        `,
        [qty, item.product_id]
      );

      const stock = await client.query(
        `
        SELECT count_in_stock
        FROM inventory.inventory_products
        WHERE id = $1
        `,
        [item.product_id]
      );

      const balanceQty = stock.rows[0]?.count_in_stock || 0;

      const movement = await client.query(
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
        VALUES ($1,$2,$3,$4,$5,0,$6)
        RETURNING *
        `,
        [
          item.product_id,
          source,
          destination,
          'PURCHASE_RECEIVE',
          qty,
          balanceQty,
        ]
      );

      movements.push(movement.rows[0]);

      await client.query(
        `
        UPDATE purchases.purchase_order_items
        SET updated_at = NOW()
        WHERE purchase_order_id = $1
          AND product_id = $2
        `,
        [purchase_order_id, item.product_id]
      );
    }

    await client.query(
      `
      UPDATE purchases.purchase_order
      SET status = 'received',
          updated_at = NOW()
      WHERE id = $1
      `,
      [purchase_order_id]
    );

    await client.query('COMMIT');

    res.json({
      message: 'Stock received successfully',
      movements,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
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
      `
      SELECT *
      FROM purchases.purchase_order
      WHERE id = $1
      `,
      [id]
    );

    const po = poResult.rows[0];

    if (!po) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        message: 'Purchase order not found',
      });
    }

    const currentStatus = String(po.status || '').trim().toLowerCase();

    if (!['received', 'verified'].includes(currentStatus)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        message: `Only received purchase orders can be verified. Current status: ${po.status}`,
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
        [Number(item.actual_unit_price || 0), Number(item.id), Number(id)]
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

export const addVerifiedPurchaseToInventory = async (req, res, next) => {
  const client = await getClient();

  try {
    const {
      purchase_order_id,
      purchase_order_item_id = null,
      product_barcode_id,
      product_id,
      batch_id,
      sku_id,
      warehouse_id,
      supplier_id,
      stakeholders_id,
      qty,
      no_of_units = 1,
      unit_price,
      unit_mrp,
      unit_MRP,
      mrp,
      MRP,
      mfg_date,
      exp_date,
      remarks,
    } = req.body;

    if (
      !purchase_order_id ||
      !product_barcode_id ||
      !batch_id ||
      !sku_id ||
      !warehouse_id ||
      !qty ||
      !exp_date
    ) {
      return res.status(400).json({
        message:
          'purchase_order_id, product_barcode_id, batch_id, sku_id, warehouse_id, qty and exp_date are required',
      });
    }

    const units = Number(no_of_units || 1);
    const purchaseQty = Number(qty || 0);
    const price = Number(unit_price || 0);
    const mrpPrice = Number(unit_mrp ?? unit_MRP ?? mrp ?? MRP ?? 0);

    await client.query('BEGIN');

    const productResult = await client.query(
      `
      SELECT
        pb.id AS product_barcode_id,
        pb.product_id,
        pb.category_id,
        pb.brand_id,
        pb.unit_id,
        pb.quantity,
        pb.barcode,
        pb.mk_barcode,
        p.product_code,
        COALESCE(p.product_name_eng, p.product_name_tel, p.product_code) AS product_name,
        p.hsncode AS hsn_code
      FROM catalog.product_barcodes pb
      JOIN catalog.products p ON p.id = pb.product_id
      WHERE pb.id = $1
      LIMIT 1
      `,
      [Number(product_barcode_id)]
    );

    const product = productResult.rows[0];

    if (!product) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        message: 'Product barcode row not found',
      });
    }

    try {
      validateCatalogSelection(req.body, product);
    } catch (validationError) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        message: validationError.message,
      });
    }

    const finalSkuId =
      sku_id && String(sku_id).includes(`PB${product.product_barcode_id}`)
        ? sku_id
        : makeInventorySkuId({
            productCode: product.product_code,
            batchId: batch_id,
            expDate: exp_date,
            productBarcodeId: product.product_barcode_id,
          });

    const existing = await client.query(
      `
      SELECT *
      FROM inventory.inventory_products
      WHERE product_barcode_id = $1
        AND warehouse_id = $2
        AND batch_id = $3
        AND exp_date::date = $4::date
        AND COALESCE(is_active, true) = true
      ORDER BY updated_at DESC, id DESC
      FOR UPDATE
      LIMIT 1
      `,
      [
        Number(product.product_barcode_id),
        Number(warehouse_id),
        Number(batch_id),
        exp_date,
      ]
    );

    let inventoryProduct;

    if (existing.rows.length > 0) {
      const updated = await client.query(
        `
        UPDATE inventory.inventory_products
        SET count_in_stock = COALESCE(count_in_stock, 0) + $1,
            no_of_units = COALESCE(no_of_units, 0) + $1,
            purchase_qty = COALESCE(purchase_qty, 0) + $2,
            unit_price = $3,
            unit_mrp = $4,
            warehouse_id = $5,
            exp_date = $6,
            mfg_date = $7,
            remarks = $8,
            updated_at = NOW()
        WHERE id = $9
        RETURNING *
        `,
        [
          units,
          purchaseQty,
          price,
          mrpPrice,
          Number(warehouse_id),
          exp_date,
          mfg_date || null,
          remarks || null,
          existing.rows[0].id,
        ]
      );

      inventoryProduct = updated.rows[0];
    } else {
      const inserted = await client.query(
        `
        INSERT INTO inventory.inventory_products (
          product_barcode_id,
          product_code,
          product_name,
          sku_id,
          hsn_code,
          bar_code,
          batch_id,
          category_id,
          brand_id,
          count_in_stock,
          no_of_units,
          stakeholders_id,
          business_entity_type,
          warehouse_id,
          mfg_date,
          exp_date,
          purchase_order_id,
          purchase_order_item_id,
          supplier_id,
          unit_id,
          purchase_qty,
          unit_price,
          unit_mrp,
          verified_by,
          verified_by_name,
          remarks
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
          $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
          $21,$22,$23,$24,$25,$26
        )
        RETURNING *
        `,
        [
          Number(product.product_barcode_id),
          product.product_code,
          product.product_name,
          finalSkuId,
          product.hsn_code,
          product.mk_barcode || product.barcode || null,
          Number(batch_id),
          product.category_id ? Number(product.category_id) : null,
          product.brand_id ? Number(product.brand_id) : null,
          units,
          units,
          stakeholders_id || supplier_id
            ? Number(stakeholders_id || supplier_id)
            : null,
          'WAREHOUSE',
          Number(warehouse_id),
          mfg_date || null,
          exp_date,
          Number(purchase_order_id),
          purchase_order_item_id ? Number(purchase_order_item_id) : null,
          supplier_id || stakeholders_id
            ? Number(supplier_id || stakeholders_id)
            : null,
          product.unit_id ? Number(product.unit_id) : null,
          purchaseQty,
          price,
          mrpPrice,
          req.user?.username ||
            req.user?.name ||
            req.user?.first_name ||
            'SYSTEM',
          req.user?.username ||
            req.user?.name ||
            req.user?.first_name ||
            'SYSTEM',
          remarks || null,
        ]
      );

      inventoryProduct = inserted.rows[0];
    }

    const stockTransaction = await client.query(
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
      RETURNING *
      `,
      [
        Number(product.product_id),
        `PURCHASE_ORDER:${purchase_order_id}`,
        `WAREHOUSE:${warehouse_id}`,
        'PURCHASE_VERIFIED',
        units,
        0,
        Number(inventoryProduct.count_in_stock || 0),
      ]
    );

    await client.query('COMMIT');

    res.status(201).json({
      message: 'Inventory and stock movement updated successfully',
      inventoryProduct,
      total_price: inventoryProduct.total_price,
      stockTransaction: stockTransaction.rows[0],
    });
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally {
    client.release();
  }
};
