
import Product from '../models/productModel.js';
import mongoose from 'mongoose';
import { query as pgQuery } from '../config/pg.js';

export const createPOSProductFromCatalog = async (req, res) => {
  try {
    const { productId, brand, description, image, financial } = req.body;

    const catalogProduct = await Product.findById(productId);
    if (!catalogProduct) return res.status(404).json({ error: 'Catalog product not found' });

    const newProduct = new Product({
      _id: new mongoose.Types.ObjectId(),
      name: catalogProduct.name,
      slug: `${catalogProduct.slug}-${Date.now()}`, // unique slug
      category: catalogProduct.category,
      details: [
        {
          _id: new mongoose.Types.ObjectId(),
          brand,
          description,
          images: image ? [{ _id: new mongoose.Types.ObjectId(), image }] : [],
          financials: [
            {
              _id: new mongoose.Types.ObjectId(),
              ...financial
            }
          ]
        }
      ]
    });

    await newProduct.save();
    res.status(201).json({ message: 'POS Product created from catalog', product: newProduct });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to create POS product', details: err.message });
  }
};


// @desc Add financial variant to existing POS product
export const addFinancialToPOSProduct = async (req, res) => {
  try {
    const { productId, detailId, financial } = req.body;

    if (!productId || !detailId || !financial)
      return res.status(400).json({ error: 'Missing required fields' });

    const product = await Product.findById(productId);
    if (!product) return res.status(404).json({ error: 'Product not found' });

    const detail = product.details.id(detailId);
    if (!detail) return res.status(404).json({ error: 'Detail not found' });

    const newFinancial = {
      _id: new mongoose.Types.ObjectId(),
      ...financial,
    };

    detail.financials.push(newFinancial);
    await product.save();

    res.status(200).json({
      message: 'Financial variant added',
      financial: newFinancial,
      detailId: detail._id,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to add financial variant' });
  }
};

// @desc Update financial variant in POS product
export const updatePOSProductFinancial = async (req, res) => {
  try {
    const { productId, detailId, financialId, updateFields } = req.body;
    // console.log('123'+JSON.stringify(req.body))

    if (!productId || !detailId || !financialId || !updateFields)
      return res.status(400).json({ error: 'Missing required fields' });

    const product = await Product.findById(productId);
    if (!product) return res.status(404).json({ error: 'Product not found' });

    const detail = product.details.id(detailId);
    if (!detail) return res.status(404).json({ error: 'Detail not found' });

    const financial = detail.financials.id(financialId);
    if (!financial) return res.status(404).json({ error: 'Financial variant not found' });

    // console.log(financial)

    Object.assign(financial, updateFields);
    await product.save();

    res.status(200).json({
      message: 'Financial updated',
      financial,
      detailId: detail._id,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to update financial' });
  }
};

const sameText = (left, right) =>
  String(left || '').trim().toLowerCase() === String(right || '').trim().toLowerCase();

const numberOrBlank = (value) => {
  if (value === undefined || value === null || Number.isNaN(Number(value))) return '';
  return String(value);
};

const textOrBlank = (value) => String(value || '').trim();

const padCodePart = (value, size) => String(Number(value || 0)).padStart(size, '0');

const makeMkBarcode = ({
  product_id,
  brand_id,
  category_id,
  unit_id,
  quantity,
}) =>
  '890' +
  padCodePart(product_id, 4) +
  padCodePart(brand_id, 3) +
  padCodePart(category_id, 2) +
  padCodePart(unit_id, 2) +
  padCodePart(parseInt(quantity || 0, 10), 3);

const buildMkBarcodePreview = ({ productId, brandId, categoryId, unitId, quantity, currentMkBarcode = '' }) => {
  if (!productId || !brandId || !categoryId || !unitId) {
    return {
      expectedMkBarcode: '',
      currentMkBarcode: textOrBlank(currentMkBarcode),
      mismatch: false,
      canGenerate: false,
      message: 'Product, brand, category, unit and quantity are required to generate MK barcode.',
    };
  }

  const expectedMkBarcode = makeMkBarcode({
    product_id: Number(productId),
    brand_id: Number(brandId),
    category_id: Number(categoryId),
    unit_id: Number(unitId),
    quantity: Number(quantity || 0),
  });
  const current = textOrBlank(currentMkBarcode);

  return {
    expectedMkBarcode,
    currentMkBarcode: current,
    mismatch: Boolean(current && current !== expectedMkBarcode),
    canGenerate: true,
    message: current && current !== expectedMkBarcode
      ? 'MK barcode mismatch. You can overwrite with expected barcode.'
      : 'MK barcode is ready.',
  };
};

const makeCatalogCode = (prefix, value) => {
  const compact = textOrBlank(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 36);
  return `${prefix}_${compact || Date.now()}`;
};

const findOrCreateCatalogCategory = async (categoryName) => {
  const name = textOrBlank(categoryName) || 'Migration';
  const existing = await pgQuery(
    `
    SELECT *
    FROM catalog.categories
    WHERE lower(trim(category_name_english)) = lower(trim($1))
       OR lower(trim(category_name_telugu)) = lower(trim($1))
    ORDER BY id ASC
    LIMIT 1
    `,
    [name]
  );
  if (existing.rows[0]) return existing.rows[0];

  const inserted = await pgQuery(
    `
    INSERT INTO catalog.categories (category_code, category_name_english, category_name_telugu)
    VALUES ($1, $2, $3)
    RETURNING *
    `,
    [makeCatalogCode('CAT', name), name, name]
  );
  return inserted.rows[0];
};

const findOrCreateCatalogBrand = async (brandName) => {
  const name = textOrBlank(brandName) || 'Migration';
  const existing = await pgQuery(
    `
    SELECT *
    FROM catalog.brands
    WHERE lower(trim(brand_name_english)) = lower(trim($1))
       OR lower(trim(brand_name_telugu)) = lower(trim($1))
    ORDER BY id ASC
    LIMIT 1
    `,
    [name]
  );
  if (existing.rows[0]) return existing.rows[0];

  const inserted = await pgQuery(
    `
    INSERT INTO catalog.brands (brand_code, brand_name_english, brand_name_telugu)
    VALUES ($1, $2, $3)
    RETURNING *
    `,
    [makeCatalogCode('BR', name), name, name]
  );
  return inserted.rows[0];
};

const findOrCreateCatalogUnit = async (unitValue) => {
  const unit = textOrBlank(unitValue) || 'QTY';
  const existing = await pgQuery(
    `
    SELECT *
    FROM catalog.units
    WHERE lower(trim(unit_short_code)) = lower(trim($1))
       OR lower(trim(unit_name)) = lower(trim($1))
    ORDER BY id ASC
    LIMIT 1
    `,
    [unit]
  );
  if (existing.rows[0]) return existing.rows[0];

  const inserted = await pgQuery(
    `
    INSERT INTO catalog.units (unit_code, unit_name, unit_short_code)
    VALUES ($1, $2, $3)
    RETURNING *
    `,
    [makeCatalogCode('UNIT', unit), unit, unit]
  );
  return inserted.rows[0];
};

const findCatalogUnit = async (unitValue) => {
  const unit = textOrBlank(unitValue);
  if (!unit) return null;

  const existing = await pgQuery(
    `
    SELECT *
    FROM catalog.units
    WHERE lower(trim(unit_short_code)) = lower(trim($1))
       OR lower(trim(unit_name)) = lower(trim($1))
    ORDER BY id ASC
    LIMIT 1
    `,
    [unit]
  );

  return existing.rows[0] || null;
};

const findCatalogCategory = async (categoryName) => {
  const name = textOrBlank(categoryName);
  if (!name) return null;

  const existing = await pgQuery(
    `
    SELECT *
    FROM catalog.categories
    WHERE lower(trim(category_name_english)) = lower(trim($1))
       OR lower(trim(category_name_telugu)) = lower(trim($1))
    ORDER BY id ASC
    LIMIT 1
    `,
    [name]
  );

  return existing.rows[0] || null;
};

const findCatalogBrand = async (brandName) => {
  const name = textOrBlank(brandName);
  if (!name) return null;

  const existing = await pgQuery(
    `
    SELECT *
    FROM catalog.brands
    WHERE lower(trim(brand_name_english)) = lower(trim($1))
       OR lower(trim(brand_name_telugu)) = lower(trim($1))
    ORDER BY id ASC
    LIMIT 1
    `,
    [name]
  );

  return existing.rows[0] || null;
};

const findCatalogProduct = async (productName) => {
  const name = textOrBlank(productName);
  if (!name) return null;

  const existing = await pgQuery(
    `
    SELECT *
    FROM catalog.products
    WHERE lower(trim(product_name_eng)) = lower(trim($1))
       OR lower(trim(product_name_tel)) = lower(trim($1))
    ORDER BY id ASC
    LIMIT 1
    `,
    [name]
  );

  return existing.rows[0] || null;
};

const findOrCreateCatalogProduct = async (productData, categoryRow) => {
  const name = textOrBlank(productData.name || productData.productname || productData.englishname);
  const productName = name || 'Migration Product';
  const existing = await pgQuery(
    `
    SELECT *
    FROM catalog.products
    WHERE lower(trim(product_name_eng)) = lower(trim($1))
       OR lower(trim(product_name_tel)) = lower(trim($1))
    ORDER BY id ASC
    LIMIT 1
    `,
    [productName]
  );
  if (existing.rows[0]) return existing.rows[0];

  const inserted = await pgQuery(
    `
    INSERT INTO catalog.products
      (product_code, product_name_eng, product_name_tel, hsncode, gst_rate)
    VALUES
      ($1, $2, $3, $4, $5)
    RETURNING *
    `,
    [
      makeCatalogCode('PRD', productName),
      productName,
      textOrBlank(productData.teluguname) || productName,
      textOrBlank(productData.hsncode || productData.hsn),
      Number(productData.gst || categoryRow?.gst_rate || 0),
    ]
  );
  return inserted.rows[0];
};

export const previewBarcodeAssignerMkBarcode = async (req, res) => {
  try {
    const {
      productData = {},
      detailData = {},
      financialData = {},
    } = req.body || {};

    const catalogProductBarcodeId = Number(
      financialData.catalogProductBarcodeId ||
      financialData.product_barcode_id ||
      financialData.mkid
    );

    if (Number.isInteger(catalogProductBarcodeId) && catalogProductBarcodeId > 0) {
      const { rows } = await pgQuery(
        `
        SELECT
          pb.id,
          pb.product_id,
          pb.brand_id,
          pb.category_id,
          pb.unit_id,
          pb.quantity,
          pb.mk_barcode
        FROM catalog.product_barcodes pb
        WHERE pb.id = $1
        LIMIT 1
        `,
        [catalogProductBarcodeId]
      );

      if (!rows[0]) {
        return res.status(404).json({ error: 'Catalog product barcode row not found' });
      }

      const row = rows[0];
      return res.json({
        catalogProductBarcodeId: row.id,
        ...buildMkBarcodePreview({
          productId: row.product_id,
          brandId: row.brand_id,
          categoryId: row.category_id,
          unitId: row.unit_id,
          quantity: financialData.quantity ?? row.quantity,
          currentMkBarcode: financialData.mk_barcode || row.mk_barcode,
        }),
      });
    }

    const [product, category, brand, unit] = await Promise.all([
      productData.catalogProductId ? null : findCatalogProduct(productData.name || productData.productname || productData.englishname),
      productData.catalogCategoryId ? null : findCatalogCategory(productData.category),
      detailData.catalogBrandId ? null : findCatalogBrand(detailData.brand),
      findCatalogUnit(financialData.units),
    ]);
    const productId = productData.catalogProductId || product?.id;
    const categoryId = productData.catalogCategoryId || category?.id;
    const brandId = detailData.catalogBrandId || brand?.id;
    const quantity = Number(financialData.quantity || 0);

    if (!productId || !categoryId || !brandId || !unit?.id || !quantity) {
      return res.json({
        expectedMkBarcode: '',
        currentMkBarcode: textOrBlank(financialData.mk_barcode),
        mismatch: false,
        canGenerate: false,
        message: 'Product name, category, brand, quantity and units must match catalog before generating MK barcode.',
        resolved: {
          productId: productId || '',
          categoryId: categoryId || '',
          brandId: brandId || '',
          unitId: unit?.id || '',
          quantity: quantity || '',
        },
      });
    }

    const preview = buildMkBarcodePreview({
      productId,
      brandId,
      categoryId,
      unitId: unit.id,
      quantity,
      currentMkBarcode: financialData.mk_barcode,
    });

    return res.json({
      ...preview,
      catalogProductId: productId || '',
      catalogCategoryId: categoryId || '',
      catalogBrandId: brandId || '',
      catalogUnitId: unit.id || '',
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to preview MK barcode', details: err.message });
  }
};

const ensureCatalogBarcodeForAssignment = async ({
  productData,
  detailData,
  financialData,
  cleanBarcode,
}) => {
  if (financialData.catalogProductBarcodeId) {
    return {
      productId: productData.catalogProductId,
      categoryId: productData.catalogCategoryId,
      brandId: detailData.catalogBrandId,
      barcodeId: financialData.catalogProductBarcodeId,
    };
  }

  const category = await findOrCreateCatalogCategory(productData.category);
  const product = await findOrCreateCatalogProduct(productData, category);
  const brand = await findOrCreateCatalogBrand(detailData.brand);
  const unit = await findOrCreateCatalogUnit(financialData.units);
  const resolvedMkBarcode = textOrBlank(financialData.mk_barcode) || makeMkBarcode({
    product_id: Number(product.id),
    brand_id: Number(brand.id),
    category_id: Number(category.id),
    unit_id: Number(unit.id),
    quantity: Number(financialData.quantity || 0),
  });
  const vendorBarcode = cleanBarcode.find((item) => item !== resolvedMkBarcode) || cleanBarcode[0] || null;

  const existing = await pgQuery(
    `
    SELECT *
    FROM catalog.product_barcodes
    WHERE product_id = $1
      AND brand_id = $2
      AND category_id = $3
      AND unit_id = $4
      AND quantity = $5
    ORDER BY id ASC
    LIMIT 1
    `,
    [
      Number(product.id),
      Number(brand.id),
      Number(category.id),
      Number(unit.id),
      Number(financialData.quantity || 0),
    ]
  );

  let barcode = existing.rows[0];
  if (barcode) {
    const updated = await pgQuery(
      `
      UPDATE catalog.product_barcodes
      SET
        barcode = COALESCE($2, barcode),
        mk_barcode = COALESCE($3, mk_barcode),
        image_url = COALESCE($4, image_url),
        is_active = TRUE,
        updated_at = now()
      WHERE id = $1
      RETURNING *
      `,
      [barcode.id, vendorBarcode, resolvedMkBarcode || null, detailData.image || null]
    );
    barcode = updated.rows[0];
  } else {
    const inserted = await pgQuery(
      `
      INSERT INTO catalog.product_barcodes
        (product_id, brand_id, category_id, unit_id, quantity, barcode, mk_barcode, image_url)
      VALUES
        ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
      `,
      [
        Number(product.id),
        Number(brand.id),
        Number(category.id),
        Number(unit.id),
        Number(financialData.quantity || 0),
        vendorBarcode,
        resolvedMkBarcode || null,
        detailData.image || null,
      ]
    );
    barcode = inserted.rows[0];
  }

  await pgQuery(
    `
    UPDATE catalog.rate_plans
    SET gst_rate = $2, updated_at = now()
    WHERE product_barcode_id = $1
      AND lower(rate_for) = 'customer'
    `,
    [barcode.id, Number(productData.gst || 0)]
  );

  await pgQuery(
    `
    INSERT INTO catalog.rate_plans (product_barcode_id, rate_for, gst_rate)
    SELECT $1, 'customer', $2
    WHERE NOT EXISTS (
      SELECT 1
      FROM catalog.rate_plans
      WHERE product_barcode_id = $1
        AND lower(rate_for) = 'customer'
    )
    `,
    [barcode.id, Number(productData.gst || 0)]
  );

  return {
    productId: product.id,
    categoryId: category.id,
    brandId: brand.id,
    barcodeId: barcode.id,
    mkBarcode: barcode.mk_barcode || resolvedMkBarcode,
  };
};

const mapCatalogAssignerRow = (row) => {
  const mrp = row.mrp_amount ?? row.price ?? row.expected_unit_price ?? '';
  const dprice = row.selling_price ?? row.dprice ?? row.expected_unit_price ?? mrp;

  return {
    source: 'catalog',
    id: row.id,
    productBarcodeId: row.id,
    catalogProductBarcodeId: row.id,
    mkid: row.id,
    mk_barcode: row.mk_barcode || '',
    barcode: row.barcode || '',
    productName: row.product_name_eng || row.product_name_tel || '',
    category: row.category_name_english || row.category_name_telugu || '',
    brand: row.brand_name_english || row.brand_name_telugu || '',
    description: row.description || '',
    hsncode: row.hsncode || '',
    gst: row.gst_rate ?? row.rate_gst_rate ?? 0,
    imageUrl: row.image_url || '',
    catalogProductId: row.product_id,
    catalogCategoryId: row.category_id,
    catalogBrandId: row.brand_id,
    unitId: row.unit_id,
    units: row.unit_short_code || row.unit_name || 'QTY',
    quantity: row.quantity ?? '',
    countInStock: row.count_in_stock ?? row.countInStock ?? '',
    price: mrp,
    dprice,
    mfg_date: row.mfg_date || '',
    exp_date: row.exp_date || '',
  };
};

const findCatalogAssignerMatches = async ({ mode, q }) => {
  const normalized = textOrBlank(q);
  if (!normalized) return [];

  const byBarcode = mode === 'barcode';
  const values = byBarcode
    ? [normalized]
    : [`%${normalized.toLowerCase()}%`];
  const where = byBarcode
    ? `(pb.mk_barcode = $1 OR pb.barcode = $1)`
    : `(
        lower(p.product_name_eng) LIKE $1
        OR lower(p.product_name_tel) LIKE $1
        OR lower(b.brand_name_english) LIKE $1
        OR lower(c.category_name_english) LIKE $1
      )`;

  const { rows } = await pgQuery(
    `
    SELECT
      pb.*,
      p.product_name_eng,
      p.product_name_tel,
      p.product_code,
      p.hsncode,
      p.gst_rate,
      b.brand_name_english,
      b.brand_name_telugu,
      c.category_name_english,
      c.category_name_telugu,
      u.unit_name,
      u.unit_short_code,
      rp.gst_rate AS rate_gst_rate,
      rp.notes AS rate_plan_notes
    FROM catalog.product_barcodes pb
    LEFT JOIN catalog.products p ON p.id = pb.product_id
    LEFT JOIN catalog.brands b ON b.id = pb.brand_id
    LEFT JOIN catalog.categories c ON c.id = pb.category_id
    LEFT JOIN catalog.units u ON u.id = pb.unit_id
    LEFT JOIN catalog.rate_plans rp
      ON rp.product_barcode_id = pb.id
      AND lower(rp.rate_for) = 'customer'
    WHERE ${where}
    ORDER BY
      CASE
        WHEN pb.barcode = $1 THEN 0
        WHEN pb.mk_barcode = $1 THEN 1
        ELSE 2
      END,
      pb.id DESC
    LIMIT 20
    `,
    values
  );

  if (byBarcode && rows.length) {
    const matchedRow = rows[0];
    const { rows: siblingRows } = await pgQuery(
      `
      SELECT
        pb.*,
        p.product_name_eng,
        p.product_name_tel,
        p.product_code,
        p.hsncode,
        p.gst_rate,
        b.brand_name_english,
        b.brand_name_telugu,
        c.category_name_english,
        c.category_name_telugu,
        u.unit_name,
        u.unit_short_code,
        rp.gst_rate AS rate_gst_rate,
        rp.notes AS rate_plan_notes
      FROM catalog.product_barcodes pb
      LEFT JOIN catalog.products p ON p.id = pb.product_id
      LEFT JOIN catalog.brands b ON b.id = pb.brand_id
      LEFT JOIN catalog.categories c ON c.id = pb.category_id
      LEFT JOIN catalog.units u ON u.id = pb.unit_id
      LEFT JOIN catalog.rate_plans rp
        ON rp.product_barcode_id = pb.id
        AND lower(rp.rate_for) = 'customer'
      WHERE pb.product_id = $1
        AND ($2::bigint IS NULL OR pb.brand_id = $2)
      ORDER BY
        CASE WHEN pb.id = $3 THEN 0 ELSE 1 END,
        pb.quantity ASC NULLS LAST,
        pb.id DESC
      LIMIT 50
      `,
      [matchedRow.product_id, matchedRow.brand_id || null, matchedRow.id]
    );

    return siblingRows.map(mapCatalogAssignerRow);
  }

  return rows.map(mapCatalogAssignerRow);
};

export const getBarcodeAssignerCatalogBarcodeById = async (req, res) => {
  try {
    const id = Number(req.params.catalogProductBarcodeId || req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'Valid catalog product barcode ID is required' });
    }

    const { rows } = await pgQuery(
      `
      SELECT
        pb.*,
        p.product_name_eng,
        p.product_name_tel,
        p.product_code,
        p.hsncode,
        p.gst_rate,
        b.brand_name_english,
        b.brand_name_telugu,
        c.category_name_english,
        c.category_name_telugu,
        u.unit_name,
        u.unit_short_code,
        rp.gst_rate AS rate_gst_rate,
        rp.notes AS rate_plan_notes
      FROM catalog.product_barcodes pb
      LEFT JOIN catalog.products p ON p.id = pb.product_id
      LEFT JOIN catalog.brands b ON b.id = pb.brand_id
      LEFT JOIN catalog.categories c ON c.id = pb.category_id
      LEFT JOIN catalog.units u ON u.id = pb.unit_id
      LEFT JOIN catalog.rate_plans rp
        ON rp.product_barcode_id = pb.id
        AND lower(rp.rate_for) = 'customer'
      WHERE pb.id = $1
      LIMIT 1
      `,
      [id]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Catalog product barcode row not found' });
    }

    return res.json({
      source: 'catalog',
      assignment: mapCatalogAssignerRow(rows[0]),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to fetch catalog product barcode', details: err.message });
  }
};

const firstFinancial = (product, predicate) => {
  for (const detail of product.details || []) {
    for (const financial of detail.financials || []) {
      if (!predicate || predicate(financial, detail)) {
        return { detail, financial };
      }
    }
  }

  return null;
};

const allFinancials = (product) => {
  const matches = [];
  for (const detail of product.details || []) {
    for (const financial of detail.financials || []) {
      matches.push({ detail, financial });
    }
  }
  return matches;
};

const mapMongoAssignerMatch = ({ product, detail, financial, matchedBarcode = '' }) => ({
  source: 'mongo',
  id: product._id,
  productId: product._id,
  detailId: detail?._id,
  financialId: financial?._id,
  catalogProductId: product.catalogProductId || '',
  catalogCategoryId: product.catalogCategoryId || '',
  catalogBrandId: detail?.catalogBrandId || '',
  catalogProductBarcodeId: financial?.catalogProductBarcodeId || financial?.product_barcode_id || '',
  productBarcodeId: financial?.product_barcode_id || financial?.catalogProductBarcodeId || '',
  mkid: financial?.mkid || financial?.catalogProductBarcodeId || financial?.product_barcode_id || '',
  mk_barcode: financial?.mk_barcode || '',
  barcode: (financial?.barcode || []).join(', ') || matchedBarcode,
  productName: product.name || product.productname || product.englishname || '',
  category: product.category || '',
  brand: detail?.brand || '',
  description: detail?.description || '',
  imageUrl: detail?.images?.[0]?.image || firstDetailImage(product.details) || '',
  units: financial?.units || 'QTY',
  quantity: numberOrBlank(financial?.quantity),
  countInStock: numberOrBlank(financial?.countInStock),
  price: numberOrBlank(financial?.price),
  dprice: numberOrBlank(financial?.dprice),
  mfg_date: financial?.mfg_date || '',
  exp_date: financial?.exp_date || '',
});

const enrichCatalogMatchesWithMongoFinancials = async (catalogMatches = []) => {
  if (!catalogMatches.length) return catalogMatches;

  const mkids = catalogMatches
    .map((item) => Number(item.catalogProductBarcodeId || item.productBarcodeId || item.mkid))
    .filter((item) => Number.isInteger(item) && item > 0);
  const mkBarcodes = catalogMatches
    .map((item) => textOrBlank(item.mk_barcode))
    .filter(Boolean);

  if (!mkids.length && !mkBarcodes.length) return catalogMatches;

  const products = await Product.find({
    $or: [
      { 'details.financials.mkid': { $in: mkids } },
      { 'details.financials.catalogProductBarcodeId': { $in: mkids } },
      { 'details.financials.product_barcode_id': { $in: mkids } },
      { 'details.financials.mk_barcode': { $in: mkBarcodes } },
    ],
  });

  const mongoByKey = new Map();
  for (const product of products) {
    for (const { detail, financial } of allFinancials(product)) {
      const mapped = mapMongoAssignerMatch({ product, detail, financial });
      [
        financial?.mkid,
        financial?.catalogProductBarcodeId,
        financial?.product_barcode_id,
        financial?.mk_barcode,
      ]
        .map((value) => textOrBlank(value))
        .filter(Boolean)
        .forEach((key) => mongoByKey.set(key, mapped));
    }
  }

  return catalogMatches.map((item) => {
    const mongo = [
      item.catalogProductBarcodeId,
      item.productBarcodeId,
      item.mkid,
      item.mk_barcode,
    ]
      .map((value) => textOrBlank(value))
      .filter(Boolean)
      .map((key) => mongoByKey.get(key))
      .find(Boolean);

    if (!mongo) return item;

    const mongoPrice = numberOrBlank(mongo.price);
    const mongoDprice = numberOrBlank(mongo.dprice);

    return {
      ...item,
      productId: mongo.productId || item.productId,
      detailId: mongo.detailId || item.detailId,
      financialId: mongo.financialId || item.financialId,
      description: item.description || mongo.description,
      imageUrl: item.imageUrl || mongo.imageUrl,
      price: mongoPrice || item.price,
      dprice: mongoDprice || item.dprice,
      countInStock: mongo.countInStock || item.countInStock,
      mfg_date: mongo.mfg_date || item.mfg_date,
      exp_date: mongo.exp_date || item.exp_date,
      barcode: item.barcode || mongo.barcode,
    };
  });
};

const findMongoAssignerMatches = async ({ mode, q }) => {
  const normalized = textOrBlank(q);
  if (!normalized) return [];

  if (mode === 'barcode') {
    const product = await Product.findOne({
      $or: [
        { 'details.financials.barcode': normalized },
        { 'details.financials.mk_barcode': normalized },
      ],
    }).limit(1);

    if (!product) return [];

    const found = firstFinancial(product, (financial) =>
      String(financial.mk_barcode || '') === normalized ||
      (financial.barcode || []).map(String).includes(normalized)
    );

    if (!found) return [];

    return allFinancials(product)
      .sort((left, right) => {
        const leftMatched = String(left.financial?._id) === String(found.financial?._id) ? 0 : 1;
        const rightMatched = String(right.financial?._id) === String(found.financial?._id) ? 0 : 1;
        return leftMatched - rightMatched;
      })
      .map((match) =>
        mapMongoAssignerMatch({
          product,
          ...match,
          matchedBarcode:
            String(match.financial?._id) === String(found.financial?._id) ? normalized : '',
        })
      );
  }

  const matcher = new RegExp(escapeRegex(normalized), 'i');
  const products = await Product.find({
    $or: [
      { name: matcher },
      { productname: matcher },
      { englishname: matcher },
      { category: matcher },
      { 'details.brand': matcher },
    ],
  }).limit(20);

  return products
    .map((product) => {
      const found = firstFinancial(product);
      return found ? mapMongoAssignerMatch({ product, ...found }) : null;
    })
    .filter(Boolean);
};

export const lookupBarcodeAssignerProduct = async (req, res) => {
  try {
    const mode = req.query.mode === 'name' ? 'name' : 'barcode';
    const q = textOrBlank(req.query.q || req.query.barcode || req.query.name);

    if (!q) {
      return res.status(400).json({ error: 'Search value is required' });
    }

    const catalogMatches = await enrichCatalogMatchesWithMongoFinancials(
      await findCatalogAssignerMatches({ mode, q })
    );
    if (catalogMatches.length) {
      return res.json({
        source: 'catalog',
        matches: catalogMatches,
        assignment: catalogMatches[0],
      });
    }

    const mongoMatches = await findMongoAssignerMatches({ mode, q });
    if (mongoMatches.length) {
      return res.json({
        source: 'mongo',
        matches: mongoMatches,
        assignment: mongoMatches[0],
      });
    }

    return res.status(404).json({
      source: 'none',
      matches: [],
      assignment: {
        source: 'none',
        barcode: mode === 'barcode' ? q : '',
        productName: mode === 'name' ? q : '',
      },
      message: 'Product not found in catalog or Mongo',
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to lookup barcode assignment product', details: err.message });
  }
};

const compactParts = (...values) =>
  values
    .map((value) => textOrBlank(value))
    .filter(Boolean);

const makeSuggestionLabel = (item) => {
  const name = item.productName || 'Unnamed product';
  const brand = item.brand ? ` - ${item.brand}` : '';
  const pack = compactParts(item.quantity, item.units).join(' ');
  const barcode = item.barcode || item.mk_barcode;
  return compactParts(
    `${name}${brand}`,
    item.category,
    pack,
    barcode ? `Barcode ${barcode}` : '',
    item.mk_barcode ? `MK ${item.mk_barcode}` : ''
  ).join(' | ');
};

export const getBarcodeAssignerNameSuggestions = async (req, res) => {
  try {
    const q = textOrBlank(req.query.q || req.query.name);

    if (!q || q.length < 2) {
      return res.json({ suggestions: [] });
    }

    const [rawCatalogMatches, mongoMatches] = await Promise.all([
      findCatalogAssignerMatches({ mode: 'name', q }),
      findMongoAssignerMatches({ mode: 'name', q }),
    ]);
    const catalogMatches = await enrichCatalogMatchesWithMongoFinancials(rawCatalogMatches);

    const seen = new Set();
    const suggestions = [...catalogMatches, ...mongoMatches]
      .map((item) => ({
        ...item,
        label: makeSuggestionLabel(item),
      }))
      .filter((item) => {
        const key = [
          item.source,
          item.catalogProductBarcodeId || item.productBarcodeId || item.financialId || '',
          item.productName,
          item.brand,
          item.quantity,
          item.units,
        ].join('|').toLowerCase();

        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 30);

    return res.json({ suggestions });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to get barcode assigner suggestions', details: err.message });
  }
};

export const getBarcodeAssignerSyncData = async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit || 20000), 50000);

    const { rows } = await pgQuery(
      `
      SELECT
        pb.*,
        p.product_name_eng,
        p.product_name_tel,
        p.product_code,
        p.hsncode,
        p.gst_rate,
        b.brand_name_english,
        b.brand_name_telugu,
        c.category_name_english,
        c.category_name_telugu,
        u.unit_name,
        u.unit_short_code,
        rp.gst_rate AS rate_gst_rate,
        rp.notes AS rate_plan_notes
      FROM catalog.product_barcodes pb
      LEFT JOIN catalog.products p ON p.id = pb.product_id
      LEFT JOIN catalog.brands b ON b.id = pb.brand_id
      LEFT JOIN catalog.categories c ON c.id = pb.category_id
      LEFT JOIN catalog.units u ON u.id = pb.unit_id
      LEFT JOIN catalog.rate_plans rp
        ON rp.product_barcode_id = pb.id
        AND lower(rp.rate_for) = 'customer'
      ORDER BY pb.updated_at DESC NULLS LAST, pb.id DESC
      LIMIT $1
      `,
      [limit]
    );

    const catalogItems = await enrichCatalogMatchesWithMongoFinancials(rows.map(mapCatalogAssignerRow));
    const mongoProducts = await Product.find({})
      .select('catalogProductId catalogCategoryId name productname englishname category hsncode gst details')
      .limit(limit);

    const mongoItems = mongoProducts.flatMap((product) =>
      allFinancials(product).map((match) =>
        mapMongoAssignerMatch({
          product,
          ...match,
        })
      )
    );

    const seen = new Set();
    const suggestions = [...catalogItems, ...mongoItems].filter((item) => {
      const key = [
        item.source,
        item.catalogProductBarcodeId || item.productBarcodeId || item.financialId || '',
        item.mk_barcode || '',
        item.productName || '',
        item.brand || '',
        item.quantity || '',
        item.units || '',
      ].join('|').toLowerCase();

      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return res.json({
      syncedAt: new Date().toISOString(),
      total: suggestions.length,
      catalogTotal: catalogItems.length,
      mongoTotal: mongoItems.length,
      suggestions,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to sync barcode assigner data', details: err.message });
  }
};

export const upsertPOSProductFinancialFromAssigner = async (req, res) => {
  try {
    const {
      productId,
      detailId,
      financialId,
      productData = {},
      detailData = {},
      financialData = {},
    } = req.body;

    const cleanBarcode = Array.isArray(financialData.barcode)
      ? financialData.barcode.filter(Boolean).map(String)
      : financialData.barcode
        ? [String(financialData.barcode)]
        : [];

    if (!financialData.catalogProductBarcodeId) {
      const catalogIds = await ensureCatalogBarcodeForAssignment({
        productData,
        detailData,
        financialData,
        cleanBarcode,
      });

      productData.catalogProductId = productData.catalogProductId || catalogIds.productId;
      productData.catalogCategoryId = productData.catalogCategoryId || catalogIds.categoryId;
      detailData.catalogBrandId = detailData.catalogBrandId || catalogIds.brandId;
      financialData.catalogProductBarcodeId = catalogIds.barcodeId;
      financialData.product_barcode_id = financialData.product_barcode_id || catalogIds.barcodeId;
      financialData.mk_barcode = financialData.mk_barcode || catalogIds.mkBarcode;
    }

    if (!financialData?.mk_barcode) {
      return res.status(400).json({ error: 'MK barcode is required' });
    }

    const requestedProductName = textOrBlank(
      productData.name ||
      productData.productname ||
      productData.englishname
    );
    const requestedTeluguName = textOrBlank(productData.teluguname) || requestedProductName;

    let product = productId ? await Product.findById(productId) : null;

    if (!product) {
      product = await Product.findOne({ 'details.financials.mk_barcode': String(financialData.mk_barcode) });
    }

    if (!product && productData.catalogProductId && productData.catalogCategoryId) {
      product = await Product.findOne({
        catalogProductId: Number(productData.catalogProductId),
        catalogCategoryId: Number(productData.catalogCategoryId),
      });
      if (
        product &&
        requestedProductName &&
        !sameText(product.name, requestedProductName) &&
        !sameText(product.productname, requestedProductName) &&
        !sameText(product.englishname, requestedProductName)
      ) {
        product = null;
      }
    }

    if (!product && productData.name && productData.category) {
      const candidates = await Product.find({
        $or: [
          { name: productData.name },
          { productname: productData.name },
          { englishname: productData.name },
        ],
      }).limit(25);
      product = candidates.find((item) => sameText(item.category, productData.category)) || null;
    }

    if (!product) {
      product = new Product({
        _id: new mongoose.Types.ObjectId(),
        catalogProductId: productData.catalogProductId ? Number(productData.catalogProductId) : undefined,
        catalogCategoryId: productData.catalogCategoryId ? Number(productData.catalogCategoryId) : undefined,
        mongoCategoryId: productData.mongoCategoryId || new mongoose.Types.ObjectId().toString(),
        name: requestedProductName,
        productname: productData.productname || requestedProductName,
        englishname: productData.englishname || requestedProductName,
        teluguname: requestedTeluguName,
        hsncode: productData.hsncode || productData.hsn || '',
        gst: Number(productData.gst || 0),
        category: productData.category || 'Migration',
        details: [],
      });
    } else {
      product.catalogProductId = productData.catalogProductId
        ? Number(productData.catalogProductId)
        : product.catalogProductId;
      product.catalogCategoryId = productData.catalogCategoryId
        ? Number(productData.catalogCategoryId)
        : product.catalogCategoryId;
      product.name = requestedProductName || product.name;
      product.productname = productData.productname || requestedProductName || product.productname || product.name;
      product.englishname = productData.englishname || requestedProductName || product.englishname || product.name;
      product.teluguname = requestedTeluguName || product.teluguname || product.name;
      product.hsncode = productData.hsncode || productData.hsn || product.hsncode;
      product.gst = productData.gst !== undefined && productData.gst !== null ? Number(productData.gst) : product.gst;
      product.category = productData.category || product.category;
    }

    let detail =
      (detailId ? product.details.id(detailId) : null) ||
      product.details.find((item) =>
        (detailData.catalogBrandId && Number(item.catalogBrandId) === Number(detailData.catalogBrandId)) ||
        sameText(item.brand, detailData.brand)
      );

    if (!detail) {
      product.details.push({
        _id: new mongoose.Types.ObjectId(),
        catalogBrandId: detailData.catalogBrandId ? Number(detailData.catalogBrandId) : undefined,
        brand: detailData.brand || 'Migration',
        description: detailData.description || 'Created from barcode assigner',
        images: detailData.image ? [{ image: detailData.image }] : [],
        financials: [],
      });
      detail = product.details[product.details.length - 1];
    } else {
      detail.catalogBrandId = detailData.catalogBrandId
        ? Number(detailData.catalogBrandId)
        : detail.catalogBrandId;
      detail.brand = detailData.brand || detail.brand;
      detail.description = detailData.description || detail.description || 'Created from barcode assigner';
      if (detailData.image) {
        if (detail.images?.length) {
          detail.images[0].image = detailData.image;
          detail.images = [detail.images[0]];
        } else {
          detail.images = [{ image: detailData.image }];
        }
      }
    }

    let financial =
      (financialId ? detail.financials.id(financialId) : null) ||
      detail.financials.find((item) => String(item.mk_barcode || '') === String(financialData.mk_barcode));

    const nextFinancial = {
      catalogProductBarcodeId: financialData.catalogProductBarcodeId,
      product_barcode_id: financialData.product_barcode_id || financialData.catalogProductBarcodeId,
      mkid:
        financialData.mkid ||
        financialData.catalogProductBarcodeId ||
        financialData.product_barcode_id,
      mk_barcode: String(financialData.mk_barcode),
      price: Number(financialData.price || 0),
      dprice: Number(financialData.dprice || 0),
      Discount: Number(financialData.Discount ?? financialData.discount ?? 0),
      quantity: Number(financialData.quantity || 0),
      countInStock: Number(financialData.countInStock || 0),
      units: financialData.units || 'QTY',
      mfg_date: financialData.mfg_date || financialData.mfgDate || '',
      exp_date: financialData.exp_date || financialData.expDate || '',
      barcode: cleanBarcode,
      updatedAt: new Date(),
    };

    if (financial) {
      Object.assign(financial, nextFinancial);
      financial.createdAt = financial.createdAt || financialData.createdAt || new Date();
    } else {
      detail.financials.push({
        _id: new mongoose.Types.ObjectId(),
        ...nextFinancial,
        createdAt: financialData.createdAt || new Date(),
      });
      financial = detail.financials[detail.financials.length - 1];
    }

    await product.save();

    if (financialData.catalogProductBarcodeId) {
      await pgQuery(
        `
        UPDATE catalog.product_barcodes
        SET
          barcode = COALESCE($2, barcode),
          mk_barcode = COALESCE($3, mk_barcode),
          quantity = COALESCE($4, quantity),
          image_url = COALESCE($5, image_url),
          mongo_product_id = $6,
          mongo_brand_id = $7,
          mongo_financial_id = $8
        WHERE id = $1
        `,
        [
          Number(financialData.catalogProductBarcodeId),
          cleanBarcode.find((item) => item !== String(financialData.mk_barcode)) || cleanBarcode[0] || null,
          financialData.mk_barcode ? String(financialData.mk_barcode) : null,
          financialData.quantity !== undefined && financialData.quantity !== null
            ? Number(financialData.quantity)
            : null,
          detailData.image || null,
          String(product._id),
          String(detail._id),
          String(financial._id),
        ]
      );
    }

    res.status(200).json({
      message: financialId ? 'Financial updated' : 'Financial assigned',
      product,
      detailId: detail._id,
      financial,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save barcode assignment', details: err.message });
  }
};

const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const firstDetailImage = (details = []) => {
  for (const item of details || []) {
    const image = item.images?.[0]?.image;
    if (image) return image;
  }

  return null;
};

const findFallbackImageUrl = async (product, detail) => {
  const directImage = detail?.images?.[0]?.image || firstDetailImage(product.details);
  if (directImage) return directImage;

  const orFilters = [];

  if (product.catalogProductId) {
    orFilters.push({ catalogProductId: product.catalogProductId });
  }

  for (const value of [product.englishname, product.productname, product.name]) {
    if (value) {
      orFilters.push({ name: { $regex: `^${escapeRegex(value)}$`, $options: 'i' } });
      orFilters.push({ productname: { $regex: `^${escapeRegex(value)}$`, $options: 'i' } });
      orFilters.push({ englishname: { $regex: `^${escapeRegex(value)}$`, $options: 'i' } });
    }
  }

  if (!orFilters.length) return null;

  const imageProduct = await Product.findOne({
    _id: { $ne: product._id },
    'details.images.0': { $exists: true },
    $or: orFilters,
  }).select('details.images');

  return imageProduct ? firstDetailImage(imageProduct.details) : null;
};

const buildPOSProductSearchResponse = async ({ product, detail, financial }) => {
  const price = Number(financial.price || 0);
  const dprice = Number(financial.dprice || 0);
  const imageUrl = await findFallbackImageUrl(product, detail);

  return {
    id: product._id,
    catalogProductId: product.catalogProductId,
    productName: product.name,
    productname: product.productname || product.name,
    englishname: product.englishname || '',
    teluguname: product.teluguname || '',
    hsncode: product.hsncode || '',
    gst: product.gst ?? 0,
    category: product.category,
    brand: detail.brand,
    catalogBrandId: detail.catalogBrandId,
    brandId: detail._id,
    financialId: financial._id,
  catalogProductBarcodeId: financial.catalogProductBarcodeId,
  mkid: financial.mkid || financial.catalogProductBarcodeId || financial.product_barcode_id,
  productBarcodeId: financial.product_barcode_id || financial.catalogProductBarcodeId || financial.mkid,
    MRP: financial.price,
    dprice: financial.dprice,
    quantity: financial.quantity,
    countInStock: financial.countInStock,
    units: financial.units,
    image: imageUrl,
    imageUrl,
    catalogQuantity: financial.quantity,
    discount: price > 0 ? Math.round(((price - dprice) / price) * 100) : 0,
    qty: 1,
    barcode: financial.barcode,
  };
};

// @desc Get product by barcode
export const getPOSProductByBarcode = async (req, res) => {
  try {
    // const { barcode } = req.params;
    // console.log('123 ' + barcode);

    // // Use $in operator to check if barcode exists in the array of barcodes
    // const product = await Product.findOne({
    //   "details.financials.barcode": { $in: [barcode] }  // Check if the barcode is in the array
    // });
    // // console.log('123', product);

    const { barcode } = req.params;
    // console.log('123 ' + barcode);

    // Assuming barcode is a string with multiple barcodes separated by commas
    const barcodesArray = barcode.split(',');
    const barcodeToFind = barcodesArray[0];

    // Check if the first barcode in the array exists in the product's financial details
    const product = await Product.findOne({
      "details.financials.barcode": { $in: [barcodeToFind] }  // Check if the first barcode is in the array
    });

    // console.log('Found product:', product);

    if (!product) {
      return res.status(404).json({ error: "Product with barcode not found" });
    }

    // Find the detail with the matching barcode
    const detail = product.details.find((d) =>
      d.financials.some((f) => f.barcode.includes(barcodeToFind))  // Check if barcode exists in the array
    );

    if (!detail) {
      return res.status(404).json({ error: "Matching detail not found" });
    }

    // Find the financial entry with the matching barcode
    const financial = detail.financials.find((f) => f.barcode.includes(barcodeToFind));
    const response = await buildPOSProductSearchResponse({ product, detail, financial });

    return res.status(200).json(response);

  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to fetch product by barcode" });
  }
};

const findFinancialByCatalogProductBarcodeId = async (catalogProductBarcodeId) => {
  const numericBarcodeId = Number(catalogProductBarcodeId);
  if (!Number.isInteger(numericBarcodeId) || numericBarcodeId < 1) return null;

  const product = await Product.findOne({
    'details.financials.catalogProductBarcodeId': numericBarcodeId,
  });

  if (!product) return null;

  for (const detail of product.details || []) {
    const financial = detail.financials?.find(
      (item) => Number(item.catalogProductBarcodeId) === numericBarcodeId
    );

    if (financial) {
      return { product, detail, financial };
    }
  }

  return null;
};

// @desc Get product by catalog product barcode ID typed by cashier
export const getPOSProductByCatalogProductBarcodeId = async (req, res) => {
  try {
    const catalogProductBarcodeId =
      req.params.catalogProductBarcodeId || req.params.mkid;
    const found = await findFinancialByCatalogProductBarcodeId(catalogProductBarcodeId);

    if (!found) {
      return res.status(404).json({ error: "Product with catalogProductBarcodeId not found" });
    }

    const { product, detail, financial } = found;
    const response = await buildPOSProductSearchResponse({ product, detail, financial });

    return res.status(200).json(response);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to fetch product by catalogProductBarcodeId" });
  }
};

