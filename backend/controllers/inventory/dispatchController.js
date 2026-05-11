import asyncHandler from '../../middleware/asyncHandler.js';
import pool from '../../config/pg.js';
import Product from '../../models/productModel.js';
import { DispatchOrder } from '../../models/inventory/dispatchModels.js';

const generateDispatchNo = () => {
  return `MKD${Date.now().toString().slice(-6)}`;
};

const validateDispatchItems = (items = []) => {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('At least one dispatch item is required');
  }

  for (const item of items) {
    if (!item.product_barcode_id) {
      throw new Error('Product barcode is required for every item');
    }

    if (!item.product_id) {
      throw new Error('Product is required for every item');
    }

    if (!item.category_id) {
      throw new Error('Category is required for every item');
    }

    if (!item.qty || Number(item.qty) <= 0) {
      throw new Error('Quantity must be greater than 0');
    }
  }
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

  try {
    validateDispatchItems(items);
  } catch (error) {
    res.status(400);
    throw error;
  }

  const order = await DispatchOrder.createWithItems({
    purchase_order_id,
    dispatch_no: dispatch_no || generateDispatchNo(),
    dispatch_status: dispatch_status || 'draft',
    dispatch_notes,
    source,
    destination,
    expected_dispatch_at,
    items,
  });

  res.status(201).json(order);
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
      LEFT JOIN catalog.product_barcodes pb
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
      if (!item.product_barcode_id) {
        res.status(400);
        throw new Error(`Product barcode missing for dispatch item ${item.id}`);
      }

      const barcodeToMatch = item.mk_barcode || item.barcode;

      if (!barcodeToMatch) {
        res.status(400);
        throw new Error(`Barcode value missing for dispatch item ${item.id}`);
      }

      const qtyToAdd = Number(item.qty);

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

  try {
    validateDispatchItems(items);
  } catch (error) {
    res.status(400);
    throw error;
  }

  const updated = await DispatchOrder.replaceItems(req.params.id, items);
  res.json(updated);
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

  const existing = await DispatchOrder.findById(req.params.id);

  if (!existing) {
    res.status(404);
    throw new Error('Dispatch order not found');
  }

  const updated = await DispatchOrder.update(req.params.id, {
    dispatch_status,
  });

  res.json(updated);
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