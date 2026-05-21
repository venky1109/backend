import asyncHandler from '../../middleware/asyncHandler.js';
import pool from '../../config/pg.js';
import Product from '../../models/productModel.js';
import { DispatchOrder } from '../../models/inventory/dispatchModels.js';
import { RequestTracking } from '../../models/inventory/requestTrackingModel.js';
import mongoose from 'mongoose';

const generateDispatchNo = () => {
  return `MKD${Date.now().toString().slice(-6)}`;
};

const toPgDate = (value) => {
  if (!value) return null;
  const match = String(value).trim().match(/(\d{4})-(\d{2})-(\d{2})/);
  return match ? match[0] : null;
};

const toBarcodeArray = (barcode) => {
  if (Array.isArray(barcode)) return barcode;
  return [barcode];
};

const hasBarcode = (financial, code) =>
  toBarcodeArray(financial?.barcode)
    .filter(Boolean)
    .some((item) => String(item) === String(code));

const syncBarcodeMongoIds = async (client, item, product, detail, financial) => {
  if (!item?.catalog_product_barcode_id || !product?._id || !detail?._id || !financial?._id) {
    return;
  }

  const imageUrl =
    detail.images?.[0]?.image ||
    product.details?.find((productDetail) => productDetail.images?.[0]?.image)?.images?.[0]?.image ||
    null;

  await client.query(
    `
    UPDATE catalog.product_barcodes
    SET
      mongo_product_id = $1,
      mongo_brand_id = $2,
      mongo_category_id = $3,
      mongo_financial_id = $4,
      image_url = COALESCE($5, image_url),
      updated_at = now()
    WHERE id = $6
    `,
    [
      String(product._id),
      String(detail._id),
      product.mongoCategoryId ? String(product.mongoCategoryId) : null,
      String(financial._id),
      imageUrl,
      Number(item.catalog_product_barcode_id),
    ]
  );
};

const findInventoryStockForDispatch = async (client, barcodeInfo, expDate, forUpdate = false) => {
  const stockResult = await client.query(
    `
    SELECT ip.*
    FROM inventory.inventory_products ip
    LEFT JOIN catalog.product_barcodes stock_pb
      ON stock_pb.id = ip.product_barcode_id
    WHERE ip.exp_date::date = $2::date
      AND COALESCE(ip.is_active, true) = true
      AND (
        ip.product_barcode_id = $1
        OR (
          stock_pb.product_id = $3
          AND stock_pb.brand_id IS NOT DISTINCT FROM $4
          AND stock_pb.category_id IS NOT DISTINCT FROM $5
          AND stock_pb.unit_id IS NOT DISTINCT FROM $6
          AND stock_pb.quantity IS NOT DISTINCT FROM $7
        )
      )
    ORDER BY
      CASE WHEN ip.product_barcode_id = $1 THEN 0 ELSE 1 END,
      ip.updated_at DESC,
      ip.id DESC
    LIMIT 1
    ${forUpdate ? 'FOR UPDATE OF ip' : ''}
    `,
    [
      Number(barcodeInfo.product_barcode_id),
      expDate,
      Number(barcodeInfo.product_id),
      barcodeInfo.brand_id ? Number(barcodeInfo.brand_id) : null,
      barcodeInfo.category_id ? Number(barcodeInfo.category_id) : null,
      barcodeInfo.unit_id ? Number(barcodeInfo.unit_id) : null,
      Number(barcodeInfo.quantity || 1),
    ]
  );

  return stockResult.rows[0];
};

const validateDispatchItems = (items = []) => {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('At least one dispatch item is required');
  }

  for (const item of items) {
    if (!item.product_barcode_id) {
      throw new Error('Product barcode is required for every item');
    }

    if (!toPgDate(item.exp_date)) {
      throw new Error('Expiry date is required for every dispatch item');
    }

    const units = Number(item.no_of_units || item.qty || 0);

    if (!Number.isFinite(units) || units <= 0) {
      throw new Error('No. of units must be greater than 0');
    }
  }
};

