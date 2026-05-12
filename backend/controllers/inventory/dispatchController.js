import asyncHandler from '../../middleware/asyncHandler.js';
import pool from '../../config/pg.js';
import Product from '../../models/productModel.js';
import { DispatchOrder } from '../../models/inventory/dispatchModels.js';

const generateDispatchNo = () => {
  return `MKD${Date.now().toString().slice(-6)}`;
};

const toPgDate = (value) => {
  if (!value) return null;

  const match = String(value).trim().match(/(\d{4})-(\d{2})-(\d{2})/);
  return match ? match[0] : null;
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
        pb.unit_id
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

    const stockResult = await client.query(
      `
      SELECT *
      FROM inventory.inventory_products
      WHERE product_barcode_id = $1
        AND exp_date::date = $2::date
        AND COALESCE(is_active, true) = true
        AND COALESCE(no_of_units, 0) >= $3
      ORDER BY id ASC
      LIMIT 1
      `,
      [Number(item.product_barcode_id), expDate, units]
    );

    if (stockResult.rowCount === 0) {
      throw new Error(
        `Inventory stock not found for barcode ID ${item.product_barcode_id} and expiry ${expDate}`
      );
    }

    hydratedItems.push({
      product_barcode_id: Number(barcodeInfo.product_barcode_id),
      product_id: Number(barcodeInfo.product_id),
      brand_id: barcodeInfo.brand_id ? Number(barcodeInfo.brand_id) : null,
      category_id: barcodeInfo.category_id
        ? Number(barcodeInfo.category_id)
        : null,
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
    'received',
    'received_to_outlet',
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

    if (existing.dispatch_status === 'sent' && dispatch_status === 'sent') {
      res.status(400);
      throw new Error('Dispatch already sent');
    }

    if (dispatch_status === 'sent' && existing.dispatch_status !== 'sent') {
      const itemsResult = await client.query(
        `
        SELECT
          doi.*,
          to_char(doi.exp_date::date, 'YYYY-MM-DD') AS exp_date_text,
          pb.product_id AS barcode_product_id
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

        const inventoryResult = await client.query(
          `
          SELECT *
          FROM inventory.inventory_products
          WHERE product_barcode_id = $1
            AND exp_date::date = $2::date
            AND COALESCE(is_active, true) = true
          FOR UPDATE
          LIMIT 1
          `,
          [Number(item.product_barcode_id), expDate]
        );

        const inventoryProduct = inventoryResult.rows[0];

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
            updated_at = now()
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
            'INVENTORY_DISPATCH_SENT',
            0,
            dispatchUnits,
            newBalance,
          ]
        );
      }
    }

    const updatedResult = await client.query(
      `
      UPDATE dispatch.dispatch_order
      SET
        dispatch_status = $1,
        updated_at = now()
      WHERE id = $2
      RETURNING *
      `,
      [dispatch_status, Number(req.params.id)]
    );

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
  const dispatchOrderId = req.params.id;

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

    const destinationParts = String(dispatchOrder.destination || '').split(':');
    const destinationType = destinationParts[0];

    if (destinationType !== 'outlet') {
      res.status(400);
      throw new Error('Only outlet dispatch can update outlet Mongo stock');
    }

    const itemsResult = await client.query(
      `
      SELECT
        doi.*,
        pb.mk_barcode,
        pb.barcode,
        pb.quantity AS barcode_quantity
      FROM dispatch.dispatch_order_items doi
      JOIN catalog.product_barcodes pb
        ON pb.id = doi.product_barcode_id
      WHERE doi.dispatch_order_id = $1
      `,
      [dispatchOrderId]
    );

    const items = itemsResult.rows;

    if (!items.length) {
      res.status(400);
      throw new Error('No dispatch items found');
    }

    const updatedProducts = [];

    for (const item of items) {
      const barcodeToMatch = item.mk_barcode || item.barcode;

      if (!barcodeToMatch) {
        res.status(400);
        throw new Error(`Barcode value missing for dispatch item ${item.id}`);
      }

      const qtyToAdd = Number(item.no_of_units || item.qty || 0);

      if (!Number.isFinite(qtyToAdd) || qtyToAdd <= 0) {
        res.status(400);
        throw new Error(`Invalid qty for item ${item.id}`);
      }

      const product = await Product.findOne({
        'details.financials.barcode': barcodeToMatch,
      });

      if (!product) {
        res.status(404);
        throw new Error(`Mongo product not found for barcode ${barcodeToMatch}`);
      }

      let updated = false;

      for (const detail of product.details || []) {
        for (const financial of detail.financials || []) {
          if (String(financial.barcode) === String(barcodeToMatch)) {
            const oldStock = Number(financial.countInStock || 0);
            const newStock = oldStock + qtyToAdd;

            financial.countInStock = newStock;

            updatedProducts.push({
              productId: product._id,
              productName: product.name,
              brandId: detail._id,
              brandName: detail.brand,
              financialId: financial._id,
              barcode: barcodeToMatch,
              oldStock,
              addedQty: qtyToAdd,
              newStock,
            });

            updated = true;
          }
        }
      }

      if (!updated) {
        res.status(400);
        throw new Error(`Financial barcode not matched: ${barcodeToMatch}`);
      }

      await product.save();
    }

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

    await client.query('COMMIT');

    res.json({
      message: 'Outlet Mongo product financial stock updated successfully',
      order: updatedOrderResult.rows[0],
      updatedProducts,
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