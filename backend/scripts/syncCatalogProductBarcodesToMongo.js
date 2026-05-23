import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import pg from 'pg';
import slugify from 'slugify';
import Product from '../models/productModel.js';

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

const getArgValue = (name) => {
  const index = process.argv.findIndex((arg) => arg === name);
  return index >= 0 ? process.argv[index + 1] : null;
};

const textOrBlank = (value) => (value === null || value === undefined ? '' : String(value).trim());

const numberOrZero = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const buildProductName = (englishname, teluguname) => {
  const english = textOrBlank(englishname);
  const telugu = textOrBlank(teluguname);

  if (english && telugu) return `${english}(${telugu})`;
  return english || telugu || 'Catalog Product';
};

const makeSlug = (productname, catalogProductId) =>
  slugify(`${productname}-${catalogProductId}`, { lower: true, strict: true });

const buildCatalogRowsQuery = ({ productBarcodeId = null, barcode = null } = {}) => {
  const values = [];
  const where = ['COALESCE(pb.is_active, true) = true'];

  if (productBarcodeId) {
    values.push(Number(productBarcodeId));
    where.push(`pb.id = $${values.length}`);
  }

  if (barcode) {
    values.push(textOrBlank(barcode));
    where.push(`(pb.mk_barcode = $${values.length} OR pb.barcode = $${values.length})`);
  }

  return {
    text: `
  SELECT
    pb.id AS catalog_product_barcode_id,
    pb.product_id AS catalog_product_id,
    pb.brand_id AS catalog_brand_id,
    pb.quantity,
    pb.barcode,
    pb.mk_barcode,
    p.product_name_eng AS englishname,
    p.product_name_tel AS teluguname,
    p.product_code,
    p.hsncode AS hsncode,
    p.gst_rate AS gst,
    b.brand_name_english,
    b.brand_name_telugu,
    c.category_name_english,
    c.category_name_telugu,
    u.unit_name,
    u.unit_short_code,
    pb.id AS mkid
  FROM catalog.product_barcodes pb
  LEFT JOIN catalog.products p ON p.id = pb.product_id
  LEFT JOIN catalog.brands b ON b.id = pb.brand_id
  LEFT JOIN catalog.categories c ON c.id = pb.category_id
  LEFT JOIN catalog.units u ON u.id = pb.unit_id
  WHERE ${where.join(' AND ')}
  ORDER BY
    pb.product_id,
    COALESCE(b.brand_name_english, b.brand_name_telugu, ''),
    COALESCE(pb.quantity, 0),
    COALESCE(u.unit_short_code, u.unit_name, ''),
    pb.id
`,
    values,
  };
};

const rowsToProducts = (rows) => {
  const products = new Map();

  for (const row of rows) {
    const catalogProductId = Number(row.catalog_product_id);
    const englishname = textOrBlank(row.englishname || row.product_code);
    const teluguname = textOrBlank(row.teluguname);
    const productname = buildProductName(englishname, teluguname);
    const catalogBrandId = row.catalog_brand_id ? Number(row.catalog_brand_id) : 0;
    const brand =
      textOrBlank(row.brand_name_english) ||
      textOrBlank(row.brand_name_telugu) ||
      'Default Brand';
    const category =
      textOrBlank(row.category_name_english) ||
      textOrBlank(row.category_name_telugu) ||
      'Uncategorized';
    const units =
      textOrBlank(row.unit_short_code) ||
      textOrBlank(row.unit_name) ||
      'unit';

    if (!products.has(catalogProductId)) {
      products.set(catalogProductId, {
        catalogProductId,
        name: productname,
        productname,
        englishname,
        teluguname,
        hsncode: textOrBlank(row.hsncode),
        gst: numberOrZero(row.gst),
        category,
        slug: makeSlug(productname, catalogProductId),
        details: new Map(),
      });
    }

    const product = products.get(catalogProductId);

    if (!product.details.has(catalogBrandId)) {
      product.details.set(catalogBrandId, {
        catalogBrandId,
        brand,
        description: product.productname,
        images: [],
        financials: [],
      });
    }

    const barcode = [
      textOrBlank(row.mk_barcode),
      textOrBlank(row.barcode),
    ].filter(Boolean);

    product.details.get(catalogBrandId).financials.push({
      catalogProductBarcodeId: Number(row.catalog_product_barcode_id),
      mkid: numberOrZero(row.mkid),
      price: 0,
      dprice: 0,
      Discount: 0,
      quantity: numberOrZero(row.quantity),
      countInStock: 0,
      units,
      barcode,
    });
  }

  return Array.from(products.values()).map((product) => ({
    ...product,
    details: Array.from(product.details.values()),
  }));
};

