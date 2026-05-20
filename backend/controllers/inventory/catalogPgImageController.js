import { query } from '../../config/pg.js';

export const getImages = async (req, res, next) => {
  try {
    const { rows } = await query(
      `
      SELECT id, image_name, url, created_at, updated_at
      FROM catalog.images
      ORDER BY id DESC
      `
    );

    res.json({ data: rows });
  } catch (error) {
    next(error);
  }
};

export const createImage = async (req, res, next) => {
  try {
    const { image_name, url } = req.body;

    if (!image_name || !url) {
      return res.status(400).json({ message: 'image_name and url are required' });
    }

    const { rows } = await query(
      `
      INSERT INTO catalog.images (image_name, url)
      VALUES ($1, $2)
      RETURNING *
      `,
      [image_name, url]
    );

    res.status(201).json(rows[0]);
  } catch (error) {
    next(error);
  }
};

export const updateImage = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { image_name, url } = req.body;

    const { rows } = await query(
      `
      UPDATE catalog.images
      SET image_name = COALESCE($1, image_name),
          url = COALESCE($2, url),
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
      RETURNING *
      `,
      [image_name, url, id]
    );

    if (!rows[0]) {
      return res.status(404).json({ message: 'Image not found' });
    }

    res.json(rows[0]);
  } catch (error) {
    next(error);
  }
};

export const deleteImage = async (req, res, next) => {
  try {
    const { id } = req.params;

    const { rows } = await query(
      `
      DELETE FROM catalog.images
      WHERE id = $1
      RETURNING id
      `,
      [id]
    );

    if (!rows[0]) {
      return res.status(404).json({ message: 'Image not found' });
    }

    res.json({ message: 'Image deleted successfully' });
  } catch (error) {
    next(error);
  }
};
