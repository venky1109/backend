import { query } from '../../config/pg.js';

const IMAGE_TABLE_CANDIDATES = [
  { schema: 'catalog', table: 'images' },
  { schema: 'catalogue', table: 'images' },
];
const URL_COLUMNS = ['image_url', 'url', 'image', 'firebase_url', 'download_url'];
const NAME_COLUMNS = ['file_name', 'filename', 'name', 'image_name'];
const PATH_COLUMNS = ['storage_path', 'file_path', 'path', 'image_path'];

const quoteIdentifier = (value) => `"${String(value).replaceAll('"', '""')}"`;

const firstExistingColumn = (columns, candidates) =>
  candidates.find((candidate) => columns.includes(candidate));

const getImageTable = async () => {
  for (const candidate of IMAGE_TABLE_CANDIDATES) {
    const { rows } = await query(
      `
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2
      ORDER BY ordinal_position
      `,
      [candidate.schema, candidate.table]
    );

    if (rows.length > 0) {
      const columns = rows.map((row) => row.column_name);
      const idColumn = columns.includes('id') ? 'id' : null;
      const urlColumn = firstExistingColumn(columns, URL_COLUMNS);
      const nameColumn = firstExistingColumn(columns, NAME_COLUMNS);
      const pathColumn = firstExistingColumn(columns, PATH_COLUMNS);

      if (!urlColumn) {
        throw new Error(`No URL column found in ${candidate.schema}.${candidate.table}`);
      }

      return {
        ...candidate,
        idColumn,
        urlColumn,
        nameColumn,
        pathColumn,
      };
    }
  }

  throw new Error('Could not find catalog.images or catalogue.images table');
};

const normalizeSearch = (value) =>
  String(value || '')
    .trim()
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');

const pathFromUrl = (rawUrl) => {
  if (!rawUrl) return null;

  try {
    const parsed = new URL(rawUrl);
    const firebaseMatch = parsed.pathname.match(/\/o\/([^/?#]+)/);
    const encodedPath = firebaseMatch?.[1] || parsed.pathname.split('/').filter(Boolean).pop();
    return encodedPath ? decodeURIComponent(encodedPath) : null;
  } catch {
    return null;
  }
};

const nameFromUrl = (rawUrl) => {
  const imagePath = pathFromUrl(rawUrl);
  if (!imagePath) return null;

  return imagePath.split('/').filter(Boolean).pop() || null;
};

export const ProductImage = {
  async search({ name, limit = 20 } = {}) {
    const search = normalizeSearch(name);

    if (!search) return [];

    const imageTable = await getImageTable();
    const tableName = `${quoteIdentifier(imageTable.schema)}.${quoteIdentifier(imageTable.table)}`;
    const idSelect = imageTable.idColumn
      ? `${quoteIdentifier(imageTable.idColumn)} AS id`
      : 'NULL AS id';
    const nameSelect = imageTable.nameColumn
      ? `${quoteIdentifier(imageTable.nameColumn)} AS name`
      : 'NULL AS name';
    const pathSelect = imageTable.pathColumn
      ? `${quoteIdentifier(imageTable.pathColumn)} AS path`
      : 'NULL AS path';
    const urlExpr = quoteIdentifier(imageTable.urlColumn);
    const searchableFields = [
      imageTable.nameColumn && `COALESCE(${quoteIdentifier(imageTable.nameColumn)}::text, '')`,
      imageTable.pathColumn && `COALESCE(${quoteIdentifier(imageTable.pathColumn)}::text, '')`,
      `COALESCE(${urlExpr}::text, '')`,
    ].filter(Boolean);
    const searchableExpr = searchableFields.join(` || ' ' || `);

    const terms = search
      .split(' ')
      .map((term) => term.trim())
      .filter(Boolean)
      .slice(0, 6);
    const whereClauses = terms.map((_, index) => `${searchableExpr} ILIKE $${index + 1}`);
    const params = terms.map((term) => `%${term}%`);
    params.push(Number(limit) || 20);

    const { rows } = await query(
      `
      SELECT
        ${idSelect},
        ${nameSelect},
        ${pathSelect},
        ${urlExpr} AS url
      FROM ${tableName}
      WHERE ${urlExpr} IS NOT NULL
        AND btrim(${urlExpr}::text) <> ''
        AND ${whereClauses.join(' AND ')}
      ORDER BY
        CASE
          WHEN ${imageTable.nameColumn ? `${quoteIdentifier(imageTable.nameColumn)} ILIKE $1` : 'FALSE'} THEN 0
          ELSE 1
        END,
        ${imageTable.nameColumn ? quoteIdentifier(imageTable.nameColumn) : urlExpr}
      LIMIT $${params.length}
      `,
      params
    );

    return rows.map((row) => {
      const imagePath = row.path || pathFromUrl(row.url);
      const imageName = row.name || nameFromUrl(row.url) || imagePath || row.url;

      return {
        id: row.id,
        name: imageName,
        path: imagePath,
        url: row.url,
        imageUrl: row.url,
        label: imageName,
      };
    });
  },
};