const mergeFinancials = (existingFinancials, incomingFinancials) => {
  const existingByBarcodeId = new Map(
    existingFinancials
      .filter((financial) => financial.catalogProductBarcodeId)
      .map((financial) => [Number(financial.catalogProductBarcodeId), financial])
  );
  const incomingBarcodeIds = new Set(
    incomingFinancials
      .filter((financial) => financial.catalogProductBarcodeId)
      .map((financial) => Number(financial.catalogProductBarcodeId))
  );

  const merged = incomingFinancials.map((incoming) => {
    const existing = existingByBarcodeId.get(Number(incoming.catalogProductBarcodeId));

    if (!existing) return incoming;

    existing.set({
      ...incoming,
      price: existing.price ?? incoming.price,
      dprice: existing.dprice ?? incoming.dprice,
      Discount: existing.Discount ?? incoming.Discount,
      countInStock: existing.countInStock ?? incoming.countInStock,
      rating: existing.rating,
      numReviews: existing.numReviews,
    });

    return existing;
  });

  const preservedExisting = existingFinancials.filter(
    (financial) =>
      !financial.catalogProductBarcodeId ||
      !incomingBarcodeIds.has(Number(financial.catalogProductBarcodeId))
  );

  return [...merged, ...preservedExisting];
};

const mergeDetails = (existingDetails, incomingDetails) => {
  const existingByBrandId = new Map(
    existingDetails
      .filter((detail) => detail.catalogBrandId !== undefined && detail.catalogBrandId !== null)
      .map((detail) => [Number(detail.catalogBrandId), detail])
  );
  const incomingBrandIds = new Set(
    incomingDetails
      .filter((detail) => detail.catalogBrandId !== undefined && detail.catalogBrandId !== null)
      .map((detail) => Number(detail.catalogBrandId))
  );

  const merged = incomingDetails.map((incoming) => {
    const existing = existingByBrandId.get(Number(incoming.catalogBrandId));

    if (!existing) return incoming;

    existing.set({
      catalogBrandId: incoming.catalogBrandId,
      brand: incoming.brand,
      description: existing.description || incoming.description,
      images: existing.images || incoming.images,
      financials: mergeFinancials(existing.financials || [], incoming.financials),
    });

    return existing;
  });

  const preservedExisting = existingDetails.filter(
    (detail) =>
      detail.catalogBrandId === undefined ||
      detail.catalogBrandId === null ||
      !incomingBrandIds.has(Number(detail.catalogBrandId))
  );

  return [...merged, ...preservedExisting];
};

export const syncProducts = async ({ productBarcodeId = null, barcode = null } = {}) => {
  if (!process.env.MONGO_URI) throw new Error('MONGO_URI is required');
  if (!process.env.PG_CONNECTION_STRING) throw new Error('PG_CONNECTION_STRING is required');

  await mongoose.connect(process.env.MONGO_URI);

  const catalogRowsQuery = buildCatalogRowsQuery({ productBarcodeId, barcode });
  const { rows } = await pool.query(catalogRowsQuery.text, catalogRowsQuery.values);
  const products = rowsToProducts(rows);

  let created = 0;
  let updated = 0;

  for (const incoming of products) {
    const existing = await Product.findOne({
      $or: [
        { catalogProductId: incoming.catalogProductId },
        { slug: incoming.slug },
      ],
    });

    if (!existing) {
      await Product.create(incoming);
      created += 1;
      continue;
    }

    existing.set({
      catalogProductId: incoming.catalogProductId,
      name: incoming.name,
      productname: incoming.productname,
      englishname: incoming.englishname,
      teluguname: incoming.teluguname,
      hsncode: incoming.hsncode,
      gst: incoming.gst,
      category: incoming.category,
      slug: incoming.slug,
      details: mergeDetails(existing.details || [], incoming.details),
    });

    await existing.save();
    updated += 1;
  }

  return { postgresRows: rows.length, mongoProducts: products.length, created, updated };
};

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === __filename;

if (isDirectRun) {
  syncProducts({
    productBarcodeId: getArgValue('--product-barcode-id'),
    barcode: getArgValue('--barcode'),
  })
    .then((result) => {
      console.log(
        `Synced ${result.postgresRows} barcode rows into ${result.mongoProducts} Mongo products. Created ${result.created}, updated ${result.updated}.`
      );
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await pool.end();
      await mongoose.disconnect();
    });
}
