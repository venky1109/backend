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

export const Brand = new BasePgModel('catalog.brands', ['id','brand_code','brand_name_english','brand_name_telugu']);
export const Category = new BasePgModel('catalog.categories', ['id','category_code','category_name_english','category_name_telugu']);
export const Product = new ProductPgModel('catalog.products', ['id','product_code','product_name_eng','product_name_tel','hsncode','gst_rate']);
export const Unit = new BasePgModel('catalog.units', ['id','unit_code','unit_name','unit_short_code']);
export const Stakeholder = new BasePgModel('catalog.stakeholders', ['id','stackholder_code','stakeholder_name','stakeholder_type','phone','email','address']);
export const Employee = new BasePgModel('catalog.employees', ['id','emp_code','first_name','last_name','email','phone','department','designation','salary','date_of_joining','is_active']);
export const Outlet = new BasePgModel('catalog.outlets', ['id','outlet_code','outlet_name','location','address','manager_id','phone','email','outlet_type']);
export const Warehouse = new BasePgModel('catalog.warehouses', ['id','warehouse_code','warehouse_name','address','phone']);
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
