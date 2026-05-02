import { query } from '../../config/pg.js';

export default class BasePgModel {
  constructor(tableName, allowedColumns) {
    this.tableName = tableName;
    this.allowedColumns = allowedColumns;
  }

  filterData(data) {
    const out = {};
    for (const col of this.allowedColumns) {
      if (Object.prototype.hasOwnProperty.call(data, col)) out[col] = data[col];
    }
    return out;
  }

  q(col) {
    return `"${col.replaceAll('"', '""')}"`;
  }
async findAll({ limit, offset = 0 } = {}) {
  let sql = `SELECT * FROM ${this.tableName} ORDER BY id DESC`;
  const params = [];

  if (limit && Number(limit) > 0) {
    sql += ` LIMIT $1 OFFSET $2`;
    params.push(Number(limit), Number(offset));
  }

  const { rows } = await query(sql, params);
  return rows;
}

  async findById(id) {
    const { rows } = await query(`SELECT * FROM ${this.tableName} WHERE id = $1`, [id]);
    return rows[0] || null;
  }

  async create(data) {
    const clean = this.filterData(data);
    const cols = Object.keys(clean);
    if (!cols.length) throw new Error('No valid fields provided');
    const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
    const sql = `INSERT INTO ${this.tableName} (${cols.map((c) => this.q(c)).join(', ')}) VALUES (${placeholders}) RETURNING *`;
    const { rows } = await query(sql, Object.values(clean));
    return rows[0];
  }

  async update(id, data) {
    const clean = this.filterData(data);
    const cols = Object.keys(clean);
    if (!cols.length) throw new Error('No valid fields provided');
    const sets = cols.map((c, i) => `${this.q(c)} = $${i + 1}`).join(', ');
    const sql = `UPDATE ${this.tableName} SET ${sets}, updated_at = NOW() WHERE id = $${cols.length + 1} RETURNING *`;
    const { rows } = await query(sql, [...Object.values(clean), id]);
    return rows[0] || null;
  }

  async remove(id) {
    const { rows } = await query(`DELETE FROM ${this.tableName} WHERE id = $1 RETURNING *`, [id]);
    return rows[0] || null;
  }
}
