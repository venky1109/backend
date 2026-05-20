import { getClient, query } from '../../config/pg.js';

const ROLLBACK_SCOPES = new Set([
  'single_transaction',
  'request_product',
  'full_request',
]);

const toNumber = (value, fallback = null) => {
  if (value === undefined || value === null || value === '') return fallback;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
};

const toPositiveNumber = (value, fieldName) => {
  const numberValue = toNumber(value);
  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    throw new Error(`${fieldName} must be greater than 0`);
  }
  return numberValue;
};

const parsePayload = (payload) => {
  if (!payload) return {};
  if (typeof payload === 'object') return payload;

  try {
    return JSON.parse(payload);
  } catch {
    return {};
  }
};

const toNumberList = (...values) => {
  const flattened = values.flatMap((value) => {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string' && value.includes(',')) {
      return value.split(',');
    }
    return [value];
  });

  return [
    ...new Set(
      flattened
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0)
    ),
  ];
};

const firstTruthy = (...values) => {
  return values.find((value) => value !== undefined && value !== null && value !== '');
};

const isMigrationText = (value) => {
  return /migration/i.test(String(value || ''));
};

const runQuery = (db, text, params) => {
  return db?.query ? db.query(text, params) : query(text, params);
};

const parseWarehouseId = (destination) => {
  const match = String(destination || '').match(/^WAREHOUSE:(\d+)$/i);
  return match ? Number(match[1]) : null;
};

const parsePurchaseOrderId = (source) => {
  const match = String(source || '').match(/^PURCHASE_ORDER:(\d+)$/i);
  return match ? Number(match[1]) : null;
};

const isMissingRequestTrackingSchema = (error) => {
  return (
    error?.code === '42P01' &&
    String(error?.message || '').includes('request_tracking.')
  );
};

const actorName = (user = {}) => {
  return (
    user.username ||
    user.name ||
    user.first_name ||
    user.email ||
    user._id?.toString?.() ||
    'SYSTEM'
  );
};

const normalizeInput = (data = {}) => {
  const scope = data.scope || data.rollback_scope || 'single_transaction';

  if (!ROLLBACK_SCOPES.has(scope)) {
    throw new Error(
      'scope must be one of single_transaction, request_product, full_request'
    );
  }

  return {
    request_id: toNumber(data.request_id ?? data.requestId),
    transaction_id: toNumber(data.transaction_id ?? data.transactionId),
    product_id: toNumber(data.product_id ?? data.productId),
    product_barcode_id: toNumber(
      data.product_barcode_id ??
        data.productBarcodeId ??
        data.product_barcodeId
    ),
    inventory_product_id: toNumber(
      data.inventory_product_id ?? data.inventoryProductId
    ),
    mk_barcode: data.mk_barcode ?? data.mkBarcode ?? null,
    outlet_id: data.outlet_id ?? data.outletId ?? null,
    warehouse_id: toNumber(data.warehouse_id ?? data.warehouseId),
    quantity:
      data.quantity === undefined || data.quantity === null || data.quantity === ''
        ? null
        : toPositiveNumber(data.quantity, 'quantity'),
    scope,
    reason: data.reason || data.rollback_reason || null,
    cleanup: data.cleanup || data.rollback_context || {},
  };
};

const getRequestById = async (db, requestId, lock = false) => {
  if (!requestId) return null;

  const { rows } = await runQuery(
    db,
    `
    SELECT *
    FROM request_tracking.requests
    WHERE id = $1
      AND request_type = 'inventory_migration'
    ${lock ? 'FOR UPDATE' : ''}
    `,
    [Number(requestId)]
  );

  return rows[0] || null;
};

