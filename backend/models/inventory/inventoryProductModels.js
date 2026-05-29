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

const normalizeName = (value) => {
  return String(value || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
};

const resolveUnitMrp = (data = {}) => {
  const value =
    data.unit_mrp ??
    data.unit_MRP ??
    data.unitMrp ??
    data.unitMRP ??
    data.inventoryUnitMrp ??
    data.inventory_unit_mrp ??
    data.mrp ??
    data.MRP;

  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
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

export const InventoryProduct = {
  async findAll() {
    const { rows } = await query(`
      SELECT
        ip.*,
         to_char(ip.exp_date, 'YYYY-MM-DD') AS exp_date,
  to_char(ip.mfg_date, 'YYYY-MM-DD') AS mfg_date,
        pb.mk_barcode,
        pb.barcode,
        pb.image_url,
        pb.quantity AS barcode_quantity,
        ip.product_barcode_id AS mkid,
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
        pb.image_url,
        pb.quantity AS barcode_quantity,
        ip.product_barcode_id AS mkid,
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
      unit_mrp,
      unit_MRP,
      unitMrp,
      unitMRP,
      inventoryUnitMrp,
      inventory_unit_mrp,
      mrp,
      MRP,
      remarks = null,
    } = data;

    const finalExpDate = toPgDate(exp_date);
    const finalMfgDate = toPgDate(mfg_date);

    let resolvedProductBarcodeId = product_barcode_id;
    const mkBarcode = data.MK_BARCODE || data.mk_barcode || data.mkBarcode || data.barcode;

    if (!resolvedProductBarcodeId && mkBarcode) {
      const barcodeLookup = await query(
        `
        SELECT id
        FROM catalog.product_barcodes
        WHERE mk_barcode = $1 OR barcode = $1
        LIMIT 1
        `,
        [String(mkBarcode)]
      );
      resolvedProductBarcodeId = barcodeLookup.rows[0]?.id;
    }

    if (!purchase_order_id) throw new Error('purchase_order_id is required');
    if (!resolvedProductBarcodeId) throw new Error('product_barcode_id or MK_BARCODE is required');
    if (!batch_id) throw new Error('batch_id is required');
    if (!warehouse_id) throw new Error('warehouse_id is required');
    if (!finalExpDate) throw new Error('Valid exp_date is required');
    if (!qty || Number(qty) <= 0) throw new Error('qty must be greater than 0');

    const units = Number(no_of_units || 1);
    const purchaseQty = Number(qty || 0);
    const price = Number(unit_price || 0);
    const mrpPrice = resolveUnitMrp({
      unit_mrp,
      unit_MRP,
      unitMrp,
      unitMRP,
      inventoryUnitMrp,
      inventory_unit_mrp,
      mrp,
      MRP,
    });

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
          p.hsncode AS hsn_code
        FROM catalog.product_barcodes pb
        JOIN catalog.products p ON p.id = pb.product_id
        WHERE pb.id = $1
        LIMIT 1
        `,
        [Number(resolvedProductBarcodeId)]
      );

      const product = productResult.rows[0];

      if (!product) {
        throw new Error('Product barcode row not found');
      }

      validateCatalogSelection(data, product);

      const finalSkuId =
        sku_id && String(sku_id).includes(`PB${product.product_barcode_id}`)
          ? sku_id
          : makeSkuId({
          productCode: product.product_code,
          batchId: batch_id,
          expDate: finalExpDate,
          productBarcodeId: product.product_barcode_id,
        });

      if (purchase_order_item_id) {
        const receivedResult = await client.query(
          `
          SELECT *
          FROM inventory.inventory_products
          WHERE purchase_order_item_id = $1
          FOR UPDATE
          LIMIT 1
          `,
          [Number(purchase_order_item_id)]
        );

        if (receivedResult.rows.length > 0) {
          const realignedResult = await client.query(
            `
            UPDATE inventory.inventory_products
            SET
              product_barcode_id = $1,
              product_code = $2,
              product_name = $3,
              hsn_code = $4,
              bar_code = $5,
              batch_id = COALESCE($6, batch_id),
              category_id = $7,
              brand_id = $8,
              warehouse_id = $9,
              mfg_date = COALESCE($10, mfg_date),
              exp_date = $11,
              purchase_order_id = $12,
              supplier_id = $13,
              stakeholders_id = $14,
              unit_id = $15,
              unit_price = $16,
              unit_mrp = $17,
              remarks = COALESCE($18, remarks),
              updated_at = now()
            WHERE id = $19
            RETURNING *
            `,
            [
              Number(product.product_barcode_id),
              product.product_code,
              product.product_name,
              product.hsn_code,
              product.mk_barcode || product.barcode || null,
              Number(batch_id),
              product.category_id ? Number(product.category_id) : null,
              product.brand_id ? Number(product.brand_id) : null,
              Number(warehouse_id),
              finalMfgDate,
              finalExpDate,
              Number(purchase_order_id),
              supplier_id || stakeholders_id
                ? Number(supplier_id || stakeholders_id)
                : null,
              stakeholders_id || supplier_id
                ? Number(stakeholders_id || supplier_id)
                : null,
              product.unit_id ? Number(product.unit_id) : null,
              price,
              mrpPrice,
              remarks || null,
              receivedResult.rows[0].id,
            ]
          );

          await client.query('COMMIT');

          return {
            already_received: true,
            updated_existing: true,
            inventoryProduct: realignedResult.rows[0],
            total_price: realignedResult.rows[0].total_price,
            stockTransaction: null,
          };
        }
      }

      const existingResult = await client.query(
        `
        SELECT *
        FROM inventory.inventory_products
        WHERE product_barcode_id = $1
          AND exp_date::date = $2::date
          AND warehouse_id = $3
          AND batch_id = $4
          AND COALESCE(is_active, true) = true
        ORDER BY
          updated_at DESC,
          id DESC
        FOR UPDATE
        LIMIT 1
        `,
        [
          Number(product.product_barcode_id),
          finalExpDate,
          Number(warehouse_id),
          Number(batch_id),
        ]
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
            unit_mrp = $5,
            batch_id = COALESCE($6, batch_id),
            purchase_order_id = $7,
            purchase_order_item_id = $8,
            supplier_id = $9,
            stakeholders_id = $10,
            warehouse_id = $11,
            exp_date = $12,
            mfg_date = COALESCE($13, mfg_date),
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
            mrpPrice,
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
          ON CONFLICT ON CONSTRAINT products_sku_id_key
          DO UPDATE SET
            count_in_stock = COALESCE(inventory.inventory_products.count_in_stock, 0) + EXCLUDED.count_in_stock,
            no_of_units = COALESCE(inventory.inventory_products.no_of_units, 0) + EXCLUDED.no_of_units,
            purchase_qty = COALESCE(inventory.inventory_products.purchase_qty, 0) + EXCLUDED.purchase_qty,
            product_barcode_id = EXCLUDED.product_barcode_id,
            product_code = EXCLUDED.product_code,
            product_name = EXCLUDED.product_name,
            hsn_code = EXCLUDED.hsn_code,
            bar_code = EXCLUDED.bar_code,
            batch_id = EXCLUDED.batch_id,
            category_id = EXCLUDED.category_id,
            brand_id = EXCLUDED.brand_id,
            stakeholders_id = EXCLUDED.stakeholders_id,
            business_entity_type = EXCLUDED.business_entity_type,
            warehouse_id = EXCLUDED.warehouse_id,
            mfg_date = COALESCE(EXCLUDED.mfg_date, inventory.inventory_products.mfg_date),
            exp_date = EXCLUDED.exp_date,
            purchase_order_id = EXCLUDED.purchase_order_id,
            purchase_order_item_id = EXCLUDED.purchase_order_item_id,
            supplier_id = EXCLUDED.supplier_id,
            unit_id = EXCLUDED.unit_id,
            unit_price = EXCLUDED.unit_price,
            unit_mrp = EXCLUDED.unit_mrp,
            verified_by = EXCLUDED.verified_by,
            verified_by_name = EXCLUDED.verified_by_name,
            remarks = COALESCE(EXCLUDED.remarks, inventory.inventory_products.remarks),
            updated_at = now()
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
            mrpPrice,
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
        unit_mrp: inventoryProduct.unit_mrp,
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
    try {
      const { rows } = await query(`
        SELECT
          st.*,
          rt.request_id,
          COALESCE(rt.product_barcode_id, ip.product_barcode_id) AS product_barcode_id
        FROM inventory.stock_transaction st
        LEFT JOIN LATERAL (
          SELECT
            r.id AS request_id,
            r.product_barcode_id,
            CASE
              WHEN r.payload->>'stock_transaction_id' ~ '^[0-9]+$'
               AND (r.payload->>'stock_transaction_id')::bigint = st.id
              THEN 0
              ELSE 1
            END AS match_rank
          FROM request_tracking.requests r
          WHERE r.request_type = 'inventory_migration'
            AND (
              (
                r.payload->>'stock_transaction_id' ~ '^[0-9]+$'
                AND (r.payload->>'stock_transaction_id')::bigint = st.id
              )
              OR (
                st.ref_type = 'PURCHASE_VERIFIED'
                AND r.status = 'completed'
                AND r.payload->>'purchase_order_id' = REPLACE(COALESCE(st.source, ''), 'PURCHASE_ORDER:', '')
                AND COALESCE(r.warehouse_id::text, r.payload->>'warehouse_id') = REPLACE(COALESCE(st.destination, ''), 'WAREHOUSE:', '')
                AND EXISTS (
                  SELECT 1
                  FROM catalog.product_barcodes pb
                  WHERE pb.id = r.product_barcode_id
                    AND pb.product_id = st.product_id
                )
              )
            )
          ORDER BY match_rank ASC, r.updated_at DESC, r.id DESC
          LIMIT 1
        ) rt ON TRUE
        LEFT JOIN LATERAL (
          SELECT ip_inner.product_barcode_id
          FROM inventory.inventory_products ip_inner
          LEFT JOIN catalog.product_barcodes pb_inner
            ON pb_inner.id = ip_inner.product_barcode_id
          WHERE pb_inner.product_id = st.product_id
            AND ip_inner.warehouse_id = CASE
              WHEN st.destination ~ '^WAREHOUSE:[0-9]+$'
              THEN REPLACE(st.destination, 'WAREHOUSE:', '')::bigint
              ELSE ip_inner.warehouse_id
            END
          ORDER BY ip_inner.updated_at DESC, ip_inner.id DESC
          LIMIT 1
        ) ip ON TRUE
        ORDER BY st.created_at DESC
      `);

      return rows;
    } catch (error) {
      if (error?.code !== '42P01' || !String(error?.message || '').includes('request_tracking.')) {
        throw error;
      }

      const { rows } = await query(`
        SELECT
          st.*,
          NULL::bigint AS request_id,
          ip.product_barcode_id
        FROM inventory.stock_transaction st
        LEFT JOIN LATERAL (
          SELECT ip_inner.product_barcode_id
          FROM inventory.inventory_products ip_inner
          LEFT JOIN catalog.product_barcodes pb_inner
            ON pb_inner.id = ip_inner.product_barcode_id
          WHERE pb_inner.product_id = st.product_id
            AND ip_inner.warehouse_id = CASE
              WHEN st.destination ~ '^WAREHOUSE:[0-9]+$'
              THEN REPLACE(st.destination, 'WAREHOUSE:', '')::bigint
              ELSE ip_inner.warehouse_id
            END
          ORDER BY ip_inner.updated_at DESC, ip_inner.id DESC
          LIMIT 1
        ) ip ON TRUE
        ORDER BY st.created_at DESC
      `);

      return rows;
    }
  },

  async findById(id) {
    try {
      const { rows } = await query(
        `
        SELECT
          st.*,
          rt.request_id,
          COALESCE(rt.product_barcode_id, ip.product_barcode_id) AS product_barcode_id
        FROM inventory.stock_transaction st
        LEFT JOIN LATERAL (
          SELECT
            r.id AS request_id,
            r.product_barcode_id,
            CASE
              WHEN r.payload->>'stock_transaction_id' ~ '^[0-9]+$'
               AND (r.payload->>'stock_transaction_id')::bigint = st.id
              THEN 0
              ELSE 1
            END AS match_rank
          FROM request_tracking.requests r
          WHERE r.request_type = 'inventory_migration'
            AND (
              (
                r.payload->>'stock_transaction_id' ~ '^[0-9]+$'
                AND (r.payload->>'stock_transaction_id')::bigint = st.id
              )
              OR (
                st.ref_type = 'PURCHASE_VERIFIED'
                AND r.status = 'completed'
                AND r.payload->>'purchase_order_id' = REPLACE(COALESCE(st.source, ''), 'PURCHASE_ORDER:', '')
                AND COALESCE(r.warehouse_id::text, r.payload->>'warehouse_id') = REPLACE(COALESCE(st.destination, ''), 'WAREHOUSE:', '')
                AND EXISTS (
                  SELECT 1
                  FROM catalog.product_barcodes pb
                  WHERE pb.id = r.product_barcode_id
                    AND pb.product_id = st.product_id
                )
              )
            )
          ORDER BY match_rank ASC, r.updated_at DESC, r.id DESC
          LIMIT 1
        ) rt ON TRUE
        LEFT JOIN LATERAL (
          SELECT ip_inner.product_barcode_id
          FROM inventory.inventory_products ip_inner
          LEFT JOIN catalog.product_barcodes pb_inner
            ON pb_inner.id = ip_inner.product_barcode_id
          WHERE pb_inner.product_id = st.product_id
            AND ip_inner.warehouse_id = CASE
              WHEN st.destination ~ '^WAREHOUSE:[0-9]+$'
              THEN REPLACE(st.destination, 'WAREHOUSE:', '')::bigint
              ELSE ip_inner.warehouse_id
            END
          ORDER BY ip_inner.updated_at DESC, ip_inner.id DESC
          LIMIT 1
        ) ip ON TRUE
        WHERE st.id = $1
        `,
        [Number(id)]
      );

      return rows[0];
    } catch (error) {
      if (error?.code !== '42P01' || !String(error?.message || '').includes('request_tracking.')) {
        throw error;
      }

      const { rows } = await query(
        `
        SELECT
          st.*,
          NULL::bigint AS request_id,
          ip.product_barcode_id
        FROM inventory.stock_transaction st
        LEFT JOIN LATERAL (
          SELECT ip_inner.product_barcode_id
          FROM inventory.inventory_products ip_inner
          LEFT JOIN catalog.product_barcodes pb_inner
            ON pb_inner.id = ip_inner.product_barcode_id
          WHERE pb_inner.product_id = st.product_id
            AND ip_inner.warehouse_id = CASE
              WHEN st.destination ~ '^WAREHOUSE:[0-9]+$'
              THEN REPLACE(st.destination, 'WAREHOUSE:', '')::bigint
              ELSE ip_inner.warehouse_id
            END
          ORDER BY ip_inner.updated_at DESC, ip_inner.id DESC
          LIMIT 1
        ) ip ON TRUE
        WHERE st.id = $1
        `,
        [Number(id)]
      );

      return rows[0];
    }
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
