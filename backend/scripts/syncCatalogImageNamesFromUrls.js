import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import pg from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config();

const { Pool } = pg;

const IMAGE_TABLE_CANDIDATES = [
  { schema: 'catalog', table: 'images' },
  { schema: 'catalogue', table: 'images' },
];
const URL_COLUMNS = ['image_url', 'url', 'image', 'firebase_url', 'download_url'];
const NAME_COLUMNS = ['file_name', 'filename', 'name', 'image_name'];

const pool = new Pool({
  connectionString: process.env.PG_CONNECTION_STRING,
  ssl: {
    rejectUnauthorized: false,
  },
});

const quoteIdentifier = (value) => `"${String(value).replaceAll('"', '""')}"`;

const firstExistingColumn = (columns, candidates) =>
  candidates.find((candidate) => columns.some((column) => column.column_name === candidate));

const getImageTable = async () => {
  for (const candidate of IMAGE_TABLE_CANDIDATES) {
    const { rows } = await pool.query(
      `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2
      ORDER BY ordinal_position
      `,
      [candidate.schema, candidate.table]
    );

    if (rows.length > 0) {
      return { ...candidate, columns: rows };
    }
  }

  throw new Error('Could not find catalog.images or catalogue.images table');
};

const filenameFromUrl = (rawUrl) => {
  if (!rawUrl) return '';

  try {
    const parsed = new URL(rawUrl);
    const firebaseMatch = parsed.pathname.match(/\/o\/([^/?#]+)/);
    const encodedPath = firebaseMatch?.[1] || parsed.pathname.split('/').filter(Boolean).pop() || '';
    const decodedPath = decodeURIComponent(encodedPath);
    return path.posix.basename(decodedPath);
  } catch {
    const cleanUrl = String(rawUrl).split(/[?#]/)[0];
    return path.posix.basename(decodeURIComponent(cleanUrl));
  }
};

const shouldReplaceName = (value) => {
  const name = String(value || '').trim();
  return !name || /^product_barcode_\d+$/i.test(name);
};

const main = async () => {
  if (!process.env.PG_CONNECTION_STRING) {
    throw new Error('PG_CONNECTION_STRING is required');
  }

  const imageTable = await getImageTable();
  const urlColumn = firstExistingColumn(imageTable.columns, URL_COLUMNS);
  const nameColumn = firstExistingColumn(imageTable.columns, NAME_COLUMNS);

  if (!urlColumn) {
    throw new Error(`No URL column found in ${imageTable.schema}.${imageTable.table}`);
  }

  if (!nameColumn) {
    throw new Error(`No filename/name column found in ${imageTable.schema}.${imageTable.table}`);
  }

  const tableName = `${quoteIdentifier(imageTable.schema)}.${quoteIdentifier(imageTable.table)}`;
  const idColumn = imageTable.columns.some((column) => column.column_name === 'id') ? 'id' : null;

  if (!idColumn) {
    throw new Error(`${imageTable.schema}.${imageTable.table} must have an id column for safe updates`);
  }

  const { rows } = await pool.query(
    `
    SELECT ${quoteIdentifier(idColumn)} AS id,
           ${quoteIdentifier(urlColumn)} AS url,
           ${quoteIdentifier(nameColumn)} AS current_name
    FROM ${tableName}
    WHERE ${quoteIdentifier(urlColumn)} IS NOT NULL
      AND btrim(${quoteIdentifier(urlColumn)}::text) <> ''
    `
  );

  let updated = 0;
  let skipped = 0;

  for (const row of rows) {
    const filename = filenameFromUrl(row.url);

    if (!filename || !shouldReplaceName(row.current_name)) {
      skipped += 1;
      continue;
    }

    await pool.query(
      `
      UPDATE ${tableName}
      SET ${quoteIdentifier(nameColumn)} = $1
      WHERE ${quoteIdentifier(idColumn)} = $2
      `,
      [filename, row.id]
    );

    updated += 1;
  }

  console.log(
    JSON.stringify(
      {
        table: `${imageTable.schema}.${imageTable.table}`,
        urlColumn,
        nameColumn,
        scanned: rows.length,
        updated,
        skipped,
      },
      null,
      2
    )
  );
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
