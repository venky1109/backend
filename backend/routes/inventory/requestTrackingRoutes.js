import express from 'express';

import {
  getRequestEvents,
  getRequestFlowById,
  getRequestFlowByKey,
  getRequestFlows,
  getRequestSteps,
  getStepAttempts,
  reinitiateFailedStep,
} from '../../controllers/inventory/requestTrackingController.js';

import {
  protectPOS,
  catalogInventoryAccess,
} from '../../middleware/posAuthMiddleware.js';

const router = express.Router();

router.use(protectPOS);
router.use(catalogInventoryAccess);

router.get('/requests', getRequestFlows);
router.get('/requests/key/:requestKey', getRequestFlowByKey);
router.get('/requests/:id', getRequestFlowById);
router.get('/requests/:id/steps', getRequestSteps);
router.get('/requests/:id/events', getRequestEvents);
router.get('/steps/:stepId/attempts', getStepAttempts);
router.post('/steps/:stepId/reinitiate', reinitiateFailedStep);

export default router;
