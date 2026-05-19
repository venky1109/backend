import { LegacyProduct } from '../../models/inventory/legacyProductModel.js';

export const searchLegacyProducts = async (req, res, next) => {
  try {
    const { q, query, name, barcode, limit = 20 } = req.query;
    const suggestions = await LegacyProduct.search({
      query: q || query,
      name,
      barcode,
      limit,
    });

    res.json({
      suggestions,
      products: suggestions,
    });
  } catch (error) {
    next(error);
  }
};