const getStockTransactionById = async (db, transactionId) => {
  if (!transactionId) return null;

  try {
    const { rows } = await runQuery(
      db,
      `
      SELECT
        st.*,
        rt.request_id,
        COALESCE(rt.product_barcode_id, ip.product_barcode_id) AS product_barcode_id,
        ip.inventory_product_id
      FROM inventory.stock_transaction st
      LEFT JOIN LATERAL (
        SELECT
          r.id AS request_id,
          r.product_barcode_id,
          CASE
            WHEN r.payload->>'stock_transaction_id' ~ '^[0-9]+$'
             AND (r.payload->>'stock_transaction_id')::bigint = st.id
            THEN 0
            ELSE 1
          END AS match_rank
        FROM request_tracking.requests r
        WHERE r.request_type = 'inventory_migration'
          AND (
            (
              r.payload->>'stock_transaction_id' ~ '^[0-9]+$'
              AND (r.payload->>'stock_transaction_id')::bigint = st.id
            )
            OR (
              st.ref_type = 'PURCHASE_VERIFIED'
              AND r.status = 'completed'
              AND r.payload->>'purchase_order_id' = REPLACE(COALESCE(st.source, ''), 'PURCHASE_ORDER:', '')
              AND COALESCE(r.warehouse_id::text, r.payload->>'warehouse_id') = REPLACE(COALESCE(st.destination, ''), 'WAREHOUSE:', '')
              AND EXISTS (
                SELECT 1
                FROM catalog.product_barcodes pb
                WHERE pb.id = r.product_barcode_id
                  AND pb.product_id = st.product_id
              )
            )
          )
        ORDER BY match_rank ASC, r.updated_at DESC, r.id DESC
        LIMIT 1
      ) rt ON TRUE
      LEFT JOIN LATERAL (
        SELECT
          ip_inner.id AS inventory_product_id,
          ip_inner.product_barcode_id
        FROM inventory.inventory_products ip_inner
        LEFT JOIN catalog.product_barcodes pb_inner
          ON pb_inner.id = ip_inner.product_barcode_id
        WHERE pb_inner.product_id = st.product_id
          AND ip_inner.warehouse_id = CASE
            WHEN st.destination ~ '^WAREHOUSE:[0-9]+$'
            THEN REPLACE(st.destination, 'WAREHOUSE:', '')::bigint
            ELSE ip_inner.warehouse_id
          END
        ORDER BY ip_inner.updated_at DESC, ip_inner.id DESC
        LIMIT 1
      ) ip ON TRUE
      WHERE st.id = $1
      `,
      [Number(transactionId)]
    );

    return rows[0] || null;
  } catch (error) {
    if (!isMissingRequestTrackingSchema(error)) throw error;

    const { rows } = await runQuery(
      db,
      `
      SELECT
        st.*,
        NULL::bigint AS request_id,
        ip.product_barcode_id,
        ip.inventory_product_id
      FROM inventory.stock_transaction st
      LEFT JOIN LATERAL (
        SELECT
          ip_inner.id AS inventory_product_id,
          ip_inner.product_barcode_id
        FROM inventory.inventory_products ip_inner
        LEFT JOIN catalog.product_barcodes pb_inner
          ON pb_inner.id = ip_inner.product_barcode_id
        WHERE pb_inner.product_id = st.product_id
          AND ip_inner.warehouse_id = CASE
            WHEN st.destination ~ '^WAREHOUSE:[0-9]+$'
            THEN REPLACE(st.destination, 'WAREHOUSE:', '')::bigint
            ELSE ip_inner.warehouse_id
          END
        ORDER BY ip_inner.updated_at DESC, ip_inner.id DESC
        LIMIT 1
      ) ip ON TRUE
      WHERE st.id = $1
      `,
      [Number(transactionId)]
    );

    return rows[0] || null;
  }
};

const getRequestsForScope = async (db, input, selectedRequest, lock = false) => {
  if (input.scope === 'single_transaction') {
    return selectedRequest ? [selectedRequest] : [];
  }

  if (!selectedRequest) {
    throw new Error('request_id is required for request rollback scopes');
  }

  const selectedPayload = parsePayload(selectedRequest.payload);

  if (input.scope === 'request_product') {
    return [selectedRequest];
  }

  const purchaseOrderId =
    selectedPayload.purchase_order_id ||
    (selectedRequest.reference_type === 'purchase_order'
      ? selectedRequest.reference_id
      : null);

  if (!purchaseOrderId) {
    return [selectedRequest];
  }

  const { rows } = await runQuery(
    db,
    `
    SELECT *
    FROM request_tracking.requests
    WHERE request_type = 'inventory_migration'
      AND status = 'completed'
      AND (
        payload->>'purchase_order_id' = $1
        OR (
          reference_type = 'purchase_order'
          AND reference_id = $1
        )
      )
    ORDER BY id ASC
    ${lock ? 'FOR UPDATE' : ''}
    `,
    [String(purchaseOrderId)]
  );

  return rows.length ? rows : [selectedRequest];
};

const getInventoryProduct = async (db, input, requestRow, lock = false) => {
  const payload = parsePayload(requestRow?.payload);
  const inventoryProductId =
    input.inventory_product_id ||
    requestRow?.inventory_product_id ||
    payload.inventory_product_id;
  const productBarcodeId =
    input.product_barcode_id ||
    requestRow?.product_barcode_id ||
    payload.product_barcode_id;
  const productId = input.product_id || payload.product_id;
  const warehouseId =
    input.warehouse_id || requestRow?.warehouse_id || payload.warehouse_id;

  const values = [];
  const clauses = [];

  if (inventoryProductId) {
    values.push(Number(inventoryProductId));
    clauses.push(`ip.id = $${values.length}`);
  } else {
    if (productBarcodeId) {
      values.push(Number(productBarcodeId));
      clauses.push(`ip.product_barcode_id = $${values.length}`);
    }

    if (productId) {
      values.push(Number(productId));
      clauses.push(`pb.product_id = $${values.length}`);
    }

    if (warehouseId) {
      values.push(Number(warehouseId));
      clauses.push(`ip.warehouse_id = $${values.length}`);
    }

    if (payload.sku_id) {
      values.push(payload.sku_id);
      clauses.push(`ip.sku_id = $${values.length}`);
    }

    if (payload.purchase_order_item_id) {
      values.push(Number(payload.purchase_order_item_id));
      clauses.push(`ip.purchase_order_item_id = $${values.length}`);
    }
  }

  if (!clauses.length) {
    throw new Error('Unable to identify inventory product for rollback');
  }

  const { rows } = await runQuery(
    db,
    `
    SELECT
      ip.*,
      pb.product_id AS catalog_product_id,
      pb.mk_barcode,
      pb.barcode
    FROM inventory.inventory_products ip
    LEFT JOIN catalog.product_barcodes pb
      ON pb.id = ip.product_barcode_id
    WHERE ${clauses.join(' AND ')}
    ORDER BY ip.updated_at DESC, ip.id DESC
    LIMIT 1
    ${lock ? 'FOR UPDATE OF ip' : ''}
    `,
    values
  );

  return rows[0] || null;
};

