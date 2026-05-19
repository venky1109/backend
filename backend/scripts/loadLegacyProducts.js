import fs from 'fs/promises';
import { getClient } from '../config/pg.js';

const inputIndex = process.argv.findIndex((arg) => arg === '--input');
const inputPath = inputIndex >= 0 ? process.argv[inputIndex + 1] : null;

if (!inputPath) {
  throw new Error('Usage: node backend/scripts/loadLegacyProducts.js --input <rows.json>');
}

const toNumber = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const toText = (value) => {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
};

const createTableSql = `
  CREATE TABLE IF NOT EXISTS legacy_products (
    id BIGSERIAL PRIMARY KEY,
    source_sheet TEXT NOT NULL,
    source_row INTEGER NOT NULL,
    product_id TEXT,
    name TEXT,
    slug TEXT,
    category TEXT,
    detail_id TEXT,
    brand TEXT,
    description TEXT,
    financial_id TEXT,
    image_id TEXT,
    price NUMERIC,
    dprice NUMERIC,
    discount NUMERIC,
    quantity NUMERIC,
    units TEXT,
    count_in_stock NUMERIC,
    rating NUMERIC,
    num_reviews NUMERIC,
    rating_variant NUMERIC,
    num_reviews_variant NUMERIC,
    barcode TEXT,
    image_url TEXT,
    raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;

const createIndexesSql = [
  'CREATE INDEX IF NOT EXISTS legacy_products_name_idx ON legacy_products (name)',
  'CREATE INDEX IF NOT EXISTS legacy_products_barcode_idx ON legacy_products (barcode)',
  'CREATE INDEX IF NOT EXISTS legacy_products_product_id_idx ON legacy_products (product_id)',
  'CREATE INDEX IF NOT EXISTS legacy_products_source_sheet_idx ON legacy_products (source_sheet)',
];

const readRows = async () => {
  const content = await fs.readFile(inputPath, 'utf8');
  const rows = JSON.parse(content);

  if (!Array.isArray(rows)) {
    throw new Error('Input file must contain a JSON array');
  }

  return rows;
};

const insertSql = `
  INSERT INTO legacy_products (
    source_sheet,
    source_row,
    product_id,
    name,
    slug,
    category,
    detail_id,
    brand,
    description,
    financial_id,
    image_id,
    price,
    dprice,
    discount,
    quantity,
    units,
    count_in_stock,
    rating,
    num_reviews,
    rating_variant,
    num_reviews_variant,
    barcode,
    image_url,
    raw_data
  )
  VALUES (
    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
    $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
    $21,$22,$23,$24
  )
`;

const main = async () => {
  const rows = await readRows();
  const client = await getClient();

  try {
    await client.query('BEGIN');
    await client.query(createTableSql);

    for (const sql of createIndexesSql) {
      await client.query(sql);
    }

    await client.query('TRUNCATE TABLE legacy_products RESTART IDENTITY');

    for (const row of rows) {
      await client.query(insertSql, [
        toText(row.source_sheet),
        Number(row.source_row),
        toText(row.product_id),
        toText(row.name),
        toText(row.slug),
        toText(row.category),
        toText(row.detail_id),
        toText(row.brand),
        toText(row.description),
        toText(row.financial_id),
        toText(row.image_id),
        toNumber(row.price),
        toNumber(row.dprice),
        toNumber(row.discount),
        toNumber(row.quantity),
        toText(row.units),
        toNumber(row.count_in_stock),
        toNumber(row.rating),
        toNumber(row.num_reviews),
        toNumber(row.rating_variant),
        toNumber(row.num_reviews_variant),
        toText(row.barcode),
        toText(row.image_url),
        JSON.stringify(row.raw_data || {}),
      ]);
    }

    await client.query('COMMIT');
    console.log(`Loaded ${rows.length} rows into legacy_products`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