const hydrateDispatchItemsFromBarcodes = async (client, items = []) => {
  const hydratedItems = [];

  for (const item of items) {
    const expDate = toPgDate(item.exp_date);
    const units = Number(item.no_of_units || item.qty || 0);

    const barcodeResult = await client.query(
      `
      SELECT
        pb.id AS product_barcode_id,
        pb.product_id,
        pb.brand_id,
        pb.category_id,
        pb.unit_id,
        pb.quantity
      FROM catalog.product_barcodes pb
      WHERE pb.id = $1
        AND COALESCE(pb.is_active, true) = true
      `,
      [Number(item.product_barcode_id)]
    );

    if (barcodeResult.rowCount === 0) {
      throw new Error(`Invalid product barcode ID ${item.product_barcode_id}`);
    }

    const barcodeInfo = barcodeResult.rows[0];

    const inventoryStock = await findInventoryStockForDispatch(
      client,
      barcodeInfo,
      expDate
    );

    if (!inventoryStock) {
      throw new Error(
        `Inventory stock not found for barcode ID ${item.product_barcode_id} and expiry ${expDate}`
      );
    }

    const availableUnits = Number(inventoryStock.no_of_units || 0);

    if (availableUnits < units) {
      throw new Error(
        `Insufficient stock for ${
          inventoryStock.product_name || item.product_barcode_id
        }. Available: ${availableUnits}, Required: ${units}`
      );
    }

    hydratedItems.push({
      product_barcode_id: Number(barcodeInfo.product_barcode_id),
      product_id: Number(barcodeInfo.product_id),
      brand_id: barcodeInfo.brand_id ? Number(barcodeInfo.brand_id) : null,
      category_id: barcodeInfo.category_id ? Number(barcodeInfo.category_id) : null,
      unit_id: barcodeInfo.unit_id ? Number(barcodeInfo.unit_id) : null,
      qty: units,
      no_of_units: units,
      exp_date: expDate,
      notes: item.notes || null,
    });
  }

  return hydratedItems;
};

export const getDispatchOrders = asyncHandler(async (req, res) => {
  const limit = Number(req.query.limit) || 100;
  const offset = Number(req.query.offset) || 0;

  const orders = await DispatchOrder.findAll(limit, offset);
  res.json(orders);
});

export const getDispatchOrderById = asyncHandler(async (req, res) => {
  const order = await DispatchOrder.findById(req.params.id);

  if (!order) {
    res.status(404);
    throw new Error('Dispatch order not found');
  }

  res.json(order);
});

export const createDispatchOrder = asyncHandler(async (req, res) => {
  const {
    purchase_order_id,
    dispatch_no,
    dispatch_status,
    dispatch_notes,
    source,
    destination,
    expected_dispatch_at,
    items = [],
  } = req.body;

  if (!source) {
    res.status(400);
    throw new Error('Source is required');
  }

  if (!destination) {
    res.status(400);
    throw new Error('Destination is required');
  }

  validateDispatchItems(items);

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const hydratedItems = await hydrateDispatchItemsFromBarcodes(client, items);

    const order = await DispatchOrder.createWithItems({
      purchase_order_id,
      dispatch_no: dispatch_no || generateDispatchNo(),
      dispatch_status: dispatch_status || 'draft',
      dispatch_notes,
      source,
      destination,
      expected_dispatch_at,
      items: hydratedItems,
    });

    await client.query('COMMIT');

    res.status(201).json(order);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});

