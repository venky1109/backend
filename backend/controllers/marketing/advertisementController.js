import {
  OutletAdvertise,
  OutletAdvertiseDetail,
  Repository,
} from '../../models/marketing/advertisementModels.js';

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
    const row = await OutletAdvertise.update(req.params.id, {
      ...req.body,
      updated_by: userLabel(req),
    });
    if (!row) return res.status(404).json({ message: 'Advertisement not found' });
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
