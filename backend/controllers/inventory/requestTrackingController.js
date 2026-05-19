import asyncHandler from '../../middleware/asyncHandler.js';
import { RequestTracking } from '../../models/inventory/requestTrackingModel.js';

export const getRequestFlows = asyncHandler(async (req, res) => {
  await RequestTracking.syncPendingDispatchReceiveRequests();

  const rows = await RequestTracking.findAll(req.query);

  if (rows.requestTrackingSetupRequired) {
    res.set('X-Request-Tracking-Setup-Required', 'true');
  }

  res.json(rows);
});

export const getRequestFlowById = asyncHandler(async (req, res) => {
  const row = await RequestTracking.findById(req.params.id);

  if (row?.requestTrackingSetupRequired) {
    res.status(503);
    throw new Error('Request tracking migration has not been applied');
  }

  if (!row) {
    res.status(404);
    throw new Error('Request flow not found');
  }

  res.json(row);
});

export const getRequestFlowByKey = asyncHandler(async (req, res) => {
  const row = await RequestTracking.findByKey(req.params.requestKey);

  if (row?.requestTrackingSetupRequired) {
    res.status(503);
    throw new Error('Request tracking migration has not been applied');
  }

  if (!row) {
    res.status(404);
    throw new Error('Request flow not found');
  }

  res.json(row);
});

export const getRequestSteps = asyncHandler(async (req, res) => {
  const requestFlow = await RequestTracking.findById(req.params.id);

  if (!requestFlow) {
    res.status(404);
    throw new Error('Request flow not found');
  }

  const rows = await RequestTracking.getSteps(req.params.id);
  res.json(rows);
});

export const getRequestEvents = asyncHandler(async (req, res) => {
  const requestFlow = await RequestTracking.findById(req.params.id);

  if (!requestFlow) {
    res.status(404);
    throw new Error('Request flow not found');
  }

  const rows = await RequestTracking.getEvents(req.params.id, req.query);
  res.json(rows);
});

export const getStepAttempts = asyncHandler(async (req, res) => {
  const step = await RequestTracking.getStepById(req.params.stepId);

  if (!step) {
    res.status(404);
    throw new Error('Request step not found');
  }

  const rows = await RequestTracking.getAttempts(req.params.stepId);
  res.json(rows);
});

export const reinitiateFailedStep = asyncHandler(async (req, res) => {
  const step = await RequestTracking.getStepById(req.params.stepId);

  if (!step) {
    res.status(404);
    throw new Error('Request step not found');
  }

  const requestedBy =
    req.body?.requested_by || RequestTracking.actorName(req.user || {});

  const attempt = await RequestTracking.reinitiateFailedStep(req.params.stepId, {
    requestedBy,
    payload: req.body?.payload || {},
  });

  const flow = await RequestTracking.findById(step.request_id);

  res.status(201).json({
    message: 'Failed request step reinitiated',
    attempt,
    request: flow,
  });
});
