import { query } from '../../config/pg.js';

const toLimit = (value, fallback = 100) => {
  const limit = Number(value);
  if (!Number.isFinite(limit) || limit <= 0) return fallback;
  return Math.min(limit, 500);
};

const toOffset = (value) => {
  const offset = Number(value);
  return Number.isFinite(offset) && offset > 0 ? offset : 0;
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

const addFilter = (filters, values, clause, value) => {
  if (value === undefined || value === null || value === '') return;
  values.push(value);
  filters.push(clause.replace('?', `$${values.length}`));
};

const addNumberFilter = (filters, values, clause, value) => {
  if (value === undefined || value === null || value === '') return;

  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return;

  values.push(numberValue);
  filters.push(clause.replace('?', `$${values.length}`));
};

const isMissingRequestTrackingSchema = (error) => {
  return (
    error?.code === '42P01' &&
    String(error?.message || '').includes('request_tracking.')
  );
};

const missingSchemaResult = (fallback) => {
  Object.defineProperty(fallback, 'requestTrackingSetupRequired', {
    value: true,
    enumerable: false,
  });

  return fallback;
};

const runQuery = (db, text, params) => {
  return db?.query ? db.query(text, params) : query(text, params);
};

const parseLocationId = (value, expectedType) => {
  const parts = String(value || '').split(':');
  if (parts[0] !== expectedType) return null;

  const id = Number(parts[1]);
  return Number.isFinite(id) ? id : null;
};

const toNumber = (value, fallback = 0) => {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
};

const buildDispatchReceivePayload = async (db, dispatchOrder) => {
  const dispatchOrderId = Number(dispatchOrder?.id);

  const payload = {
    dispatch_order_id: dispatchOrderId,
    dispatch_no: dispatchOrder.dispatch_no,
    dispatch_status: dispatchOrder.dispatch_status,
    source: dispatchOrder.source,
    destination: dispatchOrder.destination,
    items: [],
  };

  if (!dispatchOrderId) return payload;

  const { rows } = await runQuery(
    db,
    `
    SELECT
      doi.product_id,
      doi.brand_id,
      doi.category_id,
      doi.unit_id,
      COALESCE(doi.no_of_units, doi.qty, 0) AS quantity,
      COALESCE(p.product_name_eng, p.product_name_tel, p.product_code, doi.product_id::text) AS product_name,
      COALESCE(b.brand_name_english, b.brand_name_telugu, doi.brand_id::text) AS brand_name,
      COALESCE(c.category_name_english, c.category_name_telugu, doi.category_id::text) AS category_name,
      COALESCE(u.unit_short_code, u.unit_name, doi.unit_id::text) AS unit,
      COALESCE(poi.actual_unit_price, poi.expected_unit_price, ip.unit_price, 0) AS unit_price
    FROM dispatch.dispatch_order_items doi
    LEFT JOIN catalog.products p ON p.id = doi.product_id
    LEFT JOIN catalog.brands b ON b.id = doi.brand_id
    LEFT JOIN catalog.categories c ON c.id = doi.category_id
    LEFT JOIN catalog.units u ON u.id = doi.unit_id
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
    ORDER BY doi.id
    `,
    [dispatchOrderId, dispatchOrder.purchase_order_id || null]
  );

  payload.items = rows.map((item) => {
    const quantity = toNumber(item.quantity);
    const unitPrice = toNumber(item.unit_price);

    return {
      product_name: item.product_name || '',
      brand_name: item.brand_name || '',
      category_name: item.category_name || '',
      quantity,
      unit: item.unit || '',
      unit_price: unitPrice,
      amount: quantity * unitPrice,
    };
  });

  return payload;
};

const inventoryMigrationRequestKey = (data = {}, inventoryProduct = null) => {
  if (data.purchase_order_item_id) {
    return `INVENTORY_MIGRATION_PO_ITEM:${Number(data.purchase_order_item_id)}`;
  }

  if (inventoryProduct?.id) {
    return `INVENTORY_MIGRATION_PRODUCT:${Number(inventoryProduct.id)}`;
  }

  return `INVENTORY_MIGRATION:${[
    data.purchase_order_id || 'PO',
    data.product_barcode_id || 'PB',
    data.exp_date || 'EXP',
  ].join(':')}`;
};

const buildInventoryMigrationPayload = async (db, data = {}, inventoryProduct = null) => {
  const productBarcodeId = Number(data.product_barcode_id || inventoryProduct?.product_barcode_id);
  const quantity = toNumber(data.no_of_units ?? data.qty ?? inventoryProduct?.no_of_units, 0);
  const unitPrice = toNumber(data.unit_price ?? inventoryProduct?.unit_price, 0);

  const payload = {
    purchase_order_id: data.purchase_order_id ? Number(data.purchase_order_id) : null,
    purchase_order_item_id: data.purchase_order_item_id ? Number(data.purchase_order_item_id) : null,
    inventory_product_id: inventoryProduct?.id ? Number(inventoryProduct.id) : null,
    product_barcode_id: Number.isFinite(productBarcodeId) ? productBarcodeId : null,
    sku_id: data.sku_id || inventoryProduct?.sku_id || null,
    exp_date: data.exp_date || inventoryProduct?.exp_date || null,
    warehouse_id: data.warehouse_id ? Number(data.warehouse_id) : inventoryProduct?.warehouse_id || null,
    items: [],
  };

  if (!Number.isFinite(productBarcodeId)) return payload;

  const { rows } = await runQuery(
    db,
    `
    SELECT
      COALESCE(p.product_name_eng, p.product_name_tel, p.product_code, pb.product_id::text) AS product_name,
      COALESCE(b.brand_name_english, b.brand_name_telugu, pb.brand_id::text) AS brand_name,
      COALESCE(c.category_name_english, c.category_name_telugu, pb.category_id::text) AS category_name,
      COALESCE(u.unit_short_code, u.unit_name, pb.unit_id::text) AS unit
    FROM catalog.product_barcodes pb
    LEFT JOIN catalog.products p ON p.id = pb.product_id
    LEFT JOIN catalog.brands b ON b.id = pb.brand_id
    LEFT JOIN catalog.categories c ON c.id = pb.category_id
    LEFT JOIN catalog.units u ON u.id = pb.unit_id
    WHERE pb.id = $1
    LIMIT 1
    `,
    [productBarcodeId]
  );

  const item = rows[0] || {};

  payload.items = [
    {
      product_name: item.product_name || inventoryProduct?.product_name || '',
      brand_name: item.brand_name || '',
      category_name: item.category_name || '',
      quantity,
      unit: item.unit || '',
      unit_price: unitPrice,
      amount: quantity * unitPrice,
    },
  ];

  return payload;
};

export const RequestTracking = {
  async findAll(params = {}) {
    const values = [];
    const filters = [];

    addFilter(filters, values, 'r.status = ?', params.status);
    addFilter(filters, values, 'r.request_type = ?', params.request_type);
    addFilter(filters, values, 'r.source_domain = ?', params.source_domain);
    addFilter(filters, values, 'r.target_domain = ?', params.target_domain);
    addFilter(filters, values, 'r.outlet_id = ?', params.outlet_id);
    addNumberFilter(filters, values, 'r.warehouse_id = ?', params.warehouse_id);
    addNumberFilter(filters, values, 'r.inventory_product_id = ?', params.inventory_product_id);
    addNumberFilter(filters, values, 'r.product_barcode_id = ?', params.product_barcode_id);
    addFilter(filters, values, 'r.reference_type = ?', params.reference_type);
    addFilter(filters, values, 'r.reference_id = ?', params.reference_id);

    if (params.search) {
      values.push(`%${params.search}%`);
      filters.push(`(
        r.request_key ILIKE $${values.length}
        OR r.request_type ILIKE $${values.length}
        OR COALESCE(r.reference_id, '') ILIKE $${values.length}
        OR COALESCE(r.current_step_code, '') ILIKE $${values.length}
      )`);
    }

    const limit = toLimit(params.limit);
    const offset = toOffset(params.offset);
    values.push(limit, offset);

    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : '';

    try {
      const { rows } = await query(
        `
        SELECT
          r.id,
          r.request_key,
          r.request_type,
          r.source_domain,
          r.target_domain,
          r.outlet_id,
          r.warehouse_id,
          r.inventory_product_id,
          r.product_barcode_id,
          r.reference_type,
          r.reference_id,
          r.current_step_code,
          r.status,
          r.retry_count,
          r.max_retries,
          r.last_error_code,
          r.last_error_message,
          r.created_at,
          r.updated_at,
          COALESCE(
            jsonb_agg(
              jsonb_build_object(
                'step_id', s.id,
                'step_order', s.step_order,
                'step_code', s.step_code,
                'step_name', s.step_name,
                'step_domain', s.step_domain,
                'processor', s.processor,
                'status', s.status,
                'attempt_count', s.attempt_count,
                'max_attempts', s.max_attempts,
                'last_attempt_id', s.last_attempt_id,
                'last_error_code', s.last_error_code,
                'last_error_message', s.last_error_message,
                'next_retry_at', s.next_retry_at,
                'updated_at', s.updated_at
              )
              ORDER BY s.step_order, s.id
            ) FILTER (WHERE s.id IS NOT NULL),
            '[]'::jsonb
          ) AS steps
        FROM request_tracking.requests r
        LEFT JOIN request_tracking.request_steps s
          ON s.request_id = r.id
        ${where}
        GROUP BY r.id
        ORDER BY r.updated_at DESC, r.id DESC
        LIMIT $${values.length - 1} OFFSET $${values.length}
        `,
        values
      );

      return rows;
    } catch (error) {
      if (isMissingRequestTrackingSchema(error)) {
        return missingSchemaResult([]);
      }

      throw error;
    }
  },

  async findById(id) {
    try {
      const { rows } = await query(
        `
        SELECT
          r.*,
          COALESCE(
            jsonb_agg(
              jsonb_build_object(
                'step_id', s.id,
                'step_order', s.step_order,
                'step_code', s.step_code,
                'step_name', s.step_name,
                'step_domain', s.step_domain,
                'processor', s.processor,
                'status', s.status,
                'attempt_count', s.attempt_count,
                'max_attempts', s.max_attempts,
                'last_attempt_id', s.last_attempt_id,
                'last_error_code', s.last_error_code,
                'last_error_message', s.last_error_message,
                'next_retry_at', s.next_retry_at,
                'updated_at', s.updated_at
              )
              ORDER BY s.step_order, s.id
            ) FILTER (WHERE s.id IS NOT NULL),
            '[]'::jsonb
          ) AS steps
        FROM request_tracking.requests r
        LEFT JOIN request_tracking.request_steps s
          ON s.request_id = r.id
        WHERE r.id = $1
        GROUP BY r.id
        `,
        [Number(id)]
      );

      return rows[0] || null;
    } catch (error) {
      if (isMissingRequestTrackingSchema(error)) {
        return missingSchemaResult({ requestTrackingSetupRequired: true });
      }

      throw error;
    }
  },

  async findByKey(requestKey) {
    try {
      const { rows } = await query(
        `
        SELECT
          r.*,
          COALESCE(
            jsonb_agg(
              jsonb_build_object(
                'step_id', s.id,
                'step_order', s.step_order,
                'step_code', s.step_code,
                'step_name', s.step_name,
                'step_domain', s.step_domain,
                'processor', s.processor,
                'status', s.status,
                'attempt_count', s.attempt_count,
                'max_attempts', s.max_attempts,
                'last_attempt_id', s.last_attempt_id,
                'last_error_code', s.last_error_code,
                'last_error_message', s.last_error_message,
                'next_retry_at', s.next_retry_at,
                'updated_at', s.updated_at
              )
              ORDER BY s.step_order, s.id
            ) FILTER (WHERE s.id IS NOT NULL),
            '[]'::jsonb
          ) AS steps
        FROM request_tracking.requests r
        LEFT JOIN request_tracking.request_steps s
          ON s.request_id = r.id
        WHERE r.request_key = $1
        GROUP BY r.id
        `,
        [requestKey]
      );

      return rows[0] || null;
    } catch (error) {
      if (isMissingRequestTrackingSchema(error)) {
        return missingSchemaResult({ requestTrackingSetupRequired: true });
      }

      throw error;
    }
  },

  async getSteps(requestId) {
    const { rows } = await query(
      `
      SELECT *
      FROM request_tracking.request_steps
      WHERE request_id = $1
      ORDER BY step_order ASC, id ASC
      `,
      [Number(requestId)]
    );

    return rows;
  },

  async getStepById(stepId) {
    const { rows } = await query(
      `
      SELECT *
      FROM request_tracking.request_steps
      WHERE id = $1
      `,
      [Number(stepId)]
    );

    return rows[0] || null;
  },

  async getAttempts(stepId) {
    const { rows } = await query(
      `
      SELECT *
      FROM request_tracking.request_step_attempts
      WHERE request_step_id = $1
      ORDER BY attempt_no DESC, id DESC
      `,
      [Number(stepId)]
    );

    return rows;
  },

  async getEvents(requestId, { limit, offset } = {}) {
    const { rows } = await query(
      `
      SELECT *
      FROM request_tracking.request_events
      WHERE request_id = $1
      ORDER BY created_at DESC, id DESC
      LIMIT $2 OFFSET $3
      `,
      [Number(requestId), toLimit(limit, 200), toOffset(offset)]
    );

    return rows;
  },

  async reinitiateFailedStep(stepId, { requestedBy, payload } = {}) {
    const { rows } = await query(
      `
      SELECT *
      FROM request_tracking.reinitiate_failed_step($1, $2, $3::jsonb)
      `,
      [
        Number(stepId),
        requestedBy || null,
        JSON.stringify(payload && typeof payload === 'object' ? payload : {}),
      ]
    );

    return rows[0] || null;
  },

  async upsertDispatchReceiveRequest(dispatchOrder, { db, requestedBy } = {}) {
    const dispatchOrderId = Number(dispatchOrder?.id);
    if (!dispatchOrderId) return null;

    const requestKey = `DISPATCH_ORDER:${dispatchOrderId}`;
    const outletId = parseLocationId(dispatchOrder.destination, 'outlet');
    const warehouseId = parseLocationId(dispatchOrder.source, 'warehouse');
    const status =
      dispatchOrder.dispatch_status === 'received_to_outlet'
        ? 'completed'
        : dispatchOrder.dispatch_status === 'cancelled'
          ? 'cancelled'
          : 'pending';
    const payload = await buildDispatchReceivePayload(db, dispatchOrder);

    try {
      const { rows } = await runQuery(
        db,
        `
        INSERT INTO request_tracking.requests (
          request_key,
          request_type,
          source_domain,
          target_domain,
          outlet_id,
          warehouse_id,
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
          'inventory_dispatch_to_outlet',
          'inventory',
          'outlet',
          $2,
          $3,
          'dispatch_order',
          $4,
          'outlet_receive',
          $5::varchar,
          $6::jsonb,
          $7,
          $7,
          NOW(),
          CASE WHEN $5::varchar = 'completed' THEN NOW() ELSE NULL END
        )
        ON CONFLICT (request_key)
        DO UPDATE SET
          outlet_id = EXCLUDED.outlet_id,
          warehouse_id = EXCLUDED.warehouse_id,
          current_step_code = EXCLUDED.current_step_code,
          status = EXCLUDED.status,
          payload = EXCLUDED.payload,
          updated_by = EXCLUDED.updated_by,
          completed_at = CASE
            WHEN EXCLUDED.status = 'completed' THEN NOW()
            ELSE request_tracking.requests.completed_at
          END,
          updated_at = NOW()
        RETURNING *
        `,
        [
          requestKey,
          outletId ? String(outletId) : null,
          warehouseId,
          String(dispatchOrderId),
          status,
          JSON.stringify(payload),
          requestedBy || null,
        ]
      );

      const request = rows[0];

      await runQuery(
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
        VALUES
          ($1, 1, 'inventory_dispatch', 'Inventory dispatch sent', 'inventory', 'dispatchController.updateDispatchStatus', 'completed', 1, 3, NOW()),
          ($1, 2, 'outlet_receive', 'Outlet POS receive', 'outlet', 'dispatchController.receivedDispatchToOutletMongoStock', $2::varchar, CASE WHEN $2::varchar = 'completed' THEN 1 ELSE 0 END, 3, CASE WHEN $2::varchar = 'completed' THEN NOW() ELSE NULL END)
        ON CONFLICT (request_id, step_order, step_code)
        DO UPDATE SET
          status = EXCLUDED.status,
          attempt_count = GREATEST(request_tracking.request_steps.attempt_count, EXCLUDED.attempt_count),
          completed_at = CASE
            WHEN EXCLUDED.status = 'completed' THEN NOW()
            ELSE request_tracking.request_steps.completed_at
          END,
          updated_at = NOW()
        `,
        [request.id, status === 'completed' ? 'completed' : status]
      );

      await runQuery(
        db,
        `
        INSERT INTO request_tracking.request_events (
          request_id,
          event_type,
          to_status,
          message,
          event_payload,
          created_by
        )
        VALUES ($1, 'dispatch_tracking_synced', $2, $3, $4::jsonb, $5)
        `,
        [
          request.id,
          status,
          status === 'completed'
            ? 'Dispatch received to outlet'
            : 'Dispatch awaiting outlet receive',
          JSON.stringify({ dispatch_order_id: dispatchOrderId }),
          requestedBy || null,
        ]
      );

      return request;
    } catch (error) {
      if (isMissingRequestTrackingSchema(error)) return null;
      throw error;
    }
  },

  async syncPendingDispatchReceiveRequests() {
    try {
      const { rows } = await query(`
        SELECT *
        FROM dispatch.dispatch_order
        WHERE dispatch_status = 'dispatched'
          AND destination ILIKE 'outlet:%'
        ORDER BY updated_at DESC, id DESC
        LIMIT 200
      `);

      for (const dispatchOrder of rows) {
        await this.upsertDispatchReceiveRequest(dispatchOrder, {
          requestedBy: 'SYSTEM',
        });
      }
    } catch (error) {
      if (isMissingRequestTrackingSchema(error)) return;
      throw error;
    }
  },

  async markDispatchReceiveFailed(dispatchOrderId, error, { requestedBy } = {}) {
    try {
      const orderResult = await query(
        `
        SELECT *
        FROM dispatch.dispatch_order
        WHERE id = $1
        `,
        [Number(dispatchOrderId)]
      );

      const dispatchOrder = orderResult.rows[0];

      if (!dispatchOrder) return null;

      await this.upsertDispatchReceiveRequest(dispatchOrder, {
        requestedBy: requestedBy || 'SYSTEM',
      });

      const requestResult = await query(
        `
        SELECT *
        FROM request_tracking.requests
        WHERE request_key = $1
        `,
        [`DISPATCH_ORDER:${Number(dispatchOrderId)}`]
      );

      const request = requestResult.rows[0];
      if (!request) return null;

      const stepResult = await query(
        `
        SELECT *
        FROM request_tracking.request_steps
        WHERE request_id = $1
          AND step_code = 'outlet_receive'
        LIMIT 1
        `,
        [Number(request.id)]
      );

      const step = stepResult.rows[0];
      const errorCode = error?.code || error?.name || 'OUTLET_RECEIVE_FAILED';
      const errorMessage = error?.message || 'Outlet receive failed';

      let attempt = null;

      if (step) {
        const attemptResult = await query(
          `
          INSERT INTO request_tracking.request_step_attempts (
            request_step_id,
            attempt_no,
            status,
            requested_by,
            request_payload,
            error_code,
            error_message,
            started_at,
            failed_at
          )
          VALUES (
            $1,
            COALESCE((SELECT MAX(attempt_no) FROM request_tracking.request_step_attempts WHERE request_step_id = $1), 0) + 1,
            'failed',
            $2,
            $3::jsonb,
            $4,
            $5,
            NOW(),
            NOW()
          )
          RETURNING *
          `,
          [
            Number(step.id),
            requestedBy || 'SYSTEM',
            JSON.stringify({ dispatch_order_id: Number(dispatchOrderId) }),
            errorCode,
            errorMessage,
          ]
        );

        attempt = attemptResult.rows[0];

        await query(
          `
          UPDATE request_tracking.request_steps
          SET
            status = 'failed',
            attempt_count = attempt_count + 1,
            last_attempt_id = $1,
            last_error_code = $2,
            last_error_message = $3,
            failed_at = NOW(),
            updated_at = NOW()
          WHERE id = $4
          `,
          [Number(attempt.id), errorCode, errorMessage, Number(step.id)]
        );
      }

      await query(
        `
        UPDATE request_tracking.requests
        SET
          status = 'failed',
          current_step_code = 'outlet_receive',
          last_error_code = $1,
          last_error_message = $2,
          failed_at = NOW(),
          updated_by = $3,
          updated_at = NOW()
        WHERE id = $4
        RETURNING *
        `,
        [errorCode, errorMessage, requestedBy || 'SYSTEM', Number(request.id)]
      );

      await query(
        `
        INSERT INTO request_tracking.request_events (
          request_id,
          request_step_id,
          attempt_id,
          event_type,
          from_status,
          to_status,
          message,
          event_payload,
          created_by
        )
        VALUES ($1, $2, $3, 'step_failed', NULL, 'failed', $4, $5::jsonb, $6)
        `,
        [
          Number(request.id),
          step?.id ? Number(step.id) : null,
          attempt?.id ? Number(attempt.id) : null,
          errorMessage,
          JSON.stringify({ dispatch_order_id: Number(dispatchOrderId) }),
          requestedBy || 'SYSTEM',
        ]
      );

      return request;
    } catch (trackingError) {
      if (isMissingRequestTrackingSchema(trackingError)) return null;
      throw trackingError;
    }
  },

  async upsertInventoryMigrationRequest(data = {}, result = {}, { requestedBy, status = 'completed', error } = {}) {
    const inventoryProduct = result.inventoryProduct || null;
    const requestKey = inventoryMigrationRequestKey(data, inventoryProduct);
    const payload = await buildInventoryMigrationPayload(null, data, inventoryProduct);
    const finalStatus = error ? 'failed' : status;
    const errorCode = error?.code || error?.name || null;
    const errorMessage = error?.message || null;

    try {
      const { rows } = await query(
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
          last_error_code,
          last_error_message,
          payload,
          requested_by,
          updated_by,
          started_at,
          completed_at,
          failed_at
        )
        VALUES (
          $1,
          'inventory_migration',
          'system',
          'inventory',
          $2,
          $3,
          $4,
          'purchase_order_item',
          $5,
          'add_to_inventory',
          $6::varchar,
          $7,
          $8,
          $9::jsonb,
          $10,
          $10,
          NOW(),
          CASE WHEN $6::varchar = 'completed' THEN NOW() ELSE NULL END,
          CASE WHEN $6::varchar = 'failed' THEN NOW() ELSE NULL END
        )
        ON CONFLICT (request_key)
        DO UPDATE SET
          warehouse_id = EXCLUDED.warehouse_id,
          inventory_product_id = EXCLUDED.inventory_product_id,
          product_barcode_id = EXCLUDED.product_barcode_id,
          current_step_code = EXCLUDED.current_step_code,
          status = EXCLUDED.status,
          last_error_code = EXCLUDED.last_error_code,
          last_error_message = EXCLUDED.last_error_message,
          payload = EXCLUDED.payload,
          updated_by = EXCLUDED.updated_by,
          completed_at = CASE
            WHEN EXCLUDED.status = 'completed' THEN NOW()
            ELSE request_tracking.requests.completed_at
          END,
          failed_at = CASE
            WHEN EXCLUDED.status = 'failed' THEN NOW()
            ELSE request_tracking.requests.failed_at
          END,
          updated_at = NOW()
        RETURNING *
        `,
        [
          requestKey,
          payload.warehouse_id ? Number(payload.warehouse_id) : null,
          payload.inventory_product_id ? Number(payload.inventory_product_id) : null,
          payload.product_barcode_id ? Number(payload.product_barcode_id) : null,
          payload.purchase_order_item_id
            ? String(payload.purchase_order_item_id)
            : payload.purchase_order_id
              ? String(payload.purchase_order_id)
              : null,
          finalStatus,
          errorCode,
          errorMessage,
          JSON.stringify(payload),
          requestedBy || null,
        ]
      );

      const request = rows[0];

      const stepResult = await query(
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
          completed_at,
          failed_at,
          last_error_code,
          last_error_message
        )
        VALUES (
          $1,
          1,
          'add_to_inventory',
          'Add to inventory',
          'inventory',
          'InventoryProduct.receiveVerifiedPurchase',
          $2::varchar,
          1,
          3,
          CASE WHEN $2::varchar = 'completed' THEN NOW() ELSE NULL END,
          CASE WHEN $2::varchar = 'failed' THEN NOW() ELSE NULL END,
          $3,
          $4
        )
        ON CONFLICT (request_id, step_order, step_code)
        DO UPDATE SET
          status = EXCLUDED.status,
          attempt_count = GREATEST(request_tracking.request_steps.attempt_count, EXCLUDED.attempt_count),
          completed_at = CASE
            WHEN EXCLUDED.status = 'completed' THEN NOW()
            ELSE request_tracking.request_steps.completed_at
          END,
          failed_at = CASE
            WHEN EXCLUDED.status = 'failed' THEN NOW()
            ELSE request_tracking.request_steps.failed_at
          END,
          last_error_code = EXCLUDED.last_error_code,
          last_error_message = EXCLUDED.last_error_message,
          updated_at = NOW()
        RETURNING *
        `,
        [Number(request.id), finalStatus, errorCode, errorMessage]
      );

      const step = stepResult.rows[0];

      await query(
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
        VALUES ($1, $2, 'inventory_migration_synced', $3, $4, $5::jsonb, $6)
        `,
        [
          Number(request.id),
          step?.id ? Number(step.id) : null,
          finalStatus,
          errorMessage ||
            (finalStatus === 'completed'
              ? 'Inventory migration added to inventory'
              : 'Inventory migration pending'),
          JSON.stringify(payload),
          requestedBy || null,
        ]
      );

      return request;
    } catch (trackingError) {
      if (isMissingRequestTrackingSchema(trackingError)) return null;
      throw trackingError;
    }
  },

  isMissingRequestTrackingSchema,
  actorName,
};
