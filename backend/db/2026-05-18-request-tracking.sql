CREATE SCHEMA IF NOT EXISTS request_tracking;

CREATE TABLE IF NOT EXISTS request_tracking.requests (
  id BIGSERIAL PRIMARY KEY,
  request_key VARCHAR(120) NOT NULL UNIQUE,
  request_type VARCHAR(80) NOT NULL,
  source_domain VARCHAR(40) NOT NULL,
  target_domain VARCHAR(40) NOT NULL,
  outlet_id VARCHAR(80),
  warehouse_id BIGINT,
  inventory_product_id BIGINT,
  product_barcode_id BIGINT,
  reference_type VARCHAR(80),
  reference_id VARCHAR(120),
  current_step_code VARCHAR(80),
  status VARCHAR(40) NOT NULL DEFAULT 'pending',
  priority SMALLINT NOT NULL DEFAULT 5,
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 3,
  last_error_code VARCHAR(120),
  last_error_message TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  requested_by VARCHAR(120),
  updated_by VARCHAR(120),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_request_tracking_requests_source_domain
    CHECK (source_domain IN ('outlet', 'inventory', 'warehouse', 'system')),
  CONSTRAINT chk_request_tracking_requests_target_domain
    CHECK (target_domain IN ('outlet', 'inventory', 'warehouse', 'system')),
  CONSTRAINT chk_request_tracking_requests_status
    CHECK (status IN ('pending', 'in_progress', 'completed', 'failed', 'cancelled', 'reinitiated'))
);

CREATE TABLE IF NOT EXISTS request_tracking.request_steps (
  id BIGSERIAL PRIMARY KEY,
  request_id BIGINT NOT NULL REFERENCES request_tracking.requests(id) ON DELETE CASCADE,
  step_order INTEGER NOT NULL,
  step_code VARCHAR(80) NOT NULL,
  step_name VARCHAR(160) NOT NULL,
  step_domain VARCHAR(40) NOT NULL,
  processor VARCHAR(120),
  status VARCHAR(40) NOT NULL DEFAULT 'pending',
  is_retriable BOOLEAN NOT NULL DEFAULT TRUE,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  last_attempt_id BIGINT,
  idempotency_key VARCHAR(160),
  last_error_code VARCHAR(120),
  last_error_message TEXT,
  next_retry_at TIMESTAMPTZ,
  locked_by VARCHAR(120),
  locked_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  reinitiated_from_step_id BIGINT REFERENCES request_tracking.request_steps(id),
  reinitiated_at TIMESTAMPTZ,
  reinitiated_by VARCHAR(120),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_request_tracking_request_steps_domain
    CHECK (step_domain IN ('outlet', 'inventory', 'warehouse', 'system')),
  CONSTRAINT chk_request_tracking_request_steps_status
    CHECK (status IN ('pending', 'in_progress', 'completed', 'failed', 'skipped', 'cancelled', 'reinitiated')),
  CONSTRAINT uq_request_tracking_request_steps_flow
    UNIQUE (request_id, step_order, step_code)
);

CREATE TABLE IF NOT EXISTS request_tracking.request_step_attempts (
  id BIGSERIAL PRIMARY KEY,
  request_step_id BIGINT NOT NULL REFERENCES request_tracking.request_steps(id) ON DELETE CASCADE,
  attempt_no INTEGER NOT NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'pending',
  requested_by VARCHAR(120),
  worker_id VARCHAR(120),
  request_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  response_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_code VARCHAR(120),
  error_message TEXT,
  is_reinitiation BOOLEAN NOT NULL DEFAULT FALSE,
  reinitiated_from_attempt_id BIGINT REFERENCES request_tracking.request_step_attempts(id),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_request_tracking_step_attempts_status
    CHECK (status IN ('pending', 'in_progress', 'completed', 'failed', 'cancelled')),
  CONSTRAINT uq_request_tracking_step_attempts_no
    UNIQUE (request_step_id, attempt_no)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'fk_request_tracking_steps_last_attempt'
      AND conrelid = 'request_tracking.request_steps'::regclass
  ) THEN
    ALTER TABLE request_tracking.request_steps
      ADD CONSTRAINT fk_request_tracking_steps_last_attempt
      FOREIGN KEY (last_attempt_id)
      REFERENCES request_tracking.request_step_attempts(id);
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS request_tracking.request_events (
  id BIGSERIAL PRIMARY KEY,
  request_id BIGINT NOT NULL REFERENCES request_tracking.requests(id) ON DELETE CASCADE,
  request_step_id BIGINT REFERENCES request_tracking.request_steps(id) ON DELETE SET NULL,
  attempt_id BIGINT REFERENCES request_tracking.request_step_attempts(id) ON DELETE SET NULL,
  event_type VARCHAR(80) NOT NULL,
  from_status VARCHAR(40),
  to_status VARCHAR(40),
  message TEXT,
  event_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by VARCHAR(120),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_request_tracking_requests_status
  ON request_tracking.requests (status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_request_tracking_requests_outlet
  ON request_tracking.requests (outlet_id, status);

CREATE INDEX IF NOT EXISTS idx_request_tracking_requests_inventory
  ON request_tracking.requests (warehouse_id, inventory_product_id, status);

CREATE INDEX IF NOT EXISTS idx_request_tracking_requests_reference
  ON request_tracking.requests (reference_type, reference_id);

CREATE INDEX IF NOT EXISTS idx_request_tracking_steps_request
  ON request_tracking.request_steps (request_id, step_order);

CREATE INDEX IF NOT EXISTS idx_request_tracking_steps_status
  ON request_tracking.request_steps (status, next_retry_at);

CREATE INDEX IF NOT EXISTS idx_request_tracking_step_attempts_step
  ON request_tracking.request_step_attempts (request_step_id, attempt_no DESC);

CREATE INDEX IF NOT EXISTS idx_request_tracking_events_request
  ON request_tracking.request_events (request_id, created_at DESC);

CREATE OR REPLACE FUNCTION request_tracking.set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_request_tracking_requests_updated_at'
  ) THEN
    CREATE TRIGGER trg_request_tracking_requests_updated_at
    BEFORE UPDATE ON request_tracking.requests
    FOR EACH ROW EXECUTE FUNCTION request_tracking.set_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_request_tracking_steps_updated_at'
  ) THEN
    CREATE TRIGGER trg_request_tracking_steps_updated_at
    BEFORE UPDATE ON request_tracking.request_steps
    FOR EACH ROW EXECUTE FUNCTION request_tracking.set_updated_at();
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_request_tracking_step_attempts_updated_at'
  ) THEN
    CREATE TRIGGER trg_request_tracking_step_attempts_updated_at
    BEFORE UPDATE ON request_tracking.request_step_attempts
    FOR EACH ROW EXECUTE FUNCTION request_tracking.set_updated_at();
  END IF;
