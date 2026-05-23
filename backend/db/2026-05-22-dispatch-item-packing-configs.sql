ALTER TABLE dispatch.dispatch_order_items
ADD COLUMN IF NOT EXISTS packing_configs JSONB NOT NULL DEFAULT '[]'::jsonb;

