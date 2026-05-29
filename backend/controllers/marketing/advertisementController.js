import {
  OutletAdvertise,
  OutletAdvertiseDetail,
  Repository,
} from '../../models/marketing/advertisementModels.js';
import { query } from '../../config/pg.js';
import Product from '../../models/productModel.js';

const userLabel = (req) =>
  req.user?.username || req.user?.name || req.user?._id?.toString() || '';

export const listRepositories = async (req, res, next) => {
  try {
    res.json(await Repository.findAll());
  } catch (error) {
    next(error);
  }
};

export const createRepository = async (req, res, next) => {
  try {
    const row = await Repository.create(req.body);
    res.status(201).json(row);
  } catch (error) {
    next(error);
  }
};

export const updateRepository = async (req, res, next) => {
  try {
    const row = await Repository.update(req.params.id, req.body);
    if (!row) return res.status(404).json({ message: 'Repository not found' });
    res.json(row);
  } catch (error) {
    next(error);
  }
};

export const deleteRepository = async (req, res, next) => {
  try {
    const row = await Repository.remove(req.params.id);
    if (!row) return res.status(404).json({ message: 'Repository not found' });
    res.json({ message: 'Deleted successfully', deleted: row });
  } catch (error) {
    next(error);
  }
};

export const listAdvertisements = async (req, res, next) => {
  try {
    const { limit, offset = 0 } = req.query;
    const rows = await OutletAdvertise.findAllWithDetails({
      limit: limit ? Number(limit) : undefined,
      offset: Number(offset),
    });
    res.json(rows);
  } catch (error) {
    next(error);
  }
};

export const getAdvertisementById = async (req, res, next) => {
  try {
    const row = await OutletAdvertise.findByIdWithDetails(req.params.id);
    if (!row) return res.status(404).json({ message: 'Advertisement not found' });
    res.json(row);
  } catch (error) {
    next(error);
  }
};

export const createAdvertisement = async (req, res, next) => {
  try {
    const row = await OutletAdvertise.create({
      ...req.body,
      created_by: userLabel(req),
      updated_by: userLabel(req),
    });
    res.status(201).json(row);
  } catch (error) {
    next(error);
  }
};

export const updateAdvertisement = async (req, res, next) => {
  try {
    const { details, ...advertisement } = req.body;
    const row = await OutletAdvertise.update(req.params.id, {
      ...advertisement,
      updated_by: userLabel(req),
    });
    if (!row) return res.status(404).json({ message: 'Advertisement not found' });

    if (Array.isArray(details)) {
      await query(
        'DELETE FROM marketing.outlet_advertise_details WHERE outlet_advertise_id = $1',
        [req.params.id]
      );

      for (const detail of details) {
        await OutletAdvertiseDetail.create({
          ...detail,
          outlet_advertise_id: req.params.id,
        });
      }
    }

    res.json(row);
  } catch (error) {
    next(error);
  }
};

export const deleteAdvertisement = async (req, res, next) => {
  try {
    const row = await OutletAdvertise.remove(req.params.id);
    if (!row) return res.status(404).json({ message: 'Advertisement not found' });
    res.json({ message: 'Deleted successfully', deleted: row });
  } catch (error) {
    next(error);
  }
};

export const createAdvertisementDetail = async (req, res, next) => {
  try {
    const row = await OutletAdvertiseDetail.create({
      ...req.body,
      outlet_advertise_id: req.params.advertisementId,
    });
    res.status(201).json(row);
  } catch (error) {
    next(error);
  }
};

export const updateAdvertisementDetail = async (req, res, next) => {
  try {
    const row = await OutletAdvertiseDetail.update(req.params.detailId, req.body);
    if (!row) return res.status(404).json({ message: 'Advertisement detail not found' });
    res.json(row);
  } catch (error) {
    next(error);
  }
};

export const deleteAdvertisementDetail = async (req, res, next) => {
  try {
    const row = await OutletAdvertiseDetail.remove(req.params.detailId);
    if (!row) return res.status(404).json({ message: 'Advertisement detail not found' });
    res.json({ message: 'Deleted successfully', deleted: row });
  } catch (error) {
    next(error);
  }
};

export const getActiveAdvertisementFeed = async (req, res, next) => {
  try {
    const rows = await OutletAdvertise.findActiveFeed({
      outletId: req.query.outlet_id || req.query.outletId,
    });
    res.json({
      generated_at: new Date().toISOString(),
      advertisements: rows,
    });
  } catch (error) {
    next(error);
  }
};

