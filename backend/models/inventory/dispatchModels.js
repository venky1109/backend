import BasePgModel from './BasePgModel.js';

export const DispatchOrder = new BasePgModel('dispatch.dispatch_order', [
  'purchase_order_id','dispatch_no','dispatch_status','dispatch_notes','source','destination','expected_dispatch_at'
]);

export const DispatchOrderItem = new BasePgModel('dispatch.dispatch_order_items', [
  'dispatch_order_id','product_id','qty','unit_price','remarks'
]);
