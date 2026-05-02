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

  const result = await query(
    `
    UPDATE catalog.product_barcodes
    SET
      product_id = $1,
      brand_id = $2,
      category_id = $3,
      unit_id = $4,
      quantity = $5,
      barcode = $6,
      mk_barcode = $7,
      updated_at = NOW()
    WHERE id = $8
    RETURNING *
    `,
    [
      req.body.product_id,
      req.body.brand_id,
      req.body.category_id,
      req.body.unit_id,
      req.body.quantity,
      req.body.barcode,
      req.body.mk_barcode,
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
    next(error);
  }
};

export const getCatalogBarcodes = async (req, res, next) => {
  try {
    const { rows } = await query(`
      SELECT
        pb.*,
        p.product_name_eng,
        p.product_code,
        b.brand_name_english,
        c.category_name_english,
        u.unit_name,
        u.unit_short_code
      FROM catalog.product_barcodes pb
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
        p.product_name_eng,
        p.product_code,
        b.brand_name_english,
        c.category_name_english,
        u.unit_name,
        u.unit_short_code
      FROM catalog.product_barcodes pb
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