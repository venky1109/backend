import BasePgModel from './BasePgModel.js';
import { query } from '../../config/pg.js';

class BillPgModel extends BasePgModel {
  normalizeAttachments(value) {
    if (value === null || value === undefined) {
      return undefined;
    }

    if (Array.isArray(value)) {
      return value;
    }

    if (typeof value === 'object') {
      return [value];
    }

    if (typeof value === 'string') {
      const trimmed = value.trim();

      if (!trimmed) {
        return undefined;
      }

      try {
        const parsed = JSON.parse(trimmed);
        return Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        return [{ url: trimmed }];
      }
    }

    return undefined;
  }

  filterData(data) {
    const clean = super.filterData(data);
    const defaultBackedColumns = [
      'amount',
      'tax_amount',
      'total_amount',
      'currency',
      'status',
      'payment_status',
      'attachments',
    ];

    for (const column of defaultBackedColumns) {
      if (clean[column] === null || clean[column] === undefined) {
        delete clean[column];
      }
    }

    const attachments = this.normalizeAttachments(data.attachments);

    if (attachments !== undefined) {
      clean.attachments = attachments;
    }

    return clean;
  }
}

class ProductPgModel extends BasePgModel {
  async create(data) {
    const clean = this.filterData(data);
    const productName = String(
      clean.product_name_eng || clean.product_name_tel || ''
    ).trim();

    if (productName) {
      const { rows } = await query(
        `
        SELECT *
        FROM ${this.tableName}
        WHERE lower(trim(product_name_eng)) = lower(trim($1))
           OR lower(trim(product_name_tel)) = lower(trim($1))
        ORDER BY id ASC
        LIMIT 1
        `,
        [productName]
      );

      if (rows[0]) {
        return rows[0];
      }
    }

    return super.create(data);
  }
}

class RatePlanPgModel extends BasePgModel {
  async ensureTable() {
    await query(`
      CREATE TABLE IF NOT EXISTS catalog.rate_plans (
        id BIGSERIAL PRIMARY KEY,
        product_barcode_id BIGINT NOT NULL
          REFERENCES catalog.product_barcodes(id) ON DELETE CASCADE,
        rate_for TEXT NOT NULL DEFAULT 'customer',
        gst_rate NUMERIC(8, 2) NOT NULL DEFAULT 0,
        margin_percentage NUMERIC(8, 2) NOT NULL DEFAULT 0,
        labour_percentage NUMERIC(8, 2) NOT NULL DEFAULT 0,
        transport_percentage NUMERIC(8, 2) NOT NULL DEFAULT 0,
        load_percentage NUMERIC(8, 2) NOT NULL DEFAULT 0,
        unload_percentage NUMERIC(8, 2) NOT NULL DEFAULT 0,
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await query(`
      ALTER TABLE catalog.rate_plans
      ADD COLUMN IF NOT EXISTS gst_rate NUMERIC(8, 2) NOT NULL DEFAULT 0
    `);

    await query(`
      ALTER TABLE catalog.rate_plans
      ADD COLUMN IF NOT EXISTS rate_for TEXT NOT NULL DEFAULT 'customer'
    `);

    await query(`
      ALTER TABLE catalog.rate_plans
      DROP COLUMN IF EXISTS package_amount
    `);

    await query(`
      ALTER TABLE catalog.rate_plans
      DROP COLUMN IF EXISTS mrp_amount
    `);

    await query(`
      ALTER TABLE catalog.rate_plans
      DROP CONSTRAINT IF EXISTS rate_plans_product_barcode_id_key
    `);

    await query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_catalog_rate_plans_barcode_rate_for
      ON catalog.rate_plans(product_barcode_id, lower(rate_for))
    `);
  }

  async findAll(options = {}) {
    await this.ensureTable();

    const { rows } = await query(`
      SELECT
        rp.*,
        pb.mk_barcode,
        pb.barcode,
        pb.quantity AS barcode_quantity,
        p.product_name_eng,
        p.product_code,
        b.brand_name_english,
        c.category_name_english,
        u.unit_name,
        u.unit_short_code
      FROM catalog.rate_plans rp
      LEFT JOIN catalog.product_barcodes pb ON pb.id = rp.product_barcode_id
      LEFT JOIN catalog.products p ON p.id = pb.product_id
      LEFT JOIN catalog.brands b ON b.id = pb.brand_id
      LEFT JOIN catalog.categories c ON c.id = pb.category_id
      LEFT JOIN catalog.units u ON u.id = pb.unit_id
      ORDER BY rp.id DESC
      ${options.limit && Number(options.limit) > 0 ? 'LIMIT $1 OFFSET $2' : ''}
    `, options.limit && Number(options.limit) > 0 ? [Number(options.limit), Number(options.offset || 0)] : []);

    return rows;
  }

  async findById(id) {
    await this.ensureTable();
    return super.findById(id);
  }

  async create(data) {
    await this.ensureTable();
    return super.create(data);
  }

  async update(id, data) {
    await this.ensureTable();
    return super.update(id, data);
  }

  async remove(id) {
    await this.ensureTable();
    return super.remove(id);
  }
}

export const Brand = new BasePgModel('catalog.brands', ['id','brand_code','brand_name_english','brand_name_telugu']);
export const Category = new BasePgModel('catalog.categories', ['id','category_code','category_name_english','category_name_telugu']);
export const Product = new ProductPgModel('catalog.products', ['id','product_code','product_name_eng','product_name_tel','hsncode','gst_rate']);
export const Unit = new BasePgModel('catalog.units', ['id','unit_code','unit_name','unit_short_code']);
export const Stakeholder = new BasePgModel('catalog.stakeholders', ['id','stackholder_code','stakeholder_name','stakeholder_type','phone','email','address']);
export const Employee = new BasePgModel('catalog.employees', ['id','emp_code','first_name','last_name','email','phone','department','designation','salary','date_of_joining','is_active']);
export const Outlet = new BasePgModel('catalog.outlets', ['id','outlet_code','outlet_name','location','address','manager_id','phone','email','outlet_type']);
export const Warehouse = new BasePgModel('catalog.warehouses', ['id','warehouse_code','warehouse_name','address','phone']);
export const RatePlan = new RatePlanPgModel('catalog.rate_plans', [
  'id',
  'product_barcode_id',
  'rate_for',
  'gst_rate',
  'margin_percentage',
  'labour_percentage',
  'transport_percentage',
  'load_percentage',
  'unload_percentage',
  'notes',
]);
export const Bill = new BillPgModel('catalog.bills', [
  'id',
  'bill_number',
  'bill_date',
  'service_from_date',
  'service_to_date',
  'due_date',
  'organisation_name',
  'organisation_type',
  'bill_category',
  'expense_type',
  'transportation_type',
  'supplier_id',
  'warehouse_id',
  'outlet_id',
  'amount',
  'tax_amount',
  'total_amount',
  'currency',
  'status',
  'payment_status',
  'notes',
  'attachments',
]);