const validateProductSelection = (input, requestRow, inventoryProduct) => {
  const payload = parsePayload(requestRow?.payload);
  const expectedProductBarcodeId =
    requestRow?.product_barcode_id ||
    payload.product_barcode_id ||
    inventoryProduct?.product_barcode_id;
  const expectedInventoryProductId =
    requestRow?.inventory_product_id ||
    payload.inventory_product_id ||
    inventoryProduct?.id;
  const expectedProductId =
    payload.product_id ||
    inventoryProduct?.catalog_product_id ||
    inventoryProduct?.product_id;

  if (
    input.product_barcode_id &&
    expectedProductBarcodeId &&
    Number(input.product_barcode_id) !== Number(expectedProductBarcodeId)
  ) {
    throw new Error('Selected product_barcode_id does not belong to this request');
  }

  if (
    input.inventory_product_id &&
    expectedInventoryProductId &&
    Number(input.inventory_product_id) !== Number(expectedInventoryProductId)
  ) {
    throw new Error('Selected inventory_product_id does not belong to this request');
  }

  if (
    input.product_id &&
    expectedProductId &&
    Number(input.product_id) !== Number(expectedProductId)
  ) {
    throw new Error('Selected product_id does not belong to this request');
  }

  if (
    input.mk_barcode &&
    inventoryProduct?.mk_barcode &&
    String(input.mk_barcode) !== String(inventoryProduct.mk_barcode)
  ) {
    throw new Error('Selected mk_barcode does not belong to this request');
  }
};

const getDefaultRollbackQty = (input, requestRow, inventoryProduct, transaction) => {
  if (input.quantity && input.scope !== 'full_request') return input.quantity;

  const payload = parsePayload(requestRow?.payload);
  const itemQty = payload.items?.[0]?.quantity;

  return toNumber(
    itemQty ??
      transaction?.qty_in ??
      payload.no_of_units ??
      payload.qty ??
      inventoryProduct?.no_of_units,
    0
  );
};

const getRelatedStockTransaction = async (db, input, requestRow, inventoryProduct) => {
  if (input.transaction_id) {
    return getStockTransactionById(db, input.transaction_id);
  }

  const payload = parsePayload(requestRow?.payload);
  const purchaseOrderId = payload.purchase_order_id;
  const warehouseId =
    input.warehouse_id || requestRow?.warehouse_id || payload.warehouse_id;
  const productId =
    payload.product_id ||
    inventoryProduct?.catalog_product_id ||
    inventoryProduct?.product_id;

  if (!productId) return null;

  const values = [Number(productId)];
  const clauses = [
    'product_id = $1',
    "ref_type = 'PURCHASE_VERIFIED'",
  ];

  if (purchaseOrderId) {
    values.push(`PURCHASE_ORDER:${purchaseOrderId}`);
    clauses.push(`source = $${values.length}`);
  }

  if (warehouseId) {
    values.push(`WAREHOUSE:${warehouseId}`);
    clauses.push(`destination = $${values.length}`);
  }

  const { rows } = await runQuery(
    db,
    `
    SELECT *
    FROM inventory.stock_transaction
    WHERE ${clauses.join(' AND ')}
    ORDER BY created_at DESC, id DESC
    LIMIT 1
    `,
    values
  );

  return rows[0] || null;
};

const getPurchaseContext = async (db, requestRow, transaction, inventoryProduct) => {
  const payload = parsePayload(requestRow?.payload);
  const purchaseOrderId =
    payload.purchase_order_id || parsePurchaseOrderId(transaction?.source);
  const purchaseOrderItemId = payload.purchase_order_item_id;
  const productId =
    payload.product_id ||
    transaction?.product_id ||
    inventoryProduct?.catalog_product_id ||
    inventoryProduct?.product_id;

  if (!purchaseOrderId) {
    return {
      purchase_order_id: null,
      purchase_order_item_id: null,
      purchase_order_status: null,
      purchase_order_item: null,
    };
  }

  const poResult = await runQuery(
    db,
    `
    SELECT id, po_number, status, remarks, total_amount, bill_details, updated_at
    FROM purchases.purchase_order
    WHERE id = $1
    `,
    [Number(purchaseOrderId)]
  );

  const values = [Number(purchaseOrderId)];
  const clauses = ['purchase_order_id = $1'];

  if (purchaseOrderItemId) {
    values.push(Number(purchaseOrderItemId));
    clauses.push(`id = $${values.length}`);
  } else if (productId) {
    values.push(Number(productId));
    clauses.push(`product_id = $${values.length}`);
  }

  const itemResult = await runQuery(
    db,
    `
    SELECT *
    FROM purchases.purchase_order_items
    WHERE ${clauses.join(' AND ')}
    ORDER BY id DESC
    LIMIT 1
    `,
    values
  );

  return {
    purchase_order_id: Number(purchaseOrderId),
    purchase_order_item_id: itemResult.rows[0]?.id
      ? Number(itemResult.rows[0].id)
      : purchaseOrderItemId || null,
    purchase_order_status: poResult.rows[0]?.status || null,
    purchase_order: poResult.rows[0] || null,
    purchase_order_item: itemResult.rows[0] || null,
    is_migration_purchase: Boolean(
      poResult.rows[0] &&
        (
          isMigrationText(poResult.rows[0].remarks) ||
          isMigrationText(poResult.rows[0].po_number) ||
          isMigrationText(JSON.stringify(poResult.rows[0].bill_details || {}))
        )
    ),
  };
};

