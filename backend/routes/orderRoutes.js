import express from 'express';
const router = express.Router();
import {
  addOrderItems,
  getMyOrders,
  getOrderById,
  updateOrderToPaid,
  updateOrderToDelivered,
  // getOrders,
} from '../controllers/orderController.js';
import {
  getOrdersPOS,
  addOrderItemsPOS,
  getOrderPOSItemsByOrderId, 
    getAllOrdersWithTimers,
  getOrdersToPackWithTimers,
  getOrdersToDispatchWithTimers,
  getOrdersToDeliverWithTimers,
  updateOrderToPackedWithTimers,
  updateOrdersToDispatchedWithTimers,
  updateOrdersToDeliveredWithTimers,
  updateOrdersToPaidWithTimers
} from '../controllers/orderPOSController.js';
import { protect, admin } from '../middleware/authMiddleware.js';
// import { protectPOS } from '../middleware/posAuthMiddleware.js';
import { protectPOS as posProtect, cashierOrAdmin, protectPOS ,onlineOrderManager,
  packingAgent,
  dispatchAgent,
  deliveryAgent } from '../middleware/posAuthMiddleware.js';
// import authorizeRoles from '../middleware/authorizeRoles.js';

// POS routes

router
  .route('/pos')
  .get(protectPOS, cashierOrAdmin, getOrdersPOS)
  .post(posProtect, cashierOrAdmin, addOrderItemsPOS);

router
  .route('/pos/:id/items')
  .get(posProtect, getOrderPOSItemsByOrderId);
  // ➕ New Order Lifecycle Role Routes
router.get('/pos/orders/all', posProtect, onlineOrderManager, getAllOrdersWithTimers);
router.get('/pos/orders/packing', posProtect, packingAgent, getOrdersToPackWithTimers);
router.get('/pos/orders/dispatch', posProtect, dispatchAgent, getOrdersToDispatchWithTimers);
router.get('/pos/orders/delivery', posProtect, deliveryAgent, getOrdersToDeliverWithTimers);  

// Mark Order as Packed
router.put('/pos/:id/mark-packed', posProtect, packingAgent, updateOrderToPackedWithTimers);

// Mark Order as Dispatched
router.put('/pos/:id/mark-dispatched', posProtect, dispatchAgent, updateOrdersToDispatchedWithTimers);

// Mark Order as Delivered
router.put('/pos/:id/mark-delivered', posProtect, deliveryAgent, updateOrdersToDeliveredWithTimers);

router.put('/pos/:id/mark-paid', posProtect, deliveryAgent, updateOrdersToPaidWithTimers);


//end of POS routes

router.route('/').post(protect, addOrderItems);
  // .get(protectPOS, authorizeRoles('ADMIN', 'INVENTORY', 'CASHIER'), getOrders);
router.route('/mine').get(protect, getMyOrders);
router.route('/:id').get(protect, getOrderById);
router.route('/:id/pay').put(protect, updateOrderToPaid);
router.route('/:id/deliver').put(protect, admin, updateOrderToDelivered);






export default router;
