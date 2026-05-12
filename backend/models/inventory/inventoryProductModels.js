import { query, getClient } from '../../config/pg.js';

const toPgDate = (value) => {
  if (!value) return null;
  const match = String(value).trim().match(/(\d{4})-(\d{2})-(\d{2})/);
  return match ? match[0] : null;
};

const buildInsert = (schemaTable, data) => {
  const keys = Object.keys(data).filter((key) => data[key] !== undefined);
  const values = keys.map((key) => data[key]);
  const placeholders = keys.map((_, index) => `$${index + 1}`).join(', ');

  return {
    text: `
      INSERT INTO ${schemaTable} (${keys.join(', ')})
      VALUES (${placeholders})
      RETURNING *
    `,
    values,
  };
};

const buildUpdate = (schemaTable, id, data) => {
  const keys = Object.keys(data).filter((key) => data[key] !== undefined);
  const values = keys.map((key) => data[key]);

  if (!keys.length) {
    throw new Error('No fields provided for update');
  }

  const setClause = keys
    .map((key, index) => `${key} = $${index + 1}`)
    .join(', ');

  return {
    text: `
      UPDATE ${schemaTable}
      SET ${setClause}, updated_at = NOW()
      WHERE id = $${keys.length + 1}
      RETURNING *
    `,
    values: [...values, Number(id)],
  };
};

const makeSkuId = ({ productCode, batchId, expDate, productBarcodeId }) => {
  const code = String(productCode || 'MKP').replace(/\s+/g, '');
  const barcodePart = productBarcodeId ? `PB${productBarcodeId}` : 'PBNA';
  const batch = String(batchId || Date.now()).replace(/\s+/g, '');
  const expiry = expDate ? String(expDate).replaceAll('-', '') : 'NOEXP';

  return `${code}-${barcodePart}-B${batch}-${expiry}`;
};