const getCatalogContext = async (db, productBarcodeId) => {
  if (!productBarcodeId) return null;

  const { rows } = await runQuery(
    db,
    `
    SELECT
      pb.*,
      p.product_code,
      COALESCE(p.product_name_eng, p.product_name_tel, p.product_code) AS product_name,
      b.brand_name_english,
      c.category_name_english,
      u.unit_short_code
    FROM catalog.product_barcodes pb
    LEFT JOIN catalog.products p ON p.id = pb.product_id
    LEFT JOIN catalog.brands b ON b.id = pb.brand_id
    LEFT JOIN catalog.categories c ON c.id = pb.category_id
    LEFT JOIN catalog.units u ON u.id = pb.unit_id
    WHERE pb.id = $1
    LIMIT 1
    `,
    [Number(productBarcodeId)]
  );

  return rows[0] || null;
};

const getCleanupContext = (input, requestRow, purchaseContext, catalogContext) => {
  const payload = parsePayload(requestRow?.payload);
  const metadata = parsePayload(requestRow?.metadata);
  const rollbackContext = {
    ...parsePayload(payload.rollback_context),
    ...parsePayload(metadata.rollback_context),
    ...parsePayload(input.cleanup),
  };

  const purchaseCreated = Boolean(
    firstTruthy(
      rollbackContext.purchase_created,
      rollbackContext.created_purchase,
      rollbackContext.created_purchase_order,
      payload.purchase_created,
      payload.created_purchase,
      payload.created_purchase_order,
      metadata.purchase_created,
      metadata.created_purchase,
      purchaseContext?.is_migration_purchase
    )
  );
  const catalogCreated = Boolean(
    firstTruthy(
      rollbackContext.catalog_created,
      rollbackContext.created_catalog,
      rollbackContext.created_catalog_barcode,
      payload.catalog_created,
      payload.created_catalog,
      payload.created_catalog_barcode,
      metadata.catalog_created,
      metadata.created_catalog
    )
  );

  const createdPurchaseOrderIds = toNumberList(
    rollbackContext.created_purchase_order_id,
    rollbackContext.created_purchase_order_ids,
    rollbackContext.purchase_order_created_id,
    payload.created_purchase_order_id,
    payload.created_purchase_order_ids,
    metadata.created_purchase_order_id,
    purchaseCreated ? purchaseContext?.purchase_order_id : null
  );
  const createdPurchaseOrderItemIds = toNumberList(
    rollbackContext.created_purchase_order_item_id,
    rollbackContext.created_purchase_order_item_ids,
    rollbackContext.purchase_order_item_created_id,
    payload.created_purchase_order_item_id,
    payload.created_purchase_order_item_ids,
    metadata.created_purchase_order_item_id,
    purchaseCreated ? purchaseContext?.purchase_order_item_id : null
  );
  const createdCatalogProductBarcodeIds = toNumberList(
    rollbackContext.created_catalog_product_barcode_id,
    rollbackContext.created_catalog_product_barcode_ids,
    rollbackContext.created_product_barcode_id,
    rollbackContext.created_product_barcode_ids,
    payload.created_catalog_product_barcode_id,
    payload.created_catalog_product_barcode_ids,
    payload.created_product_barcode_id,
    metadata.created_catalog_product_barcode_id,
    catalogCreated ? catalogContext?.id : null
  );

  return {
    purchase_created: purchaseCreated || createdPurchaseOrderIds.length > 0 || createdPurchaseOrderItemIds.length > 0,
    catalog_created: catalogCreated || createdCatalogProductBarcodeIds.length > 0,
    created_purchase_order_ids: createdPurchaseOrderIds,
    created_purchase_order_item_ids: createdPurchaseOrderItemIds,
    created_catalog_product_barcode_ids: createdCatalogProductBarcodeIds,
  };
};

const getAlreadyRolledBackTransactionIds = async (db, transactionIds) => {
  const ids = transactionIds.filter(Boolean).map(Number);
  if (!ids.length) return new Set();

  try {
    const { rows } = await runQuery(
      db,
      `
      SELECT DISTINCT jsonb_array_elements_text(payload->'transaction_ids') AS transaction_id
      FROM request_tracking.requests
      WHERE request_type = 'product_migration_rollback'
        AND status = 'completed'
        AND payload ? 'transaction_ids'
      `
    );

    const rolledBackIds = new Set(rows.map((row) => Number(row.transaction_id)));
    return new Set(ids.filter((id) => rolledBackIds.has(id)));
  } catch (error) {
    if (isMissingRequestTrackingSchema(error)) return new Set();
    throw error;
  }
};

