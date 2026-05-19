import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import pg from 'pg';
import { getFirebaseBucket } from '../config/firebaseAdmin.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../.env') });
dotenv.config();

const { Pool } = pg;

const IMAGE_PREFIX = process.env.FIREBASE_IMAGE_PREFIX || 'webpImages/';
const IMAGE_TABLE_CANDIDATES = [
  { schema: 'catalog', table: 'images' },
  { schema: 'catalogue', table: 'images' },
];
const URL_COLUMNS = ['image_url', 'url', 'image', 'firebase_url', 'download_url'];
const PATH_COLUMNS = ['storage_path', 'file_path', 'path', 'image_path'];
const NAME_COLUMNS = ['file_name', 'filename', 'name', 'image_name'];
const TYPE_COLUMNS = ['content_type', 'mime_type', 'type'];
const SIZE_COLUMNS = ['size', 'file_size'];
const BUCKET_COLUMNS = ['bucket', 'bucket_name'];

const pool = new Pool({
  connectionString: process.env.PG_CONNECTION_STRING,
  ssl: {
    rejectUnauthorized: false,
  },
});

const quoteIdentifier = (value) => `"${String(value).replaceAll('"', '""')}"`;

const buildFirebaseDownloadUrl = (bucketName, filePath, token) =>
  `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(
    filePath
  )}?alt=media${token ? `&token=${encodeURIComponent(token)}` : ''}`;

const firstExistingColumn = (columns, candidates) =>
  candidates.find((candidate) => columns.some((column) => column.column_name === candidate));

const getImageTable = async () => {
  for (const candidate of IMAGE_TABLE_CANDIDATES) {
    const { rows } = await pool.query(
      `
      SELECT column_name, is_nullable, column_default
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

const listFirebaseImages = async () => {
  const bucket = await getFirebaseBucket();
  const [files] = await bucket.getFiles({ prefix: IMAGE_PREFIX });
  const imageFiles = [];

  for (const file of files) {
    if (file.name.endsWith('/')) continue;

    const [metadata] = await file.getMetadata();
    const contentType = metadata.contentType || '';
    const isImage = contentType.startsWith('image/') || /\.(webp|png|jpe?g|gif|avif)$/i.test(file.name);

    if (!isImage) continue;

    const token = String(metadata.metadata?.firebaseStorageDownloadTokens || '')
      .split(',')
      .map((item) => item.trim())
      .find(Boolean);

    imageFiles.push({
      url: buildFirebaseDownloadUrl(bucket.name, file.name, token),
      path: file.name,
      name: path.basename(file.name),
      contentType,
      size: metadata.size ? Number(metadata.size) : null,
      bucket: bucket.name,
    });
  }

  return imageFiles;
};

const insertMissingImages = async ({ imageTable, firebaseImages }) => {
  const columns = imageTable.columns;
  const urlColumn = firstExistingColumn(columns, URL_COLUMNS);

  if (!urlColumn) {
    throw new Error(
      `No URL column found in ${imageTable.schema}.${imageTable.table}. Expected one of: ${URL_COLUMNS.join(', ')}`
    );
  }

  const optionalColumns = {
    path: firstExistingColumn(columns, PATH_COLUMNS),
    name: firstExistingColumn(columns, NAME_COLUMNS),
    contentType: firstExistingColumn(columns, TYPE_COLUMNS),
    size: firstExistingColumn(columns, SIZE_COLUMNS),
    bucket: firstExistingColumn(columns, BUCKET_COLUMNS),
  };

  const requiredUnsupportedColumns = columns.filter(
    (column) =>
      column.is_nullable === 'NO' &&
      !column.column_default &&
      ![
        'id',
        'created_at',
        'updated_at',
        urlColumn,
        optionalColumns.path,
        optionalColumns.name,
        optionalColumns.contentType,
        optionalColumns.size,
        optionalColumns.bucket,
      ].includes(column.column_name)
  );

  if (requiredUnsupportedColumns.length > 0) {
    throw new Error(
      `Cannot insert safely. Required columns without defaults in ${imageTable.schema}.${imageTable.table}: ${requiredUnsupportedColumns
        .map((column) => column.column_name)
        .join(', ')}`
    );
  }

  const existingResult = await pool.query(
    `
    SELECT ${quoteIdentifier(urlColumn)} AS url
    FROM ${quoteIdentifier(imageTable.schema)}.${quoteIdentifier(imageTable.table)}
    WHERE ${quoteIdentifier(urlColumn)} IS NOT NULL
    `
  );
  const existingUrls = new Set(existingResult.rows.map((row) => String(row.url || '').trim()).filter(Boolean));

  let inserted = 0;
  let alreadyPresent = 0;

  for (const image of firebaseImages) {
    if (existingUrls.has(image.url)) {
      alreadyPresent += 1;
      continue;
    }

    const payload = {
      [urlColumn]: image.url,
    };

    if (optionalColumns.path) payload[optionalColumns.path] = image.path;
    if (optionalColumns.name) payload[optionalColumns.name] = image.name;
    if (optionalColumns.contentType) payload[optionalColumns.contentType] = image.contentType;
    if (optionalColumns.size) payload[optionalColumns.size] = image.size;
    if (optionalColumns.bucket) payload[optionalColumns.bucket] = image.bucket;

    const keys = Object.keys(payload).filter((key) => payload[key] !== undefined);
    const placeholders = keys.map((_, index) => `$${index + 1}`).join(', ');

    await pool.query(
      `
      INSERT INTO ${quoteIdentifier(imageTable.schema)}.${quoteIdentifier(imageTable.table)}
        (${keys.map(quoteIdentifier).join(', ')})
      VALUES (${placeholders})
      `,
      keys.map((key) => payload[key])
    );

    existingUrls.add(image.url);
    inserted += 1;
  }

  return { inserted, alreadyPresent };
};

const main = async () => {
  if (!process.env.PG_CONNECTION_STRING) {
    throw new Error('PG_CONNECTION_STRING is required');
  }

  const imageTable = await getImageTable();
  const firebaseImages = await listFirebaseImages();
  const result = await insertMissingImages({ imageTable, firebaseImages });

  console.log(
    JSON.stringify(
      {
        table: `${imageTable.schema}.${imageTable.table}`,
        firebasePrefix: IMAGE_PREFIX,
        firebaseImageCount: firebaseImages.length,
        inserted: result.inserted,
        alreadyPresent: result.alreadyPresent,
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
