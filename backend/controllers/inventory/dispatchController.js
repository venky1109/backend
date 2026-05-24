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

const isInternalPackingDestination = (destination) => {
  const normalized = String(destination || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');

  return [
    'internal_packing',
    'internal_packing_dept',
    'internal_packing_department',
    'packing',
    'packing_dept',
    'packing_department',
  ].some((token) => normalized === token || normalized.startsWith(`${token}:`));
};

const getWarehouseIdFromSource = (source = '') => {
  const parts = String(source).split(':');
  return parts[0] === 'warehouse' ? Number(parts[1]) : null;
};

const makeInternalPackingSkuId = ({
  dispatchOrderId,
  dispatchItemId,
  sourceSkuId,
  productBarcodeId,
  packingIndex = 0,
}) => {
  const skuBase =
    sourceSkuId && productBarcodeId
      ? String(sourceSkuId).replace(/PB\d+/, `PB${productBarcodeId}`)
      : sourceSkuId || `PB${productBarcodeId || 'NA'}`;

  const sourcePart = String(skuBase)
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .slice(0, 80);

  return `PACK-D${dispatchOrderId}-I${dispatchItemId}-P${packingIndex}-${sourcePart}`;
};

const toPackingConfigArray = (value, item = {}) => {
  if (!value) return [];
  if (Array.isArray(value)) return value;

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return [];

    try {
      return toPackingConfigArray(JSON.parse(trimmed), item);
    } catch {
      return [];
    }
  }

  if (typeof value !== 'object') return [];

  if (
    value.product_barcode_id ||
    value.productBarcodeId ||
    value.packing_product_barcode_id ||
    value.packed_product_barcode_id ||
    value.output_product_barcode_id
  ) {
    return [value];
  }

  const nested =
    value.rows ??
    value.items ??
    value.configs ??
    value.configurations ??
    value.packing_rows ??
    value.packingRows ??
    value.packing_configs ??
    value.packingConfigs ??
    value.packing_configuration ??
    value.packingConfiguration;

  if (nested) return toPackingConfigArray(nested, item);

  const itemKey = item.id ? String(item.id) : null;
  const barcodeKey = item.product_barcode_id ? String(item.product_barcode_id) : null;
  const keyedValue =
    (itemKey && value[itemKey]) ||
    (barcodeKey && value[barcodeKey]) ||
    (itemKey && value[`item_${itemKey}`]) ||
    (barcodeKey && value[`barcode_${barcodeKey}`]);

  return keyedValue ? toPackingConfigArray(keyedValue, item) : [];
};

const getPackingConfigs = (item = {}) => {
  const value =
    item.packing_configs ??
    item.packingConfigs ??
    item.packing_rows ??
    item.packingRows ??
    item.packing_config ??
    item.packingConfig ??
    item.packing_configuration ??
    item.packingConfiguration ??
    item.packing_configurations ??
    item.packingConfigurations;

  return toPackingConfigArray(value, item);
};

const normalizePackingConfigs = (item = {}) => {
  const configs = getPackingConfigs(item);

  return configs.map((config) => ({
    product_barcode_id: config.product_barcode_id
      ? Number(config.product_barcode_id)
      : config.productBarcodeId
        ? Number(config.productBarcodeId)
        : config.packing_product_barcode_id
          ? Number(config.packing_product_barcode_id)
          : config.packingProductBarcodeId
            ? Number(config.packingProductBarcodeId)
            : config.packed_product_barcode_id
              ? Number(config.packed_product_barcode_id)
              : config.packedProductBarcodeId
                ? Number(config.packedProductBarcodeId)
                : config.output_product_barcode_id
                  ? Number(config.output_product_barcode_id)
                  : config.outputProductBarcodeId
                    ? Number(config.outputProductBarcodeId)
                    : null,
    qty: Number(
      config.no_of_units ??
        config.noOfUnits ??
        config.qty ??
        config.quantity ??
        config.units ??
        config.count ??
        config.pack_count ??
        config.packCount ??
        config.packs ??
        config.pack_qty ??
        config.packQty ??
        config.packing_qty ??
        config.packingQty ??
        config.packed_qty ??
        config.packedQty ??
        config.output_qty ??
        config.outputQty ??
        (configs.length === 1 ? 1 : 0)
    ),
    notes: config.notes || null,
  }));
};