const addRollbackBlockingWarnings = (
  warnings,
  { inventoryProduct, transaction, rollbackQty, afterUnits, afterCountInStock }
) => {
  if (transaction && Number(transaction.qty_in || 0) < rollbackQty) {
    warnings.push(
      `Transaction ${transaction.id} inbound quantity is only ${Number(transaction.qty_in || 0)}, cannot rollback ${rollbackQty}`
    );
  }

  if (afterUnits < 0) {
    warnings.push(
      `Stock quantity is only ${Number(inventoryProduct.no_of_units || 0)}, cannot rollback ${rollbackQty} from inventory product ${inventoryProduct.id}`
    );
  }

  if (afterCountInStock < 0) {
    warnings.push(
      `Count in stock is only ${Number(inventoryProduct.count_in_stock || 0)}, cannot rollback ${rollbackQty} from inventory product ${inventoryProduct.id}`
    );
  }
};

const buildPreview = async (db, input, { lock = false } = {}) => {
  const selectedRequest = await getRequestById(db, input.request_id, lock);
  const selectedTransaction = await getStockTransactionById(
    db,
    input.transaction_id
  );

  if (input.request_id && !selectedRequest) {
    throw new Error('Inventory migration request not found');
  }

  if (input.transaction_id && !selectedTransaction) {
    throw new Error('Stock transaction not found');
  }

  if (input.scope === 'single_transaction' && !selectedTransaction && !selectedRequest) {
    throw new Error('transaction_id or request_id is required for single_transaction rollback');
  }

  if (
    selectedTransaction &&
    selectedTransaction.ref_type !== 'PURCHASE_VERIFIED'
  ) {
    throw new Error('Only PURCHASE_VERIFIED stock transactions can be rolled back');
  }

  const requestRows = await getRequestsForScope(
    db,
    input,
    selectedRequest,
    lock
  );

  if (!requestRows.length && !selectedTransaction) {
    throw new Error('No migration rows found for rollback');
  }

  const fallbackRequest =
    selectedRequest ||
    requestRows[0] ||
    (selectedTransaction
      ? {
          id: selectedTransaction.request_id || null,
          product_barcode_id: selectedTransaction.product_barcode_id || null,
          inventory_product_id: selectedTransaction.inventory_product_id || null,
          warehouse_id: parseWarehouseId(selectedTransaction.destination),
          payload: {
            product_id: selectedTransaction.product_id,
            product_barcode_id: selectedTransaction.product_barcode_id || null,
            inventory_product_id: selectedTransaction.inventory_product_id || null,
            warehouse_id: parseWarehouseId(selectedTransaction.destination),
          },
        }
      : null);
  const rowsToProcess = requestRows.length ? requestRows : [fallbackRequest];
  const affectedProducts = [];
  const warnings = [];

  for (const requestRow of rowsToProcess) {
    const inventoryProduct = await getInventoryProduct(
      db,
      input,
      requestRow,
      lock
    );

    if (!inventoryProduct) {
      throw new Error('Inventory product not found for rollback');
    }

    validateProductSelection(input, requestRow, inventoryProduct);

    const transaction =
      rowsToProcess.length === 1 && selectedTransaction
        ? selectedTransaction
        : await getRelatedStockTransaction(db, input, requestRow, inventoryProduct);

    if (
      selectedTransaction &&
      Number(selectedTransaction.product_id) !==
        Number(inventoryProduct.catalog_product_id || inventoryProduct.product_id)
    ) {
      throw new Error('Selected transaction does not belong to this product');
    }

    const requestPayload = parsePayload(requestRow?.payload);

    if (
      selectedTransaction &&
      requestPayload.purchase_order_id &&
      selectedTransaction.source &&
      selectedTransaction.source !== `PURCHASE_ORDER:${requestPayload.purchase_order_id}`
    ) {
      throw new Error('Selected transaction does not belong to this request');
    }

    const requestWarehouseId =
      requestRow?.warehouse_id || requestPayload.warehouse_id;

    if (
      selectedTransaction &&
      requestWarehouseId &&
      selectedTransaction.destination &&
      selectedTransaction.destination !== `WAREHOUSE:${requestWarehouseId}`
    ) {
      throw new Error('Selected transaction does not belong to this request warehouse');
    }

    const rollbackQty = getDefaultRollbackQty(
      input,
      requestRow,
      inventoryProduct,
      transaction
    );

    if (!Number.isFinite(rollbackQty) || rollbackQty <= 0) {
      throw new Error('Unable to determine rollback quantity');
    }

    const beforeStock = Number(inventoryProduct.no_of_units || 0);
    const beforeCountInStock = Number(inventoryProduct.count_in_stock || 0);
    const afterStock = beforeStock - rollbackQty;
    const afterCountInStock = beforeCountInStock - rollbackQty;

    if (!transaction) {
      warnings.push(
        `Cannot rollback inventory product ${inventoryProduct.id} because no PURCHASE_VERIFIED stock transaction was found`
      );
    }

    addRollbackBlockingWarnings(warnings, {
      inventoryProduct,
      transaction,
      rollbackQty,
      afterUnits: afterStock,
      afterCountInStock,
    });

    const purchaseContext = await getPurchaseContext(
      db,
      requestRow,
      transaction,
      inventoryProduct
    );
    const catalogContext = await getCatalogContext(
      db,
      inventoryProduct.product_barcode_id
    );
    const cleanupContext = getCleanupContext(
      input,
      requestRow,
      purchaseContext,
      catalogContext
    );

    if (!catalogContext) {
      warnings.push(
        `Catalog barcode ${inventoryProduct.product_barcode_id || 'unknown'} was not found for inventory product ${inventoryProduct.id}`
      );
    }

    affectedProducts.push({
      request_id: requestRow?.id ? Number(requestRow.id) : null,
      inventory_product_id: Number(inventoryProduct.id),
      product_id: Number(
        inventoryProduct.catalog_product_id || inventoryProduct.product_id
      ),
      product_barcode_id: inventoryProduct.product_barcode_id
        ? Number(inventoryProduct.product_barcode_id)
        : null,
      product_name: inventoryProduct.product_name,
      sku_id: inventoryProduct.sku_id,
      warehouse_id: inventoryProduct.warehouse_id
        ? Number(inventoryProduct.warehouse_id)
        : null,
      transaction_id: transaction?.id ? Number(transaction.id) : null,
      rollback_quantity: rollbackQty,
      stock_before: beforeStock,
      stock_after: afterStock,
      count_in_stock_before: beforeCountInStock,
      count_in_stock_after: afterCountInStock,
      purchase_qty_before: Number(inventoryProduct.purchase_qty || 0),
      purchase_qty_after: null,
      purchase_qty_adjusted: false,
      purchase: purchaseContext,
      cleanup: cleanupContext,
      catalog: catalogContext
        ? {
            product_barcode_id: Number(catalogContext.id),
            product_id: Number(catalogContext.product_id),
            mk_barcode: catalogContext.mk_barcode,
            barcode: catalogContext.barcode,
            product_name: catalogContext.product_name,
            brand_name: catalogContext.brand_name_english,
            category_name: catalogContext.category_name_english,
            unit: catalogContext.unit_short_code,
            is_active: catalogContext.is_active,
          }
        : null,
      transaction_reference: transaction
        ? {
            id: Number(transaction.id),
            ref_type: transaction.ref_type,
            source: transaction.source,
            destination: transaction.destination,
            qty_in: Number(transaction.qty_in || 0),
            qty_out: Number(transaction.qty_out || 0),
            balance_qty: Number(transaction.balance_qty || 0),
          }
        : null,
    });
  }

  const alreadyRolledBackIds = await getAlreadyRolledBackTransactionIds(
    db,
    affectedProducts.map((item) => item.transaction_id)
  );

  for (const item of affectedProducts) {
    if (item.transaction_id && alreadyRolledBackIds.has(item.transaction_id)) {
      warnings.push(
        `Stock transaction ${item.transaction_id} already has a completed rollback record`
      );
    }
  }

  const canRollback =
    affectedProducts.length > 0 &&
    affectedProducts.every((item) => Boolean(item.transaction_reference)) &&
    affectedProducts.every((item) => Boolean(item.catalog)) &&
    affectedProducts.every((item) => item.stock_after >= 0) &&
    affectedProducts.every((item) => item.count_in_stock_after >= 0) &&
    affectedProducts.every(
      (item) =>
        !item.transaction_reference ||
        item.rollback_quantity <= Number(item.transaction_reference.qty_in || 0)
    ) &&
    affectedProducts.every(
      (item) => !item.transaction_id || !alreadyRolledBackIds.has(item.transaction_id)
    );

  return {
    scope: input.scope,
    request_id: input.request_id,
    transaction_id: input.transaction_id,
    affected_rows: affectedProducts.length,
    affected_tables: [
      'inventory.inventory_products',
      'inventory.stock_transaction',
      'purchases.purchase_order',
      'catalog.product_barcodes',
    ],
    mutated_tables: [
      'inventory.inventory_products',
      'inventory.stock_transaction',
      'purchases.purchase_order',
      'purchases.purchase_order_items',
      'catalog.product_barcodes',
      'request_tracking.requests',
    ],
    validation_tables: [
      'catalog.product_barcodes',
      'purchases.purchase_order_items',
    ],
    affected_products: affectedProducts,
    stock_before_after: affectedProducts.map((item) => ({
      inventory_product_id: item.inventory_product_id,
      stock_before: item.stock_before,
      stock_after: item.stock_after,
      count_in_stock_before: item.count_in_stock_before,
      count_in_stock_after: item.count_in_stock_after,
      rollback_quantity: item.rollback_quantity,
    })),
    transaction_references: affectedProducts
      .map((item) => item.transaction_reference)
      .filter(Boolean),
    warnings,
    can_rollback: canRollback,
  };
};

