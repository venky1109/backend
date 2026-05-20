import { query } from '../../config/pg.js';
import asyncHandler from 'express-async-handler';
const pad = (num, size) => String(num).padStart(size, '0');

const validateBarcodeParts = ({
  product_id,
  brand_id,
  category_id,
  unit_id,
  quantity,
}) => {
  if (Number(product_id) > 9999) throw new Error('product_id exceeds 4 digits');
  if (Number(brand_id) > 999) throw new Error('brand_id exceeds 3 digits');
  if (Number(category_id) > 99) throw new Error('category_id exceeds 2 digits');
  if (Number(unit_id) > 99) throw new Error('unit_id exceeds 2 digits');
  if (Number(quantity) > 999) throw new Error('quantity exceeds 3 digits');
};

export const makeMkBarcode = ({
  product_id,
  brand_id,
  category_id,
  unit_id,
  quantity,
}) => {
  validateBarcodeParts({
    product_id,
    brand_id,
    category_id,
    unit_id,
    quantity,
  });

  return (
    '890' +
    pad(product_id, 4) +
    pad(brand_id, 3) +
    pad(category_id, 2) +
    pad(unit_id, 2) +
    pad(quantity, 3)
  );
};

export const decodeMkBarcode = (code) => {
  if (!code || code.length !== 17 || !code.startsWith('890')) {
    throw new Error('Invalid MK barcode');
  }

  return {
    product_id: Number(code.substring(3, 7)),
    brand_id: Number(code.substring(7, 10)),
    category_id: Number(code.substring(10, 12)),
    unit_id: Number(code.substring(12, 14)),
    quantity: Number(code.substring(14, 17)),
  };
};
export const updateCatalogBarcode = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const allowedFields = [
    'product_id',
    'brand_id',
    'category_id',
    'unit_id',
    'quantity',
    'barcode',
    'mk_barcode',
    'image_url',
  ];

  const updates = allowedFields.filter((field) =>
    Object.prototype.hasOwnProperty.call(req.body, field)
  );

  if (!updates.length) {
    res.status(400);
    throw new Error('No valid product barcode fields provided');
  }

  const setClause = updates
    .map((field, index) => `${field} = $${index + 1}`)
    .join(',\n      ');
  const values = updates.map((field) => req.body[field]);

  const result = await query(
    `
    UPDATE catalog.product_barcodes
    SET
      ${setClause},
      updated_at = NOW()
    WHERE id = $${values.length + 1}
    RETURNING *
    `,
    [
      ...values,
      id,
    ]
  );

  if (!result.rows[0]) {
    res.status(404);
    throw new Error('Product barcode not found');
  }

  res.json(result.rows[0]);
});

export const deleteCatalogBarcode = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const result = await query(
    `
    DELETE FROM catalog.product_barcodes
    WHERE id = $1
    RETURNING *
    `,
    [id]
  );

  if (!result.rows[0]) {
    res.status(404);
    throw new Error('Product barcode not found');
  }

  res.json({ message: 'Product barcode deleted successfully' });
});
export const createCatalogBarcode = async (req, res, next) => {
  try {
    const {
      product_id,
      brand_id,
      category_id,
      unit_id,
      quantity = 1,
      barcode = null,
    } = req.body;

    if (!product_id || !brand_id || !category_id || !unit_id || !quantity) {
      return res.status(400).json({
        message:
          'product_id, brand_id, category_id, unit_id and quantity are required',
      });
    }

    const mk_barcode = makeMkBarcode({
      product_id: Number(product_id),
      brand_id: Number(brand_id),
      category_id: Number(category_id),
      unit_id: Number(unit_id),
      quantity: Number(quantity),
    });

    const existing = await query(
      `
      SELECT *
      FROM catalog.product_barcodes
      WHERE mk_barcode = $1
         OR (
          product_id = $2
          AND brand_id = $3
          AND category_id = $4
          AND unit_id = $5
          AND quantity = $6
        )
      ORDER BY
        CASE WHEN mk_barcode = $1 THEN 0 ELSE 1 END,
        id DESC
      LIMIT 1
      `,
      [
        mk_barcode,
        Number(product_id),
        Number(brand_id),
        Number(category_id),
        Number(unit_id),
        Number(quantity),
      ]
    );

    if (existing.rows[0]) {
      return res.status(200).json({
        ...existing.rows[0],
        already_exists: true,
      });
    }

    const { rows } = await query(
      `
      INSERT INTO catalog.product_barcodes
        (product_id, brand_id, category_id, unit_id, quantity, barcode, mk_barcode)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (product_id, brand_id, category_id, unit_id, quantity)
      DO UPDATE SET
        barcode = EXCLUDED.barcode,
        mk_barcode = EXCLUDED.mk_barcode,
        is_active = TRUE,
        updated_at = now()
      RETURNING *
      `,
      [
        Number(product_id),
        Number(brand_id),
        Number(category_id),
        Number(unit_id),
        Number(quantity),
        barcode,
        mk_barcode,
      ]
    );

    res.status(201).json(rows[0]);
  } catch (error) {
    if (error?.code === '23505') {
      try {
        const duplicateMkBarcode = req.body.mk_barcode || makeMkBarcode({
          product_id: Number(req.body.product_id),
          brand_id: Number(req.body.brand_id),
          category_id: Number(req.body.category_id),
          unit_id: Number(req.body.unit_id),
          quantity: Number(req.body.quantity || 1),
        });

        const existing = await query(
          `
          SELECT *
          FROM catalog.product_barcodes
          WHERE mk_barcode = $1
             OR (
              product_id = $2
              AND brand_id = $3
              AND category_id = $4
              AND unit_id = $5
              AND quantity = $6
            )
          ORDER BY id DESC
          LIMIT 1
          `,
          [
            error?.detail?.match(/\((?:mk_barcode)\)=\(([^)]+)\)/)?.[1] ||
              duplicateMkBarcode,
            Number(req.body.product_id),
            Number(req.body.brand_id),
            Number(req.body.category_id),
            Number(req.body.unit_id),
            Number(req.body.quantity || 1),
          ]
        );

        if (existing.rows[0]) {
          return res.status(200).json({
            ...existing.rows[0],
            already_exists: true,
          });
        }
      } catch (_lookupError) {
        // Keep the original duplicate-key error if lookup also fails.
      }
    }

    next(error);
  }
};

