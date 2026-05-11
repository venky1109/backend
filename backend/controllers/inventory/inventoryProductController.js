import pool from '../../config/db.js';
import asyncHandler from '../../middleware/asyncHandler.js';

const makeSkuId = ({ productCode, batchId, expDate, productBarcodeId }) => {
  const code = String(productCode || 'MKP').replace(/\s+/g, '');
  const barcodePart = productBarcodeId ? `PB${productBarcodeId}` : 'PBNA';
  const batch = String(batchId || Date.now()).replace(/\s+/g, '');
  const expiry = expDate ? String(expDate).replaceAll('-', '') : 'NOEXP';

  return `${code}-${barcodePart}-B${batch}-${expiry}`;
};

export const getInventoryProducts = asyncHandler(async (req, res) => {
  const { rows } = await pool.query(`
    SELECT
      ip.*,
      w.warehouse_name,
      b.brand_name_english,
      c.category_name_english,
      u.unit_name,
      u.unit_short_code,
      pb.mk_barcode,
      pb.barcode,
      pb.quantity AS barcode_quantity
    FROM inventory.inventory_products ip
    LEFT JOIN catalog.warehouses w ON w.id = ip.warehouse_id
    LEFT JOIN catalog.brands b ON b.id = ip.brand_id
    LEFT JOIN catalog.categories c ON c.id = ip.category_id
    LEFT JOIN catalog.units u ON u.id = ip.unit_id
    LEFT JOIN catalog.product_barcodes pb ON pb.id = ip.product_barcode_id
    ORDER BY ip.updated_at DESC
  `);

  res.json(rows);
});

export const getInventoryProductById = asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `
    SELECT
      ip.*,
      w.warehouse_name,
      b.brand_name_english,
      c.category_name_english,
      u.unit_name,
      u.unit_short_code,
      pb.mk_barcode,
      pb.barcode,
      pb.quantity AS barcode_quantity
    FROM inventory.inventory_products ip
    LEFT JOIN catalog.warehouses w ON w.id = ip.warehouse_id
    LEFT JOIN catalog.brands b ON b.id = ip.brand_id
    LEFT JOIN catalog.categories c ON c.id = ip.category_id
    LEFT JOIN catalog.units u ON u.id = ip.unit_id
    LEFT JOIN catalog.product_barcodes pb ON pb.id = ip.product_barcode_id
    WHERE ip.id = $1
    `,
    [req.params.id]
  );

  if (!rows[0]) {
    res.status(404);
    throw new Error('Inventory product not found');
  }

  res.json(rows[0]);
});

export const addVerifiedPurchaseToInventory = asyncHandler(async (req, res) => {
  const {
    purchase_order_id,
    purchase_order_item_id,
    product_barcode_id,
    product_id,
    batch_id,
    sku_id,
    exp_date,
    mfg_date = null,
    warehouse_id,
    supplier_id = null,
    stakeholders_id = null,
    qty,
    no_of_units = 1,
    unit_price = 0,
    remarks = null,
  } = req.body;

  if (!purchase_order_id) throw new Error('purchase_order_id is required');
  if (!product_barcode_id) throw new Error('product_barcode_id is required');
  if (!batch_id) throw new Error('batch_id is required');
  if (!warehouse_id) throw new Error('warehouse_id is required');
  if (!exp_date) throw new Error('exp_date is required');
  if (!qty || Number(qty) <= 0) throw new Error('qty must be greater than 0');

  const units = Number(no_of_units || 1);
  const purchaseQty = Number(qty || 0);
  const price = Number(unit_price || 0);

  const client = await pool.connect();

  try {
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
        p."hsn-code" AS hsn_code
      FROM catalog.product_barcodes pb
      JOIN catalog.products p ON p.id = pb.product_id
      WHERE pb.id = $1
      LIMIT 1
      `,
      [Number(product_barcode_id)]
    );

    const product = productResult.rows[0];

    if (!product) {
      res.status(404);
      throw new Error('Product barcode row not found');
    }

    if (product_id && Number(product_id) !== Number(product.product_id)) {
      throw new Error('product_id does not match selected product_barcode_id');
    }

    const finalSkuId =
      sku_id ||
      makeSkuId({
        productCode: product.product_code,
        batchId: batch_id,
        expDate: exp_date,
        productBarcodeId: product.product_barcode_id,
      });

    const existingResult = await client.query(
      `
      SELECT *
      FROM inventory.inventory_products
      WHERE sku_id = $1
      LIMIT 1
      `,
      [finalSkuId]
    );

    let inventoryProduct;

    if (existingResult.rows.length > 0) {
      const updateResult = await client.query(
        `
        UPDATE inventory.inventory_products
        SET
          count_in_stock = COALESCE(count_in_stock, 0) + $1,
          no_of_units = COALESCE(no_of_units, 0) + $1,
          purchase_qty = COALESCE(purchase_qty, 0) + $2,
          unit_price = $3,
          warehouse_id = $4,
          exp_date = $5,
          mfg_date = $6,
          remarks = $7,
          updated_at = now()
        WHERE sku_id = $8
        RETURNING *
        `,
        [
          units,
          purchaseQty,
          price,
          Number(warehouse_id),
          exp_date,
          mfg_date || null,
          remarks,
          finalSkuId,
        ]
      );

      inventoryProduct = updateResult.rows[0];
    } else {
      const insertResult = await client.query(
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
          verified_by,
          verified_by_name,
          remarks
        )
        VALUES (
          $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
          $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
          $21,$22,$23,$24,$25
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

      inventoryProduct = insertResult.rows[0];
    }

    const transactionResult = await client.query(
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

    await client.query(
      `
      UPDATE purchases.purchase_order
      SET status = 'verified', updated_at = now()
      WHERE id = $1
      `,
      [Number(purchase_order_id)]
    );

    await client.query('COMMIT');

    res.status(201).json({
      message: 'Purchase verified and added to inventory',
      inventoryProduct,
      total_price: inventoryProduct.total_price,
      stockTransaction: transactionResult.rows[0],
    });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});