const insertRollbackAudit = async (db, input, preview, user) => {
  const requestedBy = actorName(user);
  const transactionIds = preview.affected_products
    .map((item) => item.transaction_id)
    .filter(Boolean);
  const requestIds = preview.affected_products
    .map((item) => item.request_id)
    .filter(Boolean);
  const payload = {
    original_request_id: input.request_id,
    original_request_ids: requestIds,
    transaction_id: input.transaction_id,
    transaction_ids: transactionIds,
    scope: input.scope,
    reason: input.reason,
    affected_products: preview.affected_products,
    warnings: preview.warnings,
    cleanup: preview.cleanup || null,
  };

  try {
    const { rows } = await runQuery(
      db,
      `
      INSERT INTO request_tracking.requests (
        request_key,
        request_type,
        source_domain,
        target_domain,
        warehouse_id,
        inventory_product_id,
        product_barcode_id,
        reference_type,
        reference_id,
        current_step_code,
        status,
        payload,
        requested_by,
        updated_by,
        started_at,
        completed_at
      )
      VALUES (
        $1,
        'product_migration_rollback',
        'inventory',
        'inventory',
        $2,
        $3,
        $4,
        'inventory_migration',
        $5,
        'product_rollback',
        'completed',
        $6::jsonb,
        $7,
        $7,
        NOW(),
        NOW()
      )
      RETURNING *
      `,
      [
        `PRODUCT_MIGRATION_ROLLBACK:${input.scope}:${input.request_id || 'REQ'}:${input.transaction_id || 'TX'}:${Date.now()}`,
        preview.affected_products[0]?.warehouse_id || null,
        preview.affected_products[0]?.inventory_product_id || null,
        preview.affected_products[0]?.product_barcode_id || null,
        input.request_id ? String(input.request_id) : null,
        JSON.stringify(payload),
        requestedBy,
      ]
    );

    const request = rows[0];

    const stepResult = await runQuery(
      db,
      `
      INSERT INTO request_tracking.request_steps (
        request_id,
        step_order,
        step_code,
        step_name,
        step_domain,
        processor,
        status,
        attempt_count,
        max_attempts,
        completed_at
      )
      VALUES (
        $1,
        1,
        'product_rollback',
        'Product migration rollback',
        'inventory',
        'ProductMigrationRollback.rollback',
        'completed',
        1,
        1,
        NOW()
      )
      RETURNING *
      `,
      [Number(request.id)]
    );

    await runQuery(
      db,
      `
      INSERT INTO request_tracking.request_events (
        request_id,
        request_step_id,
        event_type,
        to_status,
        message,
        event_payload,
        created_by
      )
      VALUES (
        $1,
        $2,
        'product_migration_rollback',
        'completed',
        $3,
        $4::jsonb,
        $5
      )
      `,
      [
        Number(request.id),
        stepResult.rows[0]?.id ? Number(stepResult.rows[0].id) : null,
        input.reason || 'Product migration rollback completed',
        JSON.stringify(payload),
        requestedBy,
      ]
    );

    return request;
  } catch (error) {
    if (isMissingRequestTrackingSchema(error)) return null;
    throw error;
  }
};

