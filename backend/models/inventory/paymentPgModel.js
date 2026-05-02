import BasePgModel from './BasePgModel.js';

export const PgPayment = new BasePgModel('payments.payments', [
  'payment_number','source_type','source_id','amount','currency','status','paid_at','method','notes'
]);