export const InventoryProduct = {
  async findAll() {
    const { rows } = await query(`
      SELECT
        ip.*,
         to_char(ip.exp_date, 'YYYY-MM-DD') AS exp_date,
  to_char(ip.mfg_date, 'YYYY-MM-DD') AS mfg_date,
        pb.mk_barcode,
        pb.barcode,
        pb.quantity AS barcode_quantity,
        p.product_code,
        COALESCE(p.product_name_eng, p.product_name_tel, ip.product_name) AS product_name,
        b.brand_name_english,
        b.brand_name_telugu,
        c.category_name_english,
        c.category_name_telugu,
        u.unit_name,
        u.unit_short_code
      FROM inventory.inventory_products ip
      LEFT JOIN catalog.product_barcodes pb
        ON pb.id = ip.product_barcode_id
      LEFT JOIN catalog.products p
        ON p.id = pb.product_id
      LEFT JOIN catalog.brands b
        ON b.id = pb.brand_id
      LEFT JOIN catalog.categories c
        ON c.id = pb.category_id
      LEFT JOIN catalog.units u
        ON u.id = pb.unit_id
      ORDER BY ip.updated_at DESC, ip.id DESC
    `);

    return rows;
  },

  async findById(id) {
    const { rows } = await query(
      `
      SELECT
        ip.*,
        to_char(ip.exp_date::date, 'YYYY-MM-DD') AS exp_date,
        to_char(ip.mfg_date::date, 'YYYY-MM-DD') AS mfg_date,
        pb.mk_barcode,
        pb.barcode,
        pb.quantity AS barcode_quantity,
        p.product_code,
        COALESCE(p.product_name_eng, p.product_name_tel, ip.product_name) AS product_name,
        b.brand_name_english,
        b.brand_name_telugu,
        c.category_name_english,
        c.category_name_telugu,
        u.unit_name,
        u.unit_short_code
      FROM inventory.inventory_products ip
      LEFT JOIN catalog.product_barcodes pb
        ON pb.id = ip.product_barcode_id
      LEFT JOIN catalog.products p
        ON p.id = pb.product_id
      LEFT JOIN catalog.brands b
        ON b.id = pb.brand_id
      LEFT JOIN catalog.categories c
        ON c.id = pb.category_id
      LEFT JOIN catalog.units u
        ON u.id = pb.unit_id
      WHERE ip.id = $1
      `,
      [Number(id)]
    );

    return rows[0];
  },

  async create(data) {
    const payload = { ...data };

    if (payload.exp_date) payload.exp_date = toPgDate(payload.exp_date);
    if (payload.mfg_date) payload.mfg_date = toPgDate(payload.mfg_date);

    const insert = buildInsert('inventory.inventory_products', payload);
    const { rows } = await query(insert.text, insert.values);

    return rows[0];
  },

  async update(id, data) {
    const payload = { ...data };

    if (payload.exp_date) payload.exp_date = toPgDate(payload.exp_date);
    if (payload.mfg_date) payload.mfg_date = toPgDate(payload.mfg_date);

    const update = buildUpdate('inventory.inventory_products', id, payload);
    const { rows } = await query(update.text, update.values);

    return rows[0];
  },

  async remove(id) {
    const { rows } = await query(
      `
      DELETE FROM inventory.inventory_products
      WHERE id = $1
      RETURNING *
      `,
      [Number(id)]
    );

    return rows[0];
  },

  async receiveVerifiedPurchase(data, user = {}) {
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
    } = data;

    const finalExpDate = toPgDate(exp_date);
    const finalMfgDate = toPgDate(mfg_date);

    if (!purchase_order_id) throw new Error('purchase_order_id is required');
    if (!product_barcode_id) throw new Error('product_barcode_id is required');
    if (!batch_id) throw new Error('batch_id is required');
    if (!warehouse_id) throw new Error('warehouse_id is required');
    if (!finalExpDate) throw new Error('Valid exp_date is required');
    if (!qty || Number(qty) <= 0) throw new Error('qty must be greater than 0');

    const units = Number(no_of_units || 1);
    const purchaseQty = Number(qty || 0);
    const price = Number(unit_price || 0);

    const client = await getClient();

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
          expDate: finalExpDate,
          productBarcodeId: product.product_barcode_id,
        });

      const existingResult = await client.query(
        `
        SELECT *
        FROM inventory.inventory_products
        WHERE product_barcode_id = $1
          AND exp_date::date = $2::date
          AND warehouse_id = $3
          AND COALESCE(is_active, true) = true
        FOR UPDATE
        LIMIT 1
        `,
        [Number(product.product_barcode_id), finalExpDate, Number(warehouse_id)]
      );

      let inventoryProduct;

      if (existingResult.rows.length > 0) {
        const updateResult = await client.query(
          `
          UPDATE inventory.inventory_products
          SET
            count_in_stock = COALESCE(count_in_stock, 0) + $1,
            no_of_units = COALESCE(no_of_units, 0) + $2,
            purchase_qty = COALESCE(purchase_qty, 0) + $3,
            unit_price = $4,
            batch_id = COALESCE($5, batch_id),
            purchase_order_id = $6,
            purchase_order_item_id = $7,
            supplier_id = $8,
            stakeholders_id = $9,
            warehouse_id = $10,
            exp_date = $11,
            mfg_date = COALESCE($12, mfg_date),
            sku_id = COALESCE($13, sku_id),
            remarks = COALESCE($14, remarks),
            updated_at = now()
          WHERE id = $15
          RETURNING *
          `,
          [
            units,
            units,
            purchaseQty,
            price,
            Number(batch_id),
            Number(purchase_order_id),
            purchase_order_item_id ? Number(purchase_order_item_id) : null,
            supplier_id || stakeholders_id
              ? Number(supplier_id || stakeholders_id)
              : null,
            stakeholders_id || supplier_id
              ? Number(stakeholders_id || supplier_id)
              : null,
            Number(warehouse_id),
            finalExpDate,
            finalMfgDate,
            finalSkuId,
            remarks || null,
            existingResult.rows[0].id,
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
            finalMfgDate,
            finalExpDate,
            Number(purchase_order_id),
            purchase_order_item_id ? Number(purchase_order_item_id) : null,
            supplier_id || stakeholders_id
              ? Number(supplier_id || stakeholders_id)
              : null,
            product.unit_id ? Number(product.unit_id) : null,
            purchaseQty,
            price,
            user?.username || user?.name || user?.first_name || 'SYSTEM',
            user?.username || user?.name || user?.first_name || 'SYSTEM',
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

      return {
        updated_existing: existingResult.rows.length > 0,
        inventoryProduct,
        total_price: inventoryProduct.total_price,
        stockTransaction: transactionResult.rows[0],
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },
};

export const StockTransaction = {
  async findAll() {
    const { rows } = await query(`
      SELECT *
      FROM inventory.stock_transaction
      ORDER BY created_at DESC
    `);

    return rows;
  },

  async findById(id) {
    const { rows } = await query(
      `
      SELECT *
      FROM inventory.stock_transaction
      WHERE id = $1
      `,
      [Number(id)]
    );

    return rows[0];
  },

  async create(data) {
    const insert = buildInsert('inventory.stock_transaction', data);
    const { rows } = await query(insert.text, insert.values);

    return rows[0];
  },

  async update(id, data) {
    const update = buildUpdate('inventory.stock_transaction', id, data);
    const { rows } = await query(update.text, update.values);

    return rows[0];
  },

  async remove(id) {
    const { rows } = await query(
      `
      DELETE FROM inventory.stock_transaction
      WHERE id = $1
      RETURNING *
      `,
      [Number(id)]
    );

    return rows[0];
  },
};

export { toPgDate };