const deleteMigrationCreatedPurchaseRows = async (db, affectedProducts) => {
  const purchaseOrderItemIds = toNumberList(
    ...affectedProducts.map((item) => item.cleanup?.created_purchase_order_item_ids || [])
  );
  const purchaseOrderIds = toNumberList(
    ...affectedProducts.map((item) => item.cleanup?.created_purchase_order_ids || [])
  );

  const deletedItems = [];
  const deletedOrders = [];
  const skipped = [];

  for (const itemId of purchaseOrderItemIds) {
    const result = await runQuery(
      db,
      `
      DELETE FROM purchases.purchase_order_items poi
      WHERE poi.id = $1
        AND NOT EXISTS (
          SELECT 1
          FROM inventory.inventory_products ip
          WHERE ip.purchase_order_item_id = poi.id
            AND COALESCE(ip.no_of_units, 0) > 0
        )
      RETURNING *
      `,
      [Number(itemId)]
    );

    if (result.rows[0]) {
      deletedItems.push(result.rows[0]);
    } else {
      skipped.push({
        table: 'purchases.purchase_order_items',
        id: Number(itemId),
        reason: 'Row was not found or still has positive inventory references',
      });
    }
  }

  for (const orderId of purchaseOrderIds) {
    await runQuery(
      db,
      `
      DELETE FROM purchases.purchase_order_items poi
      WHERE poi.purchase_order_id = $1
        AND NOT EXISTS (
          SELECT 1
          FROM inventory.inventory_products ip
          WHERE ip.purchase_order_item_id = poi.id
            AND COALESCE(ip.no_of_units, 0) > 0
        )
      `,
      [Number(orderId)]
    );

    const result = await runQuery(
      db,
      `
      DELETE FROM purchases.purchase_order po
      WHERE po.id = $1
        AND NOT EXISTS (
          SELECT 1
          FROM purchases.purchase_order_items poi
          WHERE poi.purchase_order_id = po.id
        )
        AND NOT EXISTS (
          SELECT 1
          FROM inventory.inventory_products ip
          WHERE ip.purchase_order_id = po.id
            AND COALESCE(ip.no_of_units, 0) > 0
        )
      RETURNING *
      `,
      [Number(orderId)]
    );

    if (result.rows[0]) {
      deletedOrders.push(result.rows[0]);
    } else {
      skipped.push({
        table: 'purchases.purchase_order',
        id: Number(orderId),
        reason: 'Order was not found, still has items, or still has positive inventory references',
      });
    }
  }

  return {
    deletedPurchaseOrderItems: deletedItems,
    deletedPurchaseOrders: deletedOrders,
    skipped,
  };
};

const deleteMigrationCreatedCatalogRows = async (db, affectedProducts) => {
  const productBarcodeIds = toNumberList(
    ...affectedProducts.map((item) => item.cleanup?.created_catalog_product_barcode_ids || [])
  );
  const deletedBarcodes = [];
  const skipped = [];

  for (const productBarcodeId of productBarcodeIds) {
    const result = await runQuery(
      db,
      `
      DELETE FROM catalog.product_barcodes pb
      WHERE pb.id = $1
        AND NOT EXISTS (
          SELECT 1
          FROM inventory.inventory_products ip
          WHERE ip.product_barcode_id = pb.id
        )
        AND NOT EXISTS (
          SELECT 1
          FROM dispatch.dispatch_order_items doi
          WHERE doi.product_barcode_id = pb.id
        )
      RETURNING *
      `,
      [Number(productBarcodeId)]
    );

    if (result.rows[0]) {
      deletedBarcodes.push(result.rows[0]);
    } else {
      skipped.push({
        table: 'catalog.product_barcodes',
        id: Number(productBarcodeId),
        reason: 'Catalog barcode was not found or is still referenced by inventory/dispatch rows',
      });
    }
  }

  return {
    deletedCatalogProductBarcodes: deletedBarcodes,
    skipped,
  };
};

const cleanupMigrationCreatedRows = async (db, affectedProducts) => {
  const purchaseCleanup = await deleteMigrationCreatedPurchaseRows(
    db,
    affectedProducts
  );
  const catalogCleanup = await deleteMigrationCreatedCatalogRows(
    db,
    affectedProducts
  );

  return {
    ...purchaseCleanup,
    ...catalogCleanup,
    skipped: [...purchaseCleanup.skipped, ...catalogCleanup.skipped],
  };
};

export const ProductMigrationRollback = {
  async preview(data = {}) {
    const input = normalizeInput(data);
    return buildPreview(null, input);
  },

  async rollback(data = {}, user = {}) {
    const input = normalizeInput(data);
    const client = await getClient();

    try {
      await client.query('BEGIN');

      const preview = await buildPreview(client, input, { lock: true });

      if (!preview.can_rollback) {
        const message =
          preview.warnings.find((warning) =>
            warning.includes('already has a completed rollback record')
          ) ||
          preview.warnings.find((warning) => warning.includes('cannot rollback')) ||
          'Rollback cannot be completed';
        throw new Error(message);
      }

      const updatedProducts = [];
      const rollbackTransactions = [];

      for (const item of preview.affected_products) {
        const productResult = await client.query(
          `
          UPDATE inventory.inventory_products
          SET
            no_of_units = COALESCE(no_of_units, 0) - $1,
            count_in_stock = COALESCE(count_in_stock, 0) - $1,
            purchase_order_id = CASE
              WHEN purchase_order_id = $4 THEN NULL
              ELSE purchase_order_id
            END,
            purchase_order_item_id = CASE
              WHEN purchase_order_item_id = $5 THEN NULL
              ELSE purchase_order_item_id
            END,
            remarks = COALESCE($2, remarks),
            updated_at = NOW()
          WHERE id = $3
            AND COALESCE(no_of_units, 0) >= $1
            AND COALESCE(count_in_stock, 0) >= $1
          RETURNING *
          `,
          [
            item.rollback_quantity,
            input.reason || null,
            Number(item.inventory_product_id),
            item.purchase?.purchase_order_id
              ? Number(item.purchase.purchase_order_id)
              : null,
            item.purchase?.purchase_order_item_id
              ? Number(item.purchase.purchase_order_item_id)
              : null,
          ]
        );

        const updatedProduct = productResult.rows[0];

        if (!updatedProduct) {
          throw new Error(
            `Stock changed while rolling back inventory product ${item.inventory_product_id}; rollback would make stock negative`
          );
        }

        updatedProducts.push(updatedProduct);

        const transactionResult = await client.query(
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
          RETURNING *
          `,
          [
            Number(item.product_id),
            `WAREHOUSE:${item.warehouse_id || updatedProduct.warehouse_id || 'UNKNOWN'}`,
            `ROLLBACK:${input.scope}`,
            'PRODUCT_MIGRATION_ROLLBACK',
            0,
            item.rollback_quantity,
            Number(updatedProduct.count_in_stock || 0),
          ]
        );

        rollbackTransactions.push(transactionResult.rows[0]);
      }

      const cleanup = await cleanupMigrationCreatedRows(
        client,
        preview.affected_products
      );

      const auditRequest = await insertRollbackAudit(
        client,
        input,
        {
          ...preview,
          cleanup,
        },
        user
      );

      await client.query('COMMIT');

      return {
        message: 'Product migration rollback completed',
        rollback: {
          scope: input.scope,
          reason: input.reason,
          affected_rows: preview.affected_rows,
          affected_products: preview.affected_products,
          warnings: preview.warnings,
        },
        inventoryProducts: updatedProducts,
        cleanup,
        stockTransactions: rollbackTransactions,
        requestTracking: auditRequest,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },
};
