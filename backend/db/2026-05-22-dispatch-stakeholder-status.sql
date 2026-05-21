ALTER TABLE dispatch.dispatch_order
DROP CONSTRAINT IF EXISTS dispatch_order_dispatch_status_check;

ALTER TABLE dispatch.dispatch_order
ADD CONSTRAINT dispatch_order_dispatch_status_check
CHECK (
  dispatch_status IN (
    'draft',
    'sent',
    'packed',
    'dispatched',
    'received_to_outlet',
    'received_by_stakeholder',
    'cancelled'
  )
);
