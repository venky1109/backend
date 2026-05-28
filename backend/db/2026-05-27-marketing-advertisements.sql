CREATE SCHEMA IF NOT EXISTS catalog;
CREATE SCHEMA IF NOT EXISTS marketing;

CREATE TABLE IF NOT EXISTS catalog.repository (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'local',
  for_scope TEXT NOT NULL DEFAULT 'advertisement',
  connect_string TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS marketing.outlet_advertise (
  id BIGSERIAL PRIMARY KEY,
  outlet_id BIGINT,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'html',
  template TEXT NOT NULL,
  sale_type TEXT,
  priority INTEGER NOT NULL DEFAULT 1,
  sequence INTEGER NOT NULL DEFAULT 1,
  timer_seconds INTEGER NOT NULL DEFAULT 10,
  start_date DATE,
  end_date DATE,
  status TEXT NOT NULL DEFAULT 'draft',
  generated_video_path TEXT,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by TEXT,
  updated_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS marketing.outlet_advertise_details (
  id BIGSERIAL PRIMARY KEY,
  outlet_advertise_id BIGINT NOT NULL REFERENCES marketing.outlet_advertise(id) ON DELETE CASCADE,
  repository_id BIGINT REFERENCES catalog.repository(id),
  product_id BIGINT,
  product_name TEXT,
  brand_name TEXT,
  title TEXT,
  description TEXT,
  media_type TEXT NOT NULL DEFAULT 'image',
  media_path TEXT NOT NULL,
  target_area TEXT,
  sequence INTEGER NOT NULL DEFAULT 1,
  duration_seconds INTEGER NOT NULL DEFAULT 5,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_repository_for_scope
  ON catalog.repository(for_scope, is_active);

CREATE INDEX IF NOT EXISTS idx_outlet_advertise_active
  ON marketing.outlet_advertise(outlet_id, status, priority DESC, sequence ASC);

CREATE INDEX IF NOT EXISTS idx_outlet_advertise_details_parent
  ON marketing.outlet_advertise_details(outlet_advertise_id, sequence ASC);