export const generateCanvaAdvertisementExport = async (req, res, next) => {
  try {
    const advertisement = await OutletAdvertise.findByIdWithDetails(req.params.id);

    if (!advertisement) {
      return res.status(404).json({ message: 'Advertisement not found' });
    }

    const canva = advertisement.config?.canva || {};

    if (!canva.enabled || !canva.brand_template_id) {
      return res.status(400).json({
        message: 'Enable Canva and enter a Canva brand template ID before generating.',
      });
    }

    if (!process.env.CANVA_CLIENT_ID || !process.env.CANVA_CLIENT_SECRET) {
      return res.status(501).json({
        message:
          'Canva export is configured on the advertisement, but backend Canva credentials are not set yet.',
        requiredEnv: ['CANVA_CLIENT_ID', 'CANVA_CLIENT_SECRET', 'CANVA_REDIRECT_URI'],
        canvaPayload: {
          brand_template_id: canva.brand_template_id,
          export_format: canva.export_format || 'mp4',
          fields: canva.fields || {},
          slides: advertisement.details || [],
        },
      });
    }

    return res.status(501).json({
      message:
        'Canva credentials are present, but OAuth token exchange/export worker is not implemented yet.',
      canvaPayload: {
        brand_template_id: canva.brand_template_id,
        export_format: canva.export_format || 'mp4',
        fields: canva.fields || {},
        slides: advertisement.details || [],
      },
    });
  } catch (error) {
    next(error);
  }
};

export const getCanvaProductFinancials = async (req, res, next) => {
  try {
    const requiredToken = process.env.CANVA_DATA_CONNECTOR_TOKEN;
    const suppliedToken =
      req.headers['x-canva-data-token'] || req.query.token || req.query.api_key;

    if (requiredToken && suppliedToken !== requiredToken) {
      return res.status(401).json({ message: 'Invalid Canva data connector token' });
    }

    const q = String(req.query.q || '').trim();
    const limit = Math.min(Math.max(Number(req.query.limit || 50), 1), 100);

    const mongoQuery = q
      ? {
          $or: [
            { name: { $regex: q, $options: 'i' } },
            { productname: { $regex: q, $options: 'i' } },
            { englishname: { $regex: q, $options: 'i' } },
            { category: { $regex: q, $options: 'i' } },
            { 'details.brand': { $regex: q, $options: 'i' } },
            { 'details.financials.MK_BARCODE': { $regex: q, $options: 'i' } },
            { 'details.financials.mkBarcode': { $regex: q, $options: 'i' } },
            { 'details.financials.barcode': { $regex: q, $options: 'i' } },
          ],
        }
      : {};

    const products = await Product.find(mongoQuery).limit(250).lean();
    const rows = [];

    for (const product of products) {
      for (const detail of product.details || []) {
        for (const financial of detail.financials || []) {
          const quantityText = [financial.quantity, financial.units]
            .filter((value) => value !== null && value !== undefined && value !== '')
            .join(' ');
          const mrp = Number(financial.price || 0);
          const salePrice = Number(financial.dprice || financial.price || 0);
          const barcode =
            financial.catalogProductBarcodeId ||
            financial.mkid ||
            financial.MK_BARCODE ||
            financial.mkBarcode ||
            (Array.isArray(financial.barcode) ? financial.barcode[0] : financial.barcode) ||
            '';

          rows.push({
            product_id: String(product._id),
            brand_id: String(detail._id),
            financial_id: String(financial._id),
            product_name: product.name || product.productname || '',
            brand_name: detail.brand || '',
            category: product.category || '',
            quantity: financial.quantity || '',
            units: financial.units || '',
            quantity_text: quantityText,
            mrp,
            sale_price: salePrice,
            discount: Number(financial.Discount || 0),
            stock: Number(financial.countInStock || 0),
            barcode: String(barcode || ''),
            offer_text:
              mrp && salePrice && salePrice < mrp
                ? `Rs. ${salePrice.toFixed(2)} instead of Rs. ${mrp.toFixed(2)}`
                : `Rs. ${(salePrice || mrp).toFixed(2)}`,
            image_url: detail.images?.[0]?.image || '',
          });

          if (rows.length >= limit) {
            return res.json({ rows });
          }
        }
      }
    }

    res.json({ rows });
  } catch (error) {
    next(error);
  }
};