const validatePackingConfigs = (configs = [], itemId = 'item') => {
  for (const config of configs) {
    if (!config.product_barcode_id) {
      throw new Error(`Packing product barcode is required for dispatch ${itemId}`);
    }

    if (!Number.isFinite(config.qty) || config.qty <= 0) {
      throw new Error(`Packing quantity must be greater than 0 for dispatch ${itemId}`);
    }
  }
};

const getExplicitDispatchUnits = (item = {}) => {
  const units = Number(item.no_of_units ?? item.qty ?? 0);
  return Number.isFinite(units) && units > 0 ? units : null;
};

const calculateDispatchUnitsFromPacking = (sourceBarcode, packingRows = []) => {
  const sourceQuantity = Number(sourceBarcode?.quantity || 1);

  if (!Number.isFinite(sourceQuantity) || sourceQuantity <= 0) {
    return null;
  }

  let totalSourceQuantity = 0;

  for (const row of packingRows) {
    if (Number(row.barcode.unit_id) !== Number(sourceBarcode.unit_id)) {
      return null;
    }

    totalSourceQuantity += Number(row.config.qty) * Number(row.barcode.quantity || 1);
  }

  const units = totalSourceQuantity / sourceQuantity;
  return Number.isFinite(units) && units > 0 ? units : null;
};

const findPackingConfigOverride = (body = {}, item = {}, itemCount = 0) => {
  const mappedConfigs = toPackingConfigArray(
    body.packing_configs ??
      body.packingConfigs ??
      body.packing_rows ??
      body.packingRows ??
      body.packing_config ??
      body.packingConfig ??
      body.packing_configuration ??
      body.packingConfiguration ??
      body.packing_configurations ??
      body.packingConfigurations,
    item
  );

  if (mappedConfigs.length) {
    return { packing_configs: mappedConfigs };
  }

  const directConfigs = normalizePackingConfigs(body);
  if (directConfigs.length) {
    const bodyItemId = body.dispatch_item_id ?? body.dispatchItemId;
    const bodyBarcodeId = body.product_barcode_id ?? body.productBarcodeId;

    if (bodyItemId) {
      return Number(bodyItemId) === Number(item.id) ? body : null;
    }

    if (bodyBarcodeId) {
      return Number(bodyBarcodeId) === Number(item.product_barcode_id) ? body : null;
    }

    if (itemCount === 1) {
      return body;
    }
  }

  const bodyItems = [
    ...(Array.isArray(body.items) ? body.items : []),
    ...(Array.isArray(body.dispatch_items) ? body.dispatch_items : []),
    ...(Array.isArray(body.dispatchItems) ? body.dispatchItems : []),
  ];

  return bodyItems.find((bodyItem) => {
    const bodyItemId = bodyItem.id ?? bodyItem.dispatch_item_id ?? bodyItem.dispatchItemId;
    const bodyBarcodeId = bodyItem.product_barcode_id ?? bodyItem.productBarcodeId;

    return (
      (bodyItemId && Number(bodyItemId) === Number(item.id)) ||
      (bodyBarcodeId && Number(bodyBarcodeId) === Number(item.product_barcode_id))
    );
  }) || null;
};

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

