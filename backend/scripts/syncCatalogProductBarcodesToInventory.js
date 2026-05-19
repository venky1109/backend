import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config();

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.PG_CONNECTION_STRING,
  ssl: {
    rejectUnauthorized: false,
  },
});

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');

const textOrNull = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
};

const numberOrNull = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const makeSkuId = (productBarcodeId) => `CATALOG-PB-${productBarcodeId}`;

const catalogRowsSql = `
  SELECT
    pb.id AS product_barcode_id,
    pb.product_id,
    pb.brand_id,
    pb.category_id,
    pb.unit_id,
    pb.quantity,
    pb.barcode,
    pb.mk_barcode,
    p.product_code,
    COALESCE(p.product_name_eng, p.product_name_tel, p.product_code) AS product_name,
    p.hsncode AS hsn_code
  FROM catalog.product_barcodes pb
  JOIN catalog.products p
    ON p.id = pb.product_id
  WHERE COALESCE(pb.is_active, true) = true
  ORDER BY pb.id
`;

const updateInventoryRows = async (client, row) => {
  const result = await client.query(
    `
    UPDATE inventory.inventory_products
    SET
      product_code = $2,
      product_name = $3,
      hsn_code = $4,
      bar_code = $5,
      category_id = $6,
      brand_id = $7,
      unit_id = $8,
      updated_at = NOW()
    WHERE product_barcode_id = $1
    RETURNING id
    `,
    [
      numberOrNull(row.product_barcode_id),
      textOrNull(row.product_code),
      textOrNull(row.product_name),
      textOrNull(row.hsn_code),
      textOrNull(row.mk_barcode) || textOrNull(row.barcode),
      numberOrNull(row.category_id),
      numberOrNull(row.brand_id),
      numberOrNull(row.unit_id),
    ]
  );

  return result.rowCount;
};

const insertInventoryPlaceholder = async (client, row) => {
  const result = await client.query(
    `
    INSERT INTO inventory.inventory_products (
      product_barcode_id,
      product_code,
      product_name,
      sku_id,
      hsn_code,
      bar_code,
      category_id,
      brand_id,
      count_in_stock,
      no_of_units,
      business_entity_type,
      unit_id,
      purchase_qty,
      unit_price,
      verified_by,
      verified_by_name,
      remarks
    )
    VALUES (
      $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
      $11,$12,$13,$14,$15,$16,$17
    )
    RETURNING id
    `,
    [
      numberOrNull(row.product_barcode_id),
      textOrNull(row.product_code),
      textOrNull(row.product_name),
      makeSkuId(row.product_barcode_id),
      textOrNull(row.hsn_code),
      textOrNull(row.mk_barcode) || textOrNull(row.barcode),
      numberOrNull(row.category_id),
      numberOrNull(row.brand_id),
      0,
      0,
      'WAREHOUSE',
      numberOrNull(row.unit_id),
      0,
      0,
      'CATALOG_MIGRATION',
      'CATALOG_MIGRATION',
      'Created from catalog.product_barcodes for inventory scan/search migration',
    ]
  );

  return result.rows[0];
};

const syncInventoryProducts = async () => {
  if (!process.env.PG_CONNECTION_STRING) {
    throw new Error('PG_CONNECTION_STRING is required');
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { rows } = await client.query(catalogRowsSql);

    let updatedRows = 0;
    let insertedRows = 0;
    const missingBarcodeRows = [];

    for (const row of rows) {
      if (!textOrNull(row.mk_barcode) && !textOrNull(row.barcode)) {
        missingBarcodeRows.push(row.product_barcode_id);
      }

      const updatedCount = await updateInventoryRows(client, row);
      updatedRows += updatedCount;

      if (updatedCount === 0) {
        await insertInventoryPlaceholder(client, row);
        insertedRows += 1;
      }
    }

    if (dryRun) {
      await client.query('ROLLBACK');
    } else {
      await client.query('COMMIT');
    }

    return {
      catalogRows: rows.length,
      updatedRows,
      insertedRows,
      missingBarcodeRows,
      dryRun,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

syncInventoryProducts()
  .then((result) => {
    console.log(
      `${result.dryRun ? 'Dry run: ' : ''}Synced ${result.catalogRows} catalog barcode rows to inventory. Updated ${result.updatedRows}, inserted ${result.insertedRows}.`
    );

    if (result.missingBarcodeRows.length) {
      console.log(
        `Rows without mk_barcode/barcode: ${result.missingBarcodeRows.join(', ')}`
      );
    }
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
