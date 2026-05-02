export const list = (Model) => async (req, res, next) => {
  try {
    const { limit, offset = 0 } = req.query;

    const rows = await Model.findAll({
      limit: limit ? Number(limit) : undefined,
      offset: Number(offset),
    });

    res.json(rows);
  } catch (error) {
    next(error);
  }
};

export const getById = (model) => async (req, res, next) => {
  try {
    const row = await model.findById(req.params.id);
    if (!row) return res.status(404).json({ message: 'Record not found' });
    res.json(row);
  } catch (err) { next(err); }
};

export const create = (model) => async (req, res, next) => {
  try {
    const row = await model.create(req.body);
    res.status(201).json(row);
  } catch (err) { next(err); }
};

export const update = (model) => async (req, res, next) => {
  try {
    const row = await model.update(req.params.id, req.body);
    if (!row) return res.status(404).json({ message: 'Record not found' });
    res.json(row);
  } catch (err) { next(err); }
};

export const remove = (model) => async (req, res, next) => {
  try {
    const row = await model.remove(req.params.id);
    if (!row) return res.status(404).json({ message: 'Record not found' });
    res.json({ message: 'Deleted successfully', deleted: row });
  } catch (err) { next(err); }
};