const findInventoryStockForDispatch = async (
  client,
  barcodeInfo,
  expDate,
  forUpdate = false,
  warehouseId = null
) => {
  const stockResult = await client.query(
    `
    SELECT ip.*
    FROM inventory.inventory_products ip
    LEFT JOIN catalog.product_barcodes stock_pb
      ON stock_pb.id = ip.product_barcode_id
    WHERE ip.exp_date::date = $2::date
      AND COALESCE(ip.is_active, true) = true
      AND COALESCE(ip.business_entity_type, '') <> 'INTERNAL_PACKING'
      AND ($8::bigint IS NULL OR ip.warehouse_id = $8::bigint)
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
      warehouseId ? Number(warehouseId) : null,
    ]
  );

  return stockResult.rows[0];
};

const findInventoryStockById = async (client, inventoryProductId, forUpdate = false) => {
  const stockResult = await client.query(
    `
    SELECT
      ip.*,
      pb.product_id AS barcode_product_id,
      pb.brand_id AS barcode_brand_id,
      pb.category_id AS barcode_category_id,
      pb.unit_id AS barcode_unit_id,
      pb.quantity AS barcode_quantity
    FROM inventory.inventory_products ip
    LEFT JOIN catalog.product_barcodes pb
      ON pb.id = ip.product_barcode_id
    WHERE ip.id = $1
      AND COALESCE(ip.is_active, true) = true
    LIMIT 1
    ${forUpdate ? 'FOR UPDATE OF ip' : ''}
    `,
    [Number(inventoryProductId)]
  );

  return stockResult.rows[0];
};

const validateDispatchItems = (items = []) => {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('At least one dispatch item is required');
  }

  for (const item of items) {
    if (!item.product_barcode_id && !item.inventory_product_id) {
      throw new Error('Product barcode is required for every item');
    }

    if (!toPgDate(item.exp_date)) {
      throw new Error('Expiry date is required for every dispatch item');
    }

    const units = getExplicitDispatchUnits(item);
    const packingConfigs = normalizePackingConfigs(item);

    if (!units && packingConfigs.length === 0) {
      throw new Error('No. of units or packing configuration is required for every dispatch item');
    }

    validatePackingConfigs(packingConfigs, 'item');
  }
};

const hydrateDispatchItemsFromBarcodes = async (client, items = []) => {
  const hydratedItems = [];

  for (const item of items) {
    const expDate = toPgDate(item.exp_date);
    const explicitUnits = getExplicitDispatchUnits(item);
    const selectedInventory = item.inventory_product_id
      ? await findInventoryStockById(client, item.inventory_product_id)
      : null;

    if (item.inventory_product_id && !selectedInventory) {
      throw new Error(`Inventory stock not found for inventory ID ${item.inventory_product_id}`);
    }

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
      [Number(item.product_barcode_id || selectedInventory?.product_barcode_id)]
    );

    if (barcodeResult.rowCount === 0) {
      throw new Error(`Invalid product barcode ID ${item.product_barcode_id}`);
    }

    const barcodeInfo = barcodeResult.rows[0];
    const packingConfigs = normalizePackingConfigs(item);
    const packingRows = [];

    validatePackingConfigs(packingConfigs, 'item');

    for (const packingConfig of packingConfigs) {
      const packingBarcode = await getCatalogBarcodeForPacking(
        client,
        packingConfig.product_barcode_id
      );

      if (!packingBarcode) {
        throw new Error(`Invalid packing product barcode ID ${packingConfig.product_barcode_id}`);
      }

      packingRows.push({
        config: packingConfig,
        barcode: packingBarcode,
      });
    }

    const units =
      explicitUnits ?? calculateDispatchUnitsFromPacking(barcodeInfo, packingRows);

    if (!units) {
      throw new Error(
        `No. of units is required for barcode ID ${item.product_barcode_id} when packing rows use a different unit`
      );
    }

    const inventoryStock =
      selectedInventory ||
      (await findInventoryStockForDispatch(client, barcodeInfo, expDate));

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
      inventory_product_id: selectedInventory ? Number(selectedInventory.id) : null,
      product_id: Number(barcodeInfo.product_id),
      brand_id: barcodeInfo.brand_id ? Number(barcodeInfo.brand_id) : null,
      category_id: barcodeInfo.category_id ? Number(barcodeInfo.category_id) : null,
      unit_id: barcodeInfo.unit_id ? Number(barcodeInfo.unit_id) : null,
      qty: units,
      no_of_units: units,
      exp_date: expDate,
      notes: item.notes || null,
      packing_configs: packingConfigs,
    });
  }

  return hydratedItems;
};

const getCatalogBarcodeForPacking = async (client, productBarcodeId) => {
  const result = await client.query(
    `
    SELECT
      pb.id AS product_barcode_id,
      pb.product_id,
      pb.brand_id,
      pb.category_id,
      pb.unit_id,
      pb.quantity,
      COALESCE(pb.barcode, pb.mk_barcode) AS barcode,
      pb.mk_barcode,
      p.product_code,
      p.product_name_eng,
      p.product_name_tel,
      p.hsncode
    FROM catalog.product_barcodes pb
    LEFT JOIN catalog.products p ON p.id = pb.product_id
    WHERE pb.id = $1
      AND COALESCE(pb.is_active, true) = true
    `,
    [Number(productBarcodeId)]
  );

  return result.rows[0];
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
  const dispatch_status = String(req.body.dispatch_status || req.body.status || '')
    .trim()
    .toLowerCase();

  const allowedStatuses = [
    'draft',
    'sent',
    'packed',
    'label_printed',
    'dispatched',
    'received_to_outlet',
    'received_by_stakeholder',
    'received_to_warehouse',
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

    const existingStatus = String(existing.dispatch_status || '').trim().toLowerCase();

    if (
      ['received_to_outlet', 'received_by_stakeholder', 'received_to_warehouse'].includes(
        existingStatus
      )
    ) {
      res.status(400);
      throw new Error('Received dispatch cannot be changed');
    }

    if (existingStatus === 'cancelled' && dispatch_status !== 'cancelled') {
      res.status(400);
      throw new Error('Cancelled dispatch cannot be changed');
    }

    if (dispatch_status === 'sent' && existingStatus !== 'draft') {
      res.status(400);
      throw new Error('Only draft dispatch can be marked sent');
    }

    if (dispatch_status === 'packed' && existingStatus !== 'sent') {
      res.status(400);
      throw new Error(`Only sent dispatch can be marked packed. Current status: ${existing.dispatch_status}`);
    }

    if (dispatch_status === 'label_printed' && existingStatus !== 'packed') {
      res.status(400);
      throw new Error('Only packed dispatch can be marked label printed');
    }

    if (
      dispatch_status === 'dispatched' &&
      !['packed', 'label_printed'].includes(existingStatus)
    ) {
      res.status(400);
      throw new Error('Only packed or label printed dispatch can be marked dispatched');
    }

    if (dispatch_status === 'cancelled' && existingStatus === 'dispatched') {
      res.status(400);
      throw new Error('Dispatched orders cannot be cancelled');
    }

    if (dispatch_status === 'received_to_outlet') {
      res.status(400);
      throw new Error('Use receive-to-outlet endpoint to receive dispatch');
    }

    if (dispatch_status === 'received_by_stakeholder') {
      const destinationType = String(existing.destination || '')
        .split(':')[0]
        .toLowerCase();

      if (existingStatus !== 'dispatched') {
        res.status(400);
        throw new Error('Only dispatched orders can be received by stakeholder');
      }

      if (
        !['stakeholder', 'vendor', 'customer'].includes(destinationType) &&
        !isInternalPackingDestination(existing.destination)
      ) {
        res.status(400);
        throw new Error('Use receive-by-stakeholder endpoint to receive dispatch');
      }
    }

    if (dispatch_status === 'received_to_warehouse') {
      if (existingStatus !== 'dispatched') {
        res.status(400);
        throw new Error('Only dispatched orders can be received to warehouse');
      }

      if (!isInternalPackingDestination(existing.destination)) {
        res.status(400);
        throw new Error('Only Internal Packing Dept dispatch can be received to warehouse');
      }
    }

    if (dispatch_status === 'dispatched' && isInternalPackingDestination(existing.destination)) {
      res.status(400);
      throw new Error('Use internal-packing-dispatched endpoint for Internal Packing Dept dispatch');
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
        const dispatchUnits = Number(item.no_of_units ?? item.qty ?? 0);
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

        const inventoryProduct = item.inventory_product_id
          ? await findInventoryStockById(client, item.inventory_product_id, true)
          : await findInventoryStockForDispatch(
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
            item.inventory_product_id
              ? `Inventory stock not found for inventory ID ${item.inventory_product_id}`
              : `Inventory stock not found for barcode ID ${item.product_barcode_id} and expiry ${expDate}`
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

    if (['received_by_stakeholder', 'received_to_warehouse'].includes(dispatch_status)) {
      await client.query(
        `
        UPDATE inventory.transit_products
        SET
          transit_status = 'reached',
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

export const dispatchInternalPackingOrder = asyncHandler(async (req, res) => {
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

    if (dispatchOrder.dispatch_status === 'cancelled') {
      res.status(400);
      throw new Error('Cancelled internal packing orders cannot be dispatched');
    }

    if (!isInternalPackingDestination(dispatchOrder.destination)) {
      res.status(400);
      throw new Error('Only Internal Packing Dept dispatches can use this endpoint');
    }

    if (dispatchOrder.dispatch_status === 'dispatched') {
      const transitResult = await client.query(
        `
        SELECT transit_status
        FROM inventory.transit_products
        WHERE dispatch_order_id = $1
        `,
        [dispatchOrderId]
      );

      if (transitResult.rows[0]?.transit_status === 'reached') {
        res.status(400);
        throw new Error('Internal packing dispatch already completed');
      }

      dispatchOrder.dispatch_status = 'packed';
    }

    if (!['packed', 'label_printed'].includes(dispatchOrder.dispatch_status)) {
      res.status(400);
      throw new Error('Only packed internal packing orders can be dispatched');
    }

    const itemsResult = await client.query(
      `
      SELECT
        doi.*,
        doi.packing_configs AS packing_configurations,
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
      ORDER BY doi.id ASC
      `,
      [dispatchOrderId]
    );

    const items = itemsResult.rows;

    if (!items.length) {
      res.status(400);
      throw new Error('No dispatch items found');
    }

    const sourceWarehouseId = getWarehouseIdFromSource(dispatchOrder.source);

    if (!sourceWarehouseId) {
      res.status(400);
      throw new Error('Warehouse source is required for internal packing dispatch');
    }

    const movedItems = [];

    for (const item of items) {
      const dispatchUnits = Number(item.no_of_units ?? item.qty ?? 0);
      const expDate = toPgDate(item.exp_date_text || item.exp_date);

      if (!Number.isFinite(dispatchUnits) || dispatchUnits <= 0) {
        throw new Error(`Invalid no_of_units for dispatch item ${item.id}`);
      }

      if (!expDate) {
        throw new Error(`Expiry date missing for dispatch item ${item.id}`);
      }

      const sourceProduct = item.inventory_product_id
        ? await findInventoryStockById(client, item.inventory_product_id, true)
        : await findInventoryStockForDispatch(
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
            true,
            sourceWarehouseId
          );

      if (!sourceProduct) {
        throw new Error(
          `Inventory stock not found for barcode ID ${item.product_barcode_id} and expiry ${expDate}`
        );
      }

      const availableUnits = Number(sourceProduct.no_of_units || 0);

      if (availableUnits < dispatchUnits) {
        throw new Error(
          `Insufficient stock for ${
            sourceProduct.product_name || item.product_barcode_id
          }. Available: ${availableUnits}, Required: ${dispatchUnits}`
        );
      }

      const sourceBalance = availableUnits - dispatchUnits;

      await client.query(
        `
        UPDATE inventory.inventory_products
        SET
          no_of_units = COALESCE(no_of_units, 0) - $1,
          count_in_stock = COALESCE(count_in_stock, 0) - $1,
          updated_at = NOW()
        WHERE id = $2
        `,
        [dispatchUnits, Number(sourceProduct.id)]
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
          dispatchOrder.source || 'INVENTORY',
          'INTERNAL_PACKING',
          'INTERNAL_PACKING_DISPATCH_OUT',
          0,
          dispatchUnits,
          sourceBalance,
        ]
      );

      let packingConfigurations =
        item.packing_configurations ||
        item.packingConfigurations ||
        [];

      if (!Array.isArray(packingConfigurations) || packingConfigurations.length === 0) {
        const packingConfigOverride = findPackingConfigOverride(req.body || {}, item, items.length);
        packingConfigurations = getPackingConfigs(packingConfigOverride || {});

        if (packingConfigurations.length) {
          await client.query(
            `
            UPDATE dispatch.dispatch_order_items
            SET packing_configs = $1::jsonb
            WHERE id = $2
            `,
            [JSON.stringify(packingConfigurations), Number(item.id)]
          );
        }
      }

      if (!Array.isArray(packingConfigurations) || packingConfigurations.length === 0) {
        console.log("INTERNAL PACKING ITEM", {
          id: item.id,
          keys: Object.keys(item),
          packing_configurations: item.packing_configurations,
        });
        res.status(400);
        throw new Error(`Packing configuration missing for dispatch item ${item.id}`);
      }

      const packingConfigs = normalizePackingConfigs({
        packing_configurations: packingConfigurations,
      });

      validatePackingConfigs(packingConfigs, `item ${item.id}`);

      for (let packingIndex = 0; packingIndex < packingConfigs.length; packingIndex += 1) {
        const packingConfig = packingConfigs[packingIndex];
        const packedUnits = Number(packingConfig.qty);
        const packingBarcode = await getCatalogBarcodeForPacking(
          client,
          packingConfig.product_barcode_id
        );

        if (!packingBarcode) {
          throw new Error(
            `Invalid packing product barcode ID ${packingConfig.product_barcode_id} for dispatch item ${item.id}`
          );
        }

        const targetSkuId = makeInternalPackingSkuId({
          dispatchOrderId,
          dispatchItemId: item.id,
          sourceSkuId: sourceProduct.sku_id,
          productBarcodeId: packingConfig.product_barcode_id,
          packingIndex: packingIndex + 1,
        });

        const existingPackedResult = await client.query(
          `
          SELECT *
          FROM inventory.inventory_products
          WHERE product_barcode_id = $1
            AND warehouse_id IS NOT DISTINCT FROM $2::bigint
            AND supplier_id IS NOT DISTINCT FROM $3
            AND business_entity_type = 'INTERNAL_PACKING'
          ORDER BY id ASC
          LIMIT 1
          FOR UPDATE
          `,
          [
            Number(packingConfig.product_barcode_id),
            sourceWarehouseId ? Number(sourceWarehouseId) : null,
            sourceProduct.supplier_id ? Number(sourceProduct.supplier_id) : null,
          ]
        );

        let packedProduct;

        if (existingPackedResult.rows[0]) {
          const packedResult = await client.query(
            `
            UPDATE inventory.inventory_products
            SET
              count_in_stock = COALESCE(count_in_stock, 0) + $1,
              no_of_units = COALESCE(no_of_units, 0) + $1,
              purchase_qty = COALESCE(purchase_qty, 0) + $1,
              business_entity_type = 'INTERNAL_PACKING',
              warehouse_id = $3,
              unit_price = $4,
              unit_mrp = $5,
              updated_at = NOW()
            WHERE id = $2
            RETURNING *
            `,
            [
              packedUnits,
              Number(existingPackedResult.rows[0].id),
              sourceWarehouseId ? Number(sourceWarehouseId) : null,
              Number(sourceProduct.unit_price || 0),
              Number(sourceProduct.unit_mrp || 0),
            ]
          );

          packedProduct = packedResult.rows[0];
        } else {
          const packedResult = await client.query(
            `
            INSERT INTO inventory.inventory_products (
              product_barcode_id,
              product_code,
              product_name,
              sku_id,
              hsn_code,
              bar_code,
              batch_id,
              category_id,
              brand_id,
              count_in_stock,
              no_of_units,
              stakeholders_id,
              business_entity_type,
              warehouse_id,
              mfg_date,
              exp_date,
              purchase_order_id,
              purchase_order_item_id,
              supplier_id,
              unit_id,
              purchase_qty,
              unit_price,
              unit_mrp,
              verified_by,
              verified_by_name,
              remarks
            )
            VALUES (
              $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
              $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
              $21,$22,$23,$24,$25,$26
            )
            ON CONFLICT ON CONSTRAINT products_sku_id_key
            DO UPDATE SET
              count_in_stock = COALESCE(inventory.inventory_products.count_in_stock, 0) + EXCLUDED.count_in_stock,
              no_of_units = COALESCE(inventory.inventory_products.no_of_units, 0) + EXCLUDED.no_of_units,
              purchase_qty = COALESCE(inventory.inventory_products.purchase_qty, 0) + EXCLUDED.purchase_qty,
              warehouse_id = EXCLUDED.warehouse_id,
              unit_price = EXCLUDED.unit_price,
              unit_mrp = EXCLUDED.unit_mrp,
              updated_at = NOW()
            RETURNING *
            `,
            [
              Number(packingConfig.product_barcode_id),
              packingBarcode.product_code || sourceProduct.product_code,
              packingBarcode.product_name_eng ||
                packingBarcode.product_name_tel ||
                sourceProduct.product_name,
              targetSkuId,
              packingBarcode.hsncode || sourceProduct.hsn_code,
              packingBarcode.mk_barcode || packingBarcode.barcode || sourceProduct.bar_code,
              sourceProduct.batch_id ? Number(sourceProduct.batch_id) : null,
              packingBarcode.category_id ? Number(packingBarcode.category_id) : null,
              packingBarcode.brand_id ? Number(packingBarcode.brand_id) : null,
              packedUnits,
              packedUnits,
              sourceProduct.stakeholders_id ? Number(sourceProduct.stakeholders_id) : null,
              'INTERNAL_PACKING',
              sourceWarehouseId ? Number(sourceWarehouseId) : null,
              sourceProduct.mfg_date || null,
              expDate,
              sourceProduct.purchase_order_id ? Number(sourceProduct.purchase_order_id) : null,
              sourceProduct.purchase_order_item_id
                ? Number(sourceProduct.purchase_order_item_id)
                : null,
              sourceProduct.supplier_id ? Number(sourceProduct.supplier_id) : null,
              packingBarcode.unit_id ? Number(packingBarcode.unit_id) : null,
              packedUnits,
              Number(sourceProduct.unit_price || 0),
              Number(sourceProduct.unit_mrp || 0),
              req.user?.username || req.user?.name || req.user?.first_name || 'SYSTEM',
              req.user?.username || req.user?.name || req.user?.first_name || 'SYSTEM',
              `Created from internal packing dispatch ${dispatchOrder.dispatch_no || dispatchOrderId}`,
            ]
          );

          packedProduct = packedResult.rows[0];
        }

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
            Number(packingBarcode.product_id),
            dispatchOrder.source || 'INVENTORY',
            'INTERNAL_PACKING',
            'INTERNAL_PACKING_STOCK_IN',
            packedUnits,
            0,
            Number(packedProduct.no_of_units || packedProduct.count_in_stock || 0),
          ]
        );

        movedItems.push({
          dispatch_item_id: Number(item.id),
          source_product_barcode_id: Number(item.product_barcode_id),
          packed_product_barcode_id: Number(packingConfig.product_barcode_id),
          source_inventory_product_id: Number(sourceProduct.id),
          packed_inventory_product_id: Number(packedProduct.id),
          source_qty: dispatchUnits,
          packed_qty: packedUnits,
          source_balance: sourceBalance,
          packed_balance: Number(packedProduct.no_of_units || packedProduct.count_in_stock || 0),
        });
      }
    }

    await client.query(
      `
      INSERT INTO inventory.transit_products (
        dispatch_order_id,
        transit_status
      )
      VALUES ($1, 'reached')
      ON CONFLICT (dispatch_order_id)
      DO UPDATE SET
        transit_status = 'reached',
        updated_at = NOW()
      `,
      [dispatchOrderId]
    );

    const updatedOrderResult = await client.query(
      `
      UPDATE dispatch.dispatch_order
      SET
        dispatch_status = 'dispatched',
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [dispatchOrderId]
    );

    await client.query('COMMIT');

    res.json({
      message: 'Internal packing dispatch completed successfully',
      order: updatedOrderResult.rows[0],
      movedItems,
    });
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
        COALESCE(pb.barcode, pb.mk_barcode) AS barcode,
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
        ip.unit_mrp AS inventory_unit_mrp,
        poi.expected_unit_price,
        poi.actual_unit_price
      FROM dispatch.dispatch_order_items doi
      JOIN catalog.product_barcodes pb ON pb.id = doi.product_barcode_id
      LEFT JOIN catalog.products p ON p.id = pb.product_id
      LEFT JOIN catalog.brands b ON b.id = pb.brand_id
      LEFT JOIN catalog.categories c ON c.id = pb.category_id
      LEFT JOIN catalog.units u ON u.id = pb.unit_id
      LEFT JOIN LATERAL (
        SELECT ip.unit_price, ip.unit_mrp
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
    const bodyItems = Array.isArray(req.body?.items) ? req.body.items : [];

    for (const item of items) {
      const barcodes = [...new Set([item.mk_barcode, item.barcode].filter(Boolean).map(String))];

      if (!barcodes.length) {
        res.status(400);
        throw new Error(`Barcode value missing for dispatch item ${item.id}`);
      }

      const qtyToAdd = Number(item.no_of_units ?? item.qty ?? 0);
      const bodyItem = bodyItems.find((receivedItem) =>
        Number(receivedItem.dispatch_order_item_id) === Number(item.id) ||
        Number(receivedItem.product_barcode_id) === Number(item.catalog_product_barcode_id)
      );
      const packagePrice = Number(
        bodyItem?.dprice ??
          bodyItem?.package_amount ??
          item.inventory_unit_price ??
          item.actual_unit_price ??
          item.expected_unit_price ??
          0
      );
      const mrpPrice = Number(
        bodyItem?.unit_mrp ??
          bodyItem?.unit_MRP ??
        bodyItem?.price ??
          bodyItem?.mrp_amount ??
          item.inventory_unit_mrp ??
          (packagePrice > 0 ? Math.round(packagePrice * 1.25) : 0)
      );
      const discount = Number(item.discount ?? item.Discount ?? 0);
      const sellingPrice = packagePrice;
      const unitPrice = mrpPrice;

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
        financial.price = unitPrice;
        financial.dprice = sellingPrice;
        financial.Discount = discount;
      } else {
        detail.financials.push({
          _id: new mongoose.Types.ObjectId(),
          catalogProductBarcodeId: Number(item.catalog_product_barcode_id),
          mkid: Number(item.catalog_product_barcode_id),
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

    if (dispatchOrder.dispatch_status === 'received_to_warehouse') {
      res.status(400);
      throw new Error('Dispatch already received to warehouse');
    }

    if (dispatchOrder.dispatch_status !== 'dispatched') {
      res.status(400);
      throw new Error('Only dispatched orders can be received by stakeholder');
    }

    const destinationType = String(dispatchOrder.destination || '')
      .split(':')[0]
      .toLowerCase();

    if (
      !['stakeholder', 'vendor', 'customer'].includes(destinationType) &&
      !isInternalPackingDestination(dispatchOrder.destination)
    ) {
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

    const receivedStatus = isInternalPackingDestination(dispatchOrder.destination)
      ? 'received_to_warehouse'
      : 'received_by_stakeholder';

    const updatedOrderResult = await client.query(
      `
      UPDATE dispatch.dispatch_order
      SET
        dispatch_status = $2,
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
      `,
      [dispatchOrderId, receivedStatus]
    );

    await client.query('COMMIT');

    res.json({
      message: isInternalPackingDestination(dispatchOrder.destination)
        ? 'Dispatch received to warehouse successfully'
        : 'Dispatch received by stakeholder successfully',
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

  if (
    req.body.dispatch_status !== undefined &&
    req.body.dispatch_status !== existing.dispatch_status
  ) {
    res.status(400);
    throw new Error('Use dispatch status endpoints to change dispatch status');
  }

  const { dispatch_status, ...updates } = req.body;
  const updated = await DispatchOrder.update(req.params.id, updates);
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
