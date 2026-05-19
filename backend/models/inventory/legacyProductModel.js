import { query } from '../../config/pg.js';

const normalizeSearch = (value) =>
  String(value || '')
    .trim()
    .replace(/\s+/g, ' ');

const toLimit = (value) => {
  const limit = Number(value || 20);
  if (!Number.isFinite(limit) || limit <= 0) return 20;
  return Math.min(limit, 50);
};

export const LegacyProduct = {
  async search({ query: searchQuery, name, barcode, limit = 20 } = {}) {
    const search = normalizeSearch(searchQuery || name || barcode);

    if (!search) return [];

    const terms = search
      .split(' ')
      .map((term) => term.trim())
      .filter(Boolean)
      .slice(0, 6);

    const searchableExpr = `
      COALESCE(name, '') || ' ' ||
      COALESCE(slug, '') || ' ' ||
      COALESCE(category, '') || ' ' ||
      COALESCE(brand, '') || ' ' ||
      COALESCE(barcode, '') || ' ' ||
      COALESCE(description, '')
    `;
    const whereClauses = terms.map((_, index) => `${searchableExpr} ILIKE $${index + 3}`);
    const params = [search, `${search}%`, ...terms.map((term) => `%${term}%`)];
    params.push(toLimit(limit));

    const { rows } = await query(
      `
      SELECT
        id,
        source_sheet,
        source_row,
        product_id,
        detail_id,
        financial_id,
        image_id,
        name,
        slug,
        category,
        brand,
        description,
        price,
        dprice,
        discount,
        quantity,
        units,
        count_in_stock,
        barcode,
        image_url,
        raw_data
      FROM legacy_products
      WHERE ${whereClauses.join(' AND ')}
      ORDER BY
        CASE
          WHEN barcode = $1 THEN 0
          WHEN name ILIKE $1 THEN 1
          WHEN name ILIKE $2 THEN 2
          ELSE 3
        END,
        source_sheet,
        name NULLS LAST,
        id
      LIMIT $${params.length}
      `,
      params
    );

    return rows.map((row) => ({
      ...row,
      label: row.name || row.slug || row.barcode || row.product_id,
      value: row.id,
    }));
  },
};