END;
$$;

CREATE OR REPLACE VIEW request_tracking.request_flow_status AS
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
GROUP BY r.id;

CREATE OR REPLACE FUNCTION request_tracking.reinitiate_failed_step(
  p_request_step_id BIGINT,
  p_requested_by VARCHAR DEFAULT NULL,
  p_request_payload JSONB DEFAULT '{}'::jsonb
)
RETURNS request_tracking.request_step_attempts AS $$
DECLARE
  v_step request_tracking.request_steps%ROWTYPE;
  v_attempt request_tracking.request_step_attempts%ROWTYPE;
  v_next_attempt_no INTEGER;
BEGIN
  SELECT *
  INTO v_step
  FROM request_tracking.request_steps
  WHERE id = p_request_step_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request step % not found', p_request_step_id;
  END IF;

  IF v_step.status <> 'failed' THEN
    RAISE EXCEPTION 'Only failed steps can be reinitiated. Step % is %', p_request_step_id, v_step.status;
  END IF;

  IF v_step.is_retriable = FALSE THEN
    RAISE EXCEPTION 'Step % is not retriable', p_request_step_id;
  END IF;

  IF v_step.attempt_count >= v_step.max_attempts THEN
    RAISE EXCEPTION 'Step % has reached max attempts %', p_request_step_id, v_step.max_attempts;
  END IF;

  v_next_attempt_no := v_step.attempt_count + 1;

  INSERT INTO request_tracking.request_step_attempts (
    request_step_id,
    attempt_no,
    status,
    requested_by,
    request_payload,
    is_reinitiation,
    reinitiated_from_attempt_id
  )
  VALUES (
    p_request_step_id,
    v_next_attempt_no,
    'pending',
    p_requested_by,
    COALESCE(p_request_payload, '{}'::jsonb),
    TRUE,
    v_step.last_attempt_id
  )
  RETURNING * INTO v_attempt;

  UPDATE request_tracking.request_steps
  SET
    status = 'reinitiated',
    attempt_count = v_next_attempt_no,
    last_attempt_id = v_attempt.id,
    last_error_code = NULL,
    last_error_message = NULL,
    failed_at = NULL,
    next_retry_at = NULL,
    reinitiated_at = NOW(),
    reinitiated_by = p_requested_by
  WHERE id = p_request_step_id;

  UPDATE request_tracking.requests
  SET
    status = 'reinitiated',
    current_step_code = v_step.step_code,
    retry_count = retry_count + 1,
    last_error_code = NULL,
    last_error_message = NULL,
    failed_at = NULL,
    updated_by = p_requested_by
  WHERE id = v_step.request_id;

  INSERT INTO request_tracking.request_events (
    request_id,
    request_step_id,
    attempt_id,
    event_type,
    from_status,
    to_status,
    message,
    created_by
  )
  VALUES (
    v_step.request_id,
    p_request_step_id,
    v_attempt.id,
    'step_reinitiated',
    'failed',
    'reinitiated',
    'Failed step reinitiated',
    p_requested_by
  );

  RETURN v_attempt;
END;
$$ LANGUAGE plpgsql;
