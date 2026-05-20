import asyncHandler from '../../middleware/asyncHandler.js';
import { ProductMigrationRollback } from '../../models/inventory/productMigrationRollbackModel.js';

export const previewProductRollback = asyncHandler(async (req, res) => {
  const preview = await ProductMigrationRollback.preview(req.body || {});
  res.json(preview);
});

export const rollbackProductMigration = asyncHandler(async (req, res) => {
  const result = await ProductMigrationRollback.rollback(
    req.body || {},
    req.user || {}
  );

  res.status(201).json(result);
});
