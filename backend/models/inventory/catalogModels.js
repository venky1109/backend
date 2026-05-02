import BasePgModel from './BasePgModel.js';

export const Brand = new BasePgModel('catalog.brands', ['id','brand_code','brand_name_english','brand_name_telugu']);
export const Category = new BasePgModel('catalog.categories', ['id','category_code','category_name_english','category_name_telugu']);
export const Product = new BasePgModel('catalog.products', ['id','product_code','product_name_eng','product_name_tel','hsn-code','gst_rate']);
export const Unit = new BasePgModel('catalog.units', ['id','unit_code','unit_name','unit_short_code']);
export const Stakeholder = new BasePgModel('catalog.stakeholders', ['id','stackholder_code','stakeholder_name','stakeholder_type','phone','email','address']);
export const Employee = new BasePgModel('catalog.employees', ['id','emp_code','first_name','last_name','email','phone','department','designation','salary','date_of_joining','is_active']);
export const Outlet = new BasePgModel('catalog.outlets', ['id','outlet_code','outlet_name','location','address','manager_id','phone','email','outlet_type']);
export const Warehouse = new BasePgModel('catalog.warehouses', ['id','warehouse_code','warehouse_name','address','phone']);