export const getCatalogBarcodes = async (req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT
        pb.*,
        pbr.mkid,
        p.product_name_eng,
        p.product_code,
        b.brand_name_english,
        c.category_name_english,
        u.unit_name,
        u.unit_short_code
      FROM catalog.product_barcodes pb
      LEFT JOIN (
        SELECT
          pb_inner.id,
          ROW_NUMBER() OVER (
            ORDER BY
              COALESCE(c_inner.category_name_english, c_inner.category_name_telugu, ''),
              COALESCE(p_inner.product_name_eng, p_inner.product_name_tel, p_inner.product_code, ''),
              COALESCE(b_inner.brand_name_english, b_inner.brand_name_telugu, ''),
              COALESCE(pb_inner.quantity, 0),
              COALESCE(u_inner.unit_short_code, u_inner.unit_name, ''),
              pb_inner.id
          ) AS mkid
        FROM catalog.product_barcodes pb_inner
        LEFT JOIN catalog.products p_inner ON p_inner.id = pb_inner.product_id
        LEFT JOIN catalog.brands b_inner ON b_inner.id = pb_inner.brand_id
        LEFT JOIN catalog.categories c_inner ON c_inner.id = pb_inner.category_id
        LEFT JOIN catalog.units u_inner ON u_inner.id = pb_inner.unit_id
      ) pbr ON pbr.id = pb.id
      LEFT JOIN catalog.products p ON p.id = pb.product_id
      LEFT JOIN catalog.brands b ON b.id = pb.brand_id
      LEFT JOIN catalog.categories c ON c.id = pb.category_id
      LEFT JOIN catalog.units u ON u.id = pb.unit_id
      ORDER BY pb.id DESC
    `);

    res.json(rows);
  } catch (error) {
    next(error);
  }
};

export const getCatalogBarcodeByCode = async (req, res, next) => {
  try {
    const { code } = req.params;

    const { rows } = await query(
      `
      SELECT
        pb.*,
        pbr.mkid,
        p.product_name_eng,
        p.product_code,
        b.brand_name_english,
        c.category_name_english,
        u.unit_name,
        u.unit_short_code
      FROM catalog.product_barcodes pb
      LEFT JOIN (
        SELECT
          pb_inner.id,
          ROW_NUMBER() OVER (
            ORDER BY
              COALESCE(c_inner.category_name_english, c_inner.category_name_telugu, ''),
              COALESCE(p_inner.product_name_eng, p_inner.product_name_tel, p_inner.product_code, ''),
              COALESCE(b_inner.brand_name_english, b_inner.brand_name_telugu, ''),
              COALESCE(pb_inner.quantity, 0),
              COALESCE(u_inner.unit_short_code, u_inner.unit_name, ''),
              pb_inner.id
          ) AS mkid
        FROM catalog.product_barcodes pb_inner
        LEFT JOIN catalog.products p_inner ON p_inner.id = pb_inner.product_id
        LEFT JOIN catalog.brands b_inner ON b_inner.id = pb_inner.brand_id
        LEFT JOIN catalog.categories c_inner ON c_inner.id = pb_inner.category_id
        LEFT JOIN catalog.units u_inner ON u_inner.id = pb_inner.unit_id
      ) pbr ON pbr.id = pb.id
      LEFT JOIN catalog.products p ON p.id = pb.product_id
      LEFT JOIN catalog.brands b ON b.id = pb.brand_id
      LEFT JOIN catalog.categories c ON c.id = pb.category_id
      LEFT JOIN catalog.units u ON u.id = pb.unit_id
      WHERE pb.mk_barcode = $1 OR pb.barcode = $1
      LIMIT 1
      `,
      [code]
    );

    if (!rows[0]) {
      return res.status(404).json({ message: 'Barcode not found' });
    }

    res.json(rows[0]);
  } catch (error) {
    next(error);
  }
};
