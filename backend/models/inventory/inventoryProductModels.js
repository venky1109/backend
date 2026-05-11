import { query } from '../../config/pg.js';

export const InventoryProduct = {
  async findAll() {
    const { rows } = await query(`
      SELECT *
      FROM inventory.inventory_products
      ORDER BY updated_at DESC
    `);
    return rows;
  },

  async findById(id) {
    const { rows } = await query(
      `
      SELECT *
      FROM inventory.inventory_products
      WHERE id = $1
      `,
      [id]
    );
    return rows[0];
  },

  async create(data) {
    const keys = Object.keys(data);
    const values = Object.values(data);
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');

    const { rows } = await query(
      `
      INSERT INTO inventory.inventory_products (${keys.join(', ')})
      VALUES (${placeholders})
      RETURNING *
      `,
      values
    );

    return rows[0];
  },

  async update(id, data) {
    const keys = Object.keys(data);
    const values = Object.values(data);

    const setClause = keys.map((key, i) => `${key} = $${i + 1}`).join(', ');

    const { rows } = await query(
      `
      UPDATE inventory.inventory_products
      SET ${setClause}, updated_at = NOW()
      WHERE id = $${keys.length + 1}
      RETURNING *
      `,
      [...values, id]
    );

    return rows[0];
  },

  async remove(id) {
    const { rows } = await query(
      `
      DELETE FROM inventory.inventory_products
      WHERE id = $1
      RETURNING *
      `,
      [id]
    );

    return rows[0];
  },
};

export const StockTransaction = {
  async findAll() {
    const { rows } = await query(`
      SELECT *
      FROM inventory.stock_transaction
      ORDER BY created_at DESC
    `);
    return rows;
  },

  async findById(id) {
    const { rows } = await query(
      `
      SELECT *
      FROM inventory.stock_transaction
      WHERE id = $1
      `,
      [id]
    );
    return rows[0];
  },

  async create(data) {
    const keys = Object.keys(data);
    const values = Object.values(data);
    const placeholders = keys.map((_, i) => `$${i + 1}`).join(', ');

    const { rows } = await query(
      `
      INSERT INTO inventory.stock_transaction (${keys.join(', ')})
      VALUES (${placeholders})
      RETURNING *
      `,
      values
    );

    return rows[0];
  },

  async update(id, data) {
    const keys = Object.keys(data);
    const values = Object.values(data);

    const setClause = keys.map((key, i) => `${key} = $${i + 1}`).join(', ');

    const { rows } = await query(
      `
      UPDATE inventory.stock_transaction
      SET ${setClause}, updated_at = NOW()
      WHERE id = $${keys.length + 1}
      RETURNING *
      `,
      [...values, id]
    );

    return rows[0];
  },

  async remove(id) {
    const { rows } = await query(
      `
      DELETE FROM inventory.stock_transaction
      WHERE id = $1
      RETURNING *
      `,
      [id]
    );

    return rows[0];
  },
};