export const updateDispatchStatus = asyncHandler(async (req, res) => {
  const { dispatch_status } = req.body;

  const allowedStatuses = [
    'draft',
    'sent',
    'packed',
    'dispatched',
    'received_to_outlet',
    'received_by_stakeholder',
    'cancelled',
  ];

  if (!allowedStatuses.includes(dispatch_status)) {
    res.status(400);
    throw new Error('Invalid inventory dispatch status');
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const orderResult = await client.query(
      `
      SELECT *
      FROM dispatch.dispatch_order
      WHERE id = $1
      FOR UPDATE
      `,
      [Number(req.params.id)]
    );

    const existing = orderResult.rows[0];

    if (!existing) {
      res.status(404);
      throw new Error('Dispatch order not found');
    }

    if (['received_to_outlet', 'received_by_stakeholder'].includes(existing.dispatch_status)) {
      res.status(400);
      throw new Error('Received dispatch cannot be changed');
    }

    if (dispatch_status === 'sent' && existing.dispatch_status !== 'draft') {
      res.status(400);
      throw new Error('Only draft dispatch can be marked sent');
    }

    if (dispatch_status === 'packed' && existing.dispatch_status !== 'sent') {
      res.status(400);
      throw new Error('Only sent dispatch can be marked packed');
    }

    if (dispatch_status === 'dispatched' && existing.dispatch_status !== 'packed') {
      res.status(400);
      throw new Error('Only packed dispatch can be marked dispatched');
    }

    if (dispatch_status === 'received_to_outlet') {
      res.status(400);
      throw new Error('Use receive-to-outlet endpoint to receive dispatch');
    }

    if (dispatch_status === 'received_by_stakeholder') {
      res.status(400);
      throw new Error('Use receive-by-stakeholder endpoint to receive dispatch');
    }

    if (dispatch_status === 'dispatched') {
      const itemsResult = await client.query(
        `
        SELECT
          doi.*,
          to_char(doi.exp_date::date, 'YYYY-MM-DD') AS exp_date_text,
          pb.product_id AS barcode_product_id,
          pb.product_id,
          pb.brand_id,
          pb.category_id,
          pb.unit_id,
          pb.quantity
        FROM dispatch.dispatch_order_items doi
        JOIN catalog.product_barcodes pb
          ON pb.id = doi.product_barcode_id
        WHERE doi.dispatch_order_id = $1
        `,
        [Number(req.params.id)]
      );

      const items = itemsResult.rows;

      if (!items.length) {
        res.status(400);
        throw new Error('No dispatch items found');
      }

      for (const item of items) {
        const dispatchUnits = Number(item.no_of_units || item.qty || 0);
        const expDate = toPgDate(item.exp_date_text || item.exp_date);

        if (!item.product_barcode_id) {
          throw new Error(`Product barcode missing for dispatch item ${item.id}`);
        }

        if (!expDate) {
          throw new Error(`Expiry date missing for dispatch item ${item.id}`);
        }

        if (!Number.isFinite(dispatchUnits) || dispatchUnits <= 0) {
          throw new Error(`Invalid no_of_units for dispatch item ${item.id}`);
        }

        const inventoryProduct = await findInventoryStockForDispatch(
          client,
          {
            product_barcode_id: item.product_barcode_id,
            product_id: item.product_id || item.barcode_product_id,
            brand_id: item.brand_id,
            category_id: item.category_id,
            unit_id: item.unit_id,
            quantity: item.quantity,
          },
          expDate,
          true
        );

        if (!inventoryProduct) {
          throw new Error(
            `Inventory stock not found for barcode ID ${item.product_barcode_id} and expiry ${expDate}`
          );
        }

        const availableUnits = Number(inventoryProduct.no_of_units || 0);

        if (availableUnits < dispatchUnits) {
          throw new Error(
            `Insufficient stock for ${
              inventoryProduct.product_name || item.product_barcode_id
            }. Available: ${availableUnits}, Required: ${dispatchUnits}`
          );
        }

        const newBalance = availableUnits - dispatchUnits;

        await client.query(
          `
          UPDATE inventory.inventory_products
          SET
            no_of_units = COALESCE(no_of_units, 0) - $1,
            count_in_stock = COALESCE(count_in_stock, 0) - $1,
            updated_at = NOW()
          WHERE id = $2
          `,
          [dispatchUnits, Number(inventoryProduct.id)]
        );

        await client.query(
          `
          INSERT INTO inventory.stock_transaction (
            product_id,
            source,
            destination,
            ref_type,
            qty_in,
            qty_out,
            balance_qty
          )
          VALUES ($1,$2,$3,$4,$5,$6,$7)
          `,
          [
            Number(item.barcode_product_id),
            existing.source || 'INVENTORY',
            existing.destination || 'DISPATCH',
            'INVENTORY_DISPATCH_OUT',
            0,
            dispatchUnits,
            newBalance,
          ]
        );
      }

      await client.query(
        `
        INSERT INTO inventory.transit_products (
          dispatch_order_id,
          transit_status
        )
        VALUES ($1, 'intransit')
        ON CONFLICT (dispatch_order_id)
        DO UPDATE SET
          transit_status = 'intransit',
          updated_at = NOW()
        `,
        [Number(req.params.id)]
      );
    }

    if (dispatch_status === 'cancelled') {
      await client.query(
        `
        UPDATE inventory.transit_products
        SET
          transit_status = 'cancelled',
          updated_at = NOW()
        WHERE dispatch_order_id = $1
        `,
        [Number(req.params.id)]
      );
    }

    const updatedResult = await client.query(
      `
      UPDATE dispatch.dispatch_order
      SET
        dispatch_status = $1,
        updated_at = NOW()
      WHERE id = $2
      RETURNING *
      `,
      [dispatch_status, Number(req.params.id)]
    );

    if (['dispatched', 'cancelled'].includes(dispatch_status)) {
      await RequestTracking.upsertDispatchReceiveRequest(updatedResult.rows[0], {
        db: client,
        requestedBy: RequestTracking.actorName(req.user || {}),
      });
    }

    await client.query('COMMIT');

    res.json(updatedResult.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});

export const receivedDispatchToOutletMongoStock = asyncHandler(async (req, res) => {
  const dispatchOrderId = Number(req.params.id);

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const orderResult = await client.query(
      `
      SELECT *
      FROM dispatch.dispatch_order
      WHERE id = $1
      FOR UPDATE
      `,
      [dispatchOrderId]
    );

    const dispatchOrder = orderResult.rows[0];

    if (!dispatchOrder) {
      res.status(404);
      throw new Error('Dispatch order not found');
    }

    if (dispatchOrder.dispatch_status === 'received_to_outlet') {
      res.status(400);
      throw new Error('Dispatch already received to outlet');
    }

    if (dispatchOrder.dispatch_status !== 'dispatched') {
      res.status(400);
      throw new Error('Only dispatched orders can be received to outlet');
    }

    const destinationParts = String(dispatchOrder.destination || '').split(':');
    const destinationType = destinationParts[0];

    if (destinationType !== 'outlet') {
      res.status(400);
      throw new Error('Only outlet dispatch can update outlet Mongo stock');
    }

    const transitResult = await client.query(
      `
      SELECT *
      FROM inventory.transit_products
      WHERE dispatch_order_id = $1
      FOR UPDATE
      `,
      [dispatchOrderId]
    );

    const transit = transitResult.rows[0];

    if (!transit) {
      res.status(400);
      throw new Error('Transit entry not found for this dispatch');
    }

    if (transit.transit_status !== 'intransit') {
      res.status(400);
      throw new Error(`Transit status must be intransit. Current: ${transit.transit_status}`);
    }

    const itemsResult = await client.query(
      `
      SELECT
        doi.*,
        pb.id AS catalog_product_barcode_id,
        pb.product_id,
        pb.brand_id,
        pb.category_id,
        pb.unit_id,
        pb.mk_barcode,
        pb.barcode,
        pb.quantity AS barcode_quantity,
        p.product_name_eng,
        p.product_name_tel,
        p.hsncode,
        p.gst_rate,
        b.brand_name_english,
        c.category_name_english,
        u.unit_short_code,
        u.unit_name,
        ip.unit_price AS inventory_unit_price,
        poi.expected_unit_price,
        poi.actual_unit_price
      FROM dispatch.dispatch_order_items doi
      JOIN catalog.product_barcodes pb ON pb.id = doi.product_barcode_id
      LEFT JOIN catalog.products p ON p.id = pb.product_id
      LEFT JOIN catalog.brands b ON b.id = pb.brand_id
      LEFT JOIN catalog.categories c ON c.id = pb.category_id
      LEFT JOIN catalog.units u ON u.id = pb.unit_id
      LEFT JOIN LATERAL (
        SELECT ip.unit_price
        FROM inventory.inventory_products ip
        WHERE ip.product_barcode_id = doi.product_barcode_id
          AND ip.exp_date::date = doi.exp_date::date
        ORDER BY ip.updated_at DESC, ip.id DESC
        LIMIT 1
      ) ip ON true
      LEFT JOIN purchases.purchase_order_items poi
        ON poi.purchase_order_id = $2
       AND poi.product_id = doi.product_id
       AND poi.brand_id IS NOT DISTINCT FROM doi.brand_id
       AND poi.category_id IS NOT DISTINCT FROM doi.category_id
       AND poi.unit_id IS NOT DISTINCT FROM doi.unit_id
      WHERE doi.dispatch_order_id = $1
      `,
      [dispatchOrderId, dispatchOrder.purchase_order_id]
    );

    const items = itemsResult.rows;

    if (!items.length) {
      res.status(400);
      throw new Error('No dispatch items found');
    }

    const updatedProducts = [];

    for (const item of items) {
      const barcodes = [...new Set([item.mk_barcode, item.barcode].filter(Boolean).map(String))];

      if (!barcodes.length) {
        res.status(400);
        throw new Error(`Barcode value missing for dispatch item ${item.id}`);
      }

      const qtyToAdd = Number(item.no_of_units || item.qty || 0);
      const unitPrice = Number(
        item.inventory_unit_price ??
          item.actual_unit_price ??
          item.expected_unit_price ??
          0
      );
      const discount = Number(item.discount ?? item.Discount ?? 0);
      const sellingPrice = Number(item.dprice ?? item.selling_price ?? unitPrice);

      if (!Number.isFinite(qtyToAdd) || qtyToAdd <= 0) {
        res.status(400);
        throw new Error(`Invalid qty for item ${item.id}`);
      }

      let product =
        (await Product.findOne({ catalogProductId: Number(item.product_id) })) ||
        (await Product.findOne({
          'details.financials.catalogProductBarcodeId': Number(item.catalog_product_barcode_id),
        })) ||
        (await Product.findOne({ 'details.financials.barcode': { $in: barcodes } }));

      if (!product) {
        const productName =
          item.product_name_eng || item.product_name_tel || `Product ${item.product_id}`;

        product = new Product({
          _id: new mongoose.Types.ObjectId(),
          catalogProductId: Number(item.product_id),
          catalogCategoryId: item.category_id ? Number(item.category_id) : undefined,
          mongoCategoryId: new mongoose.Types.ObjectId().toString(),
          name: productName,
          productname: productName,
          englishname: item.product_name_eng || '',
          teluguname: item.product_name_tel || '',
          hsncode: item.hsncode || '',
          gst: Number(item.gst_rate || 0),
          category: item.category_name_english || 'Migration',
          details: [],
        });
      }

      if (!product.mongoCategoryId) {
        product.mongoCategoryId = new mongoose.Types.ObjectId().toString();
      }

      if (item.category_id && !product.catalogCategoryId) {
        product.catalogCategoryId = Number(item.category_id);
      }

      let detail = (product.details || []).find(
        (productDetail) =>
          Number(productDetail.catalogBrandId) === Number(item.brand_id) ||
          String(productDetail.brand || '').toLowerCase() ===
            String(item.brand_name_english || '').toLowerCase()
      );

      if (!detail) {
        product.details.push({
          _id: new mongoose.Types.ObjectId(),
          catalogBrandId: Number(item.brand_id),
          brand: item.brand_name_english || 'Migration',
          description: 'Created from outlet migration receive',
          images: [],
          financials: [],
        });
        detail = product.details[product.details.length - 1];
      }

      let financial = (detail.financials || []).find(
        (itemFinancial) =>
          Number(itemFinancial.catalogProductBarcodeId) ===
            Number(item.catalog_product_barcode_id) ||
          hasBarcode(itemFinancial, item.mk_barcode) ||
          hasBarcode(itemFinancial, item.barcode)
      );

      const oldStock = financial ? Number(financial.countInStock || 0) : 0;

      if (financial) {
        financial.countInStock = oldStock + qtyToAdd;
        financial.barcode = [...new Set([...toBarcodeArray(financial.barcode), ...barcodes])];
      } else {
        detail.financials.push({
          _id: new mongoose.Types.ObjectId(),
          catalogProductBarcodeId: Number(item.catalog_product_barcode_id),
          mkid: Number(item.mk_barcode || 0) || undefined,
          price: unitPrice,
          dprice: sellingPrice,
          Discount: discount,
          quantity: Number(item.barcode_quantity || item.qty || 0),
          countInStock: qtyToAdd,
          units: item.unit_short_code || item.unit_name || 'unit',
          barcode: barcodes,
        });
        financial = detail.financials[detail.financials.length - 1];
      }

      await product.save();
      await syncBarcodeMongoIds(client, item, product, detail, financial);

      updatedProducts.push({
        productId: product._id,
        productName: product.name,
        brandId: detail._id,
        brandName: detail.brand,
        financialId: financial._id,
        barcode: barcodes,
        oldStock,
        addedQty: qtyToAdd,
        newStock: Number(financial.countInStock || 0),
      });
    }

    await client.query(
      `
      UPDATE inventory.transit_products
      SET
        transit_status = 'reached',
        updated_at = NOW()
      WHERE dispatch_order_id = $1
      `,
      [dispatchOrderId]
    );

    const updatedOrderResult = await client.query(
      `
      UPDATE dispatch.dispatch_order
      SET
        dispatch_status = 'received_to_outlet',
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [dispatchOrderId]
    );

    await RequestTracking.upsertDispatchReceiveRequest(updatedOrderResult.rows[0], {
      db: client,
      requestedBy: RequestTracking.actorName(req.user || {}),
    });

    await client.query('COMMIT');

    res.json({
      message: 'Outlet Mongo product financial stock updated successfully',
      order: updatedOrderResult.rows[0],
      updatedProducts,
    });
  } catch (error) {
    await client.query('ROLLBACK');

    try {
      await RequestTracking.markDispatchReceiveFailed(dispatchOrderId, error, {
        requestedBy: RequestTracking.actorName(req.user || {}),
      });
    } catch (trackingError) {
      console.error('Failed to track outlet receive failure:', trackingError.message);
    }

    throw error;
  } finally {
    client.release();
  }
});

export const receivedDispatchByStakeholder = asyncHandler(async (req, res) => {
  const dispatchOrderId = Number(req.params.id);

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const orderResult = await client.query(
      `
      SELECT *
      FROM dispatch.dispatch_order
      WHERE id = $1
      FOR UPDATE
      `,
      [dispatchOrderId]
    );

    const dispatchOrder = orderResult.rows[0];

    if (!dispatchOrder) {
      res.status(404);
      throw new Error('Dispatch order not found');
    }

    if (dispatchOrder.dispatch_status === 'received_by_stakeholder') {
      res.status(400);
      throw new Error('Dispatch already received by stakeholder');
    }

    if (dispatchOrder.dispatch_status !== 'dispatched') {
      res.status(400);
      throw new Error('Only dispatched orders can be received by stakeholder');
    }

    const destinationType = String(dispatchOrder.destination || '')
      .split(':')[0]
      .toLowerCase();

    if (!['stakeholder', 'vendor', 'customer'].includes(destinationType)) {
      res.status(400);
      throw new Error('Only stakeholder/vendor/customer dispatch can be received here');
    }

    await client.query(
      `
      UPDATE inventory.transit_products
      SET
        transit_status = 'reached',
        updated_at = NOW()
      WHERE dispatch_order_id = $1
      `,
      [dispatchOrderId]
    );

    const updatedOrderResult = await client.query(
      `
      UPDATE dispatch.dispatch_order
      SET
        dispatch_status = 'received_by_stakeholder',
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [dispatchOrderId]
    );

    await client.query('COMMIT');

    res.json({
      message: 'Dispatch received by stakeholder successfully',
      order: updatedOrderResult.rows[0],
    });
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});

export const updateDispatchOrder = asyncHandler(async (req, res) => {
  const existing = await DispatchOrder.findById(req.params.id);

  if (!existing) {
    res.status(404);
    throw new Error('Dispatch order not found');
  }

  const updated = await DispatchOrder.update(req.params.id, req.body);
  res.json(updated);
});

export const updateDispatchOrderItems = asyncHandler(async (req, res) => {
  const existing = await DispatchOrder.findById(req.params.id);

  if (!existing) {
    res.status(404);
    throw new Error('Dispatch order not found');
  }

  if (existing.dispatch_status !== 'draft') {
    res.status(400);
    throw new Error('Items can be edited only in draft status');
  }

  const { items = [] } = req.body;

  validateDispatchItems(items);

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const hydratedItems = await hydrateDispatchItemsFromBarcodes(client, items);

    const updated = await DispatchOrder.replaceItems(
      req.params.id,
      hydratedItems
    );

    await client.query('COMMIT');

    res.json(updated);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
});

export const deleteDispatchOrder = asyncHandler(async (req, res) => {
  const existing = await DispatchOrder.findById(req.params.id);

  if (!existing) {
    res.status(404);
    throw new Error('Dispatch order not found');
  }

  if (existing.dispatch_status !== 'draft') {
    res.status(400);
    throw new Error('Only draft dispatch can be deleted');
  }

  const deleted = await DispatchOrder.remove(req.params.id);

  res.json({
    message: 'Dispatch order deleted successfully',
    deleted,
  });
});
