import mongoose from 'mongoose';
import { query } from '../../config/pg.js';
import Order from '../orderModel.js';
import Product from '../productModel.js';
import User from '../userModel.js';

const DAY_MS = 24 * 60 * 60 * 1000;

const roundMoney = (value) => Number(Number(value || 0).toFixed(2));

const getDateRange = ({ from, to, days = 7 } = {}) => {
  const endDate = to ? new Date(to) : new Date();
  endDate.setHours(23, 59, 59, 999);

  const startDate = from
    ? new Date(from)
    : new Date(endDate.getTime() - (Number(days) - 1) * DAY_MS);
  startDate.setHours(0, 0, 0, 0);

  return { startDate, endDate };
};

const getObjectIdFromDate = (date) =>
  mongoose.Types.ObjectId.createFromTime(Math.floor(date.getTime() / 1000));

const getOrderMatch = (startDate, endDate, outlet) => {
  const match = {
    createdAt: { $gte: startDate, $lte: endDate },
  };

  if (outlet) {
    match.posLocation = outlet;
  }

  return match;
};

const normalizeBarcode = (barcode) => String(barcode || '').trim();

const getCostByBarcode = async (barcodes = []) => {
  const uniqueBarcodes = [...new Set(barcodes.map(normalizeBarcode).filter(Boolean))];

  if (!uniqueBarcodes.length) return {};

  const { rows } = await query(
    `
    SELECT
      pb.mk_barcode,
      pb.barcode,
      AVG(COALESCE(ip.unit_price, 0)) AS unit_cost
    FROM catalog.product_barcodes pb
    LEFT JOIN inventory.inventory_products ip
      ON ip.product_barcode_id = pb.id
    WHERE COALESCE(pb.mk_barcode, pb.barcode) = ANY($1)
       OR pb.barcode = ANY($1)
       OR pb.mk_barcode = ANY($1)
    GROUP BY pb.mk_barcode, pb.barcode
    `,
    [uniqueBarcodes]
  );

  return rows.reduce((acc, row) => {
    const cost = Number(row.unit_cost || 0);
    if (row.mk_barcode) acc[normalizeBarcode(row.mk_barcode)] = cost;
    if (row.barcode) acc[normalizeBarcode(row.barcode)] = cost;
    return acc;
  }, {});
};

export const InventoryDashboard = {
  getRange: getDateRange,

  async getOutletTopProducts({ startDate, endDate, outlet, limit = 10 }) {
    const products = await Order.aggregate([
      { $match: getOrderMatch(startDate, endDate, outlet) },
      { $unwind: '$orderItems' },
      {
        $group: {
          _id: {
            productId: { $ifNull: ['$orderItems.productId', '$orderItems.product'] },
            brandId: '$orderItems.brandId',
            financialId: '$orderItems.financialId',
            name: '$orderItems.name',
            brand: '$orderItems.brand',
            quantity: '$orderItems.quantity',
            units: '$orderItems.units',
          },
          productId: { $first: { $ifNull: ['$orderItems.productId', '$orderItems.product'] } },
          brandId: { $first: '$orderItems.brandId' },
          financialId: { $first: '$orderItems.financialId' },
          name: { $first: '$orderItems.name' },
          brand: { $first: '$orderItems.brand' },
          quantity: { $first: '$orderItems.quantity' },
          units: { $first: '$orderItems.units' },
          totalQty: { $sum: { $ifNull: ['$orderItems.qty', 0] } },
          totalAmount: {
            $sum: {
              $multiply: [
                { $ifNull: ['$orderItems.qty', 0] },
                { $ifNull: ['$orderItems.price', 0] },
              ],
            },
          },
          orderCount: { $sum: 1 },
        },
      },
      { $sort: { totalQty: -1, totalAmount: -1, name: 1 } },
      { $limit: Number(limit) },
    ]);

    return products.map((product, index) => ({
      rank: index + 1,
      productId: product.productId ? String(product.productId) : '',
      brandId: product.brandId ? String(product.brandId) : '',
      financialId: product.financialId ? String(product.financialId) : '',
      name: product.name,
      brand: product.brand,
      weight: `${product.quantity || ''} ${product.units || ''}`.trim(),
      totalQty: product.totalQty || 0,
      totalAmount: roundMoney(product.totalAmount),
      orderCount: product.orderCount || 0,
    }));
  },

  async getWarehouseTopProducts({ startDate, endDate, limit = 10 }) {
    const { rows } = await query(
      `
      SELECT
        doi.product_id,
        doi.product_barcode_id,
        COALESCE(p.product_name_eng, p.product_name_tel, p.product_code) AS name,
        b.brand_name_english AS brand,
        u.unit_short_code AS units,
        SUM(COALESCE(doi.no_of_units, doi.qty, 0)) AS total_qty,
        SUM(COALESCE(doi.no_of_units, doi.qty, 0) * COALESCE(ip.unit_price, 0)) AS dispatch_value,
        COUNT(DISTINCT d.id) AS order_count
      FROM dispatch.dispatch_order d
      JOIN dispatch.dispatch_order_items doi ON doi.dispatch_order_id = d.id
      LEFT JOIN LATERAL (
        SELECT AVG(COALESCE(unit_price, 0)) AS unit_price
        FROM inventory.inventory_products ip
        WHERE ip.product_barcode_id = doi.product_barcode_id
          AND ip.exp_date::date = doi.exp_date::date
      ) ip ON true
      LEFT JOIN catalog.products p ON p.id = doi.product_id
      LEFT JOIN catalog.brands b ON b.id = doi.brand_id
      LEFT JOIN catalog.units u ON u.id = doi.unit_id
      WHERE d.created_at BETWEEN $1 AND $2
        AND d.dispatch_status IN ('dispatched', 'received_to_outlet')
      GROUP BY doi.product_id, doi.product_barcode_id, name, brand, units
      ORDER BY total_qty DESC, dispatch_value DESC, name ASC
      LIMIT $3
      `,
      [startDate, endDate, Number(limit)]
    );

    return rows.map((row, index) => ({
      rank: index + 1,
      productId: row.product_id,
      productBarcodeId: row.product_barcode_id,
      name: row.name,
      brand: row.brand,
      units: row.units,
      totalQty: Number(row.total_qty || 0),
      dispatchValue: roundMoney(row.dispatch_value),
      orderCount: Number(row.order_count || 0),
    }));
  },

  async getOutletProductsRequiringOrder({ startDate, endDate, outlet }) {
    const soldProducts = await Order.aggregate([
      { $match: getOrderMatch(startDate, endDate, outlet) },
      { $unwind: '$orderItems' },
      {
        $group: {
          _id: '$orderItems.financialId',
          productId: { $first: { $ifNull: ['$orderItems.productId', '$orderItems.product'] } },
          brandId: { $first: '$orderItems.brandId' },
          financialId: { $first: '$orderItems.financialId' },
          totalQty: { $sum: { $ifNull: ['$orderItems.qty', 0] } },
        },
      },
      { $match: { totalQty: { $gte: 14 } } },
    ]);

    const fastMovingIds = soldProducts
      .map((item) => item.financialId)
      .filter((id) => mongoose.Types.ObjectId.isValid(id));

    if (!fastMovingIds.length) return [];

    const products = await Product.aggregate([
      { $unwind: '$details' },
      { $unwind: '$details.financials' },
      {
        $match: {
          'details.financials._id': { $in: fastMovingIds },
          'details.financials.countInStock': { $lt: 10 },
        },
      },
      {
        $project: {
          _id: 0,
          productId: { $toString: '$_id' },
          financialId: { $toString: '$details.financials._id' },
          name: '$name',
          brand: '$details.brand',
          countInStock: '$details.financials.countInStock',
          price: '$details.financials.dprice',
          quantity: '$details.financials.quantity',
          units: '$details.financials.units',
        },
      },
    ]);

    const salesByFinancialId = soldProducts.reduce((acc, item) => {
      acc[String(item.financialId)] = item.totalQty || 0;
      return acc;
    }, {});

    return products.map((product) => ({
      ...product,
      perDaySale: roundMoney((salesByFinancialId[product.financialId] || 0) / 7),
    }));
  },

  async getWarehouseProductsRequiringOrder({ startDate, endDate }) {
    const { rows } = await query(
      `
      WITH weekly_sales AS (
        SELECT
          doi.product_barcode_id,
          SUM(COALESCE(doi.no_of_units, doi.qty, 0)) AS sold_qty
        FROM dispatch.dispatch_order d
        JOIN dispatch.dispatch_order_items doi ON doi.dispatch_order_id = d.id
        WHERE d.created_at BETWEEN $1 AND $2
          AND d.dispatch_status IN ('dispatched', 'received_to_outlet')
        GROUP BY doi.product_barcode_id
      ),
      current_stock AS (
        SELECT
          ip.product_barcode_id,
          SUM(COALESCE(ip.count_in_stock, ip.no_of_units, 0)) AS stock_count
        FROM inventory.inventory_products ip
        WHERE COALESCE(ip.is_active, true) = true
        GROUP BY ip.product_barcode_id
      )
      SELECT
        cs.product_barcode_id,
        COALESCE(p.product_name_eng, p.product_name_tel, p.product_code) AS name,
        b.brand_name_english AS brand,
        cs.stock_count,
        ws.sold_qty,
        ws.sold_qty / 7.0 AS per_day_sale
      FROM current_stock cs
      JOIN weekly_sales ws ON ws.product_barcode_id = cs.product_barcode_id
      LEFT JOIN catalog.product_barcodes pb ON pb.id = cs.product_barcode_id
      LEFT JOIN catalog.products p ON p.id = pb.product_id
      LEFT JOIN catalog.brands b ON b.id = pb.brand_id
      WHERE cs.stock_count < 10
        AND ws.sold_qty >= 14
      ORDER BY per_day_sale DESC, cs.stock_count ASC
      `,
      [startDate, endDate]
    );

    return rows.map((row) => ({
      productBarcodeId: row.product_barcode_id,
      name: row.name,
      brand: row.brand,
      stockCount: Number(row.stock_count || 0),
      soldQty: Number(row.sold_qty || 0),
      perDaySale: roundMoney(row.per_day_sale),
    }));
  },

  async getNewOutletProducts({ startDate, limit = 25 }) {
    const products = await Product.find({ _id: { $gte: getObjectIdFromDate(startDate) } })
      .select('name category details')
      .sort({ _id: -1 })
      .limit(Number(limit))
      .lean();

    return products.map((product) => ({
      productId: String(product._id),
      name: product.name,
      category: product.category,
      createdAt: product._id.getTimestamp(),
      brandCount: product.details?.length || 0,
    }));
  },

  async getNewWarehouseProducts({ startDate, endDate, limit = 25 }) {
    const { rows } = await query(
      `
      SELECT
        ip.product_barcode_id,
        COALESCE(p.product_name_eng, p.product_name_tel, p.product_code) AS name,
        MIN(ip.created_at) AS created_at,
        SUM(COALESCE(ip.count_in_stock, ip.no_of_units, 0)) AS stock_count
      FROM inventory.inventory_products ip
      LEFT JOIN catalog.product_barcodes pb ON pb.id = ip.product_barcode_id
      LEFT JOIN catalog.products p ON p.id = pb.product_id
      WHERE ip.created_at BETWEEN $1 AND $2
      GROUP BY ip.product_barcode_id, p.product_name_eng, p.product_name_tel, p.product_code
      ORDER BY created_at DESC
      LIMIT $3
      `,
      [startDate, endDate, Number(limit)]
    );

    return rows.map((row) => ({
      productBarcodeId: row.product_barcode_id,
      name: row.name,
      createdAt: row.created_at,
      stockCount: Number(row.stock_count || 0),
    }));
  },

  async getOutletOutOfStockProducts({ limit = 100 }) {
    const products = await Product.aggregate([
      { $unwind: '$details' },
      { $unwind: '$details.financials' },
      { $match: { 'details.financials.countInStock': { $lte: 0 } } },
      {
        $project: {
          _id: 0,
          productId: { $toString: '$_id' },
          financialId: { $toString: '$details.financials._id' },
          name: '$name',
          category: '$category',
          brand: '$details.brand',
          quantity: '$details.financials.quantity',
          units: '$details.financials.units',
          countInStock: '$details.financials.countInStock',
        },
      },
      { $sort: { name: 1 } },
      { $limit: Number(limit) },
    ]);

    return products;
  },

  async getWarehouseOutOfStockProducts({ limit = 100 }) {
    const { rows } = await query(
      `
      SELECT
        ip.product_barcode_id,
        COALESCE(p.product_name_eng, p.product_name_tel, p.product_code) AS name,
        SUM(COALESCE(ip.count_in_stock, ip.no_of_units, 0)) AS stock_count
      FROM inventory.inventory_products ip
      LEFT JOIN catalog.product_barcodes pb ON pb.id = ip.product_barcode_id
      LEFT JOIN catalog.products p ON p.id = pb.product_id
      WHERE COALESCE(ip.is_active, true) = true
      GROUP BY ip.product_barcode_id, p.product_name_eng, p.product_name_tel, p.product_code
      HAVING SUM(COALESCE(ip.count_in_stock, ip.no_of_units, 0)) <= 0
      ORDER BY name ASC
      LIMIT $1
      `,
      [Number(limit)]
    );

    return rows.map((row) => ({
      productBarcodeId: row.product_barcode_id,
      name: row.name,
      stockCount: Number(row.stock_count || 0),
    }));
  },

  async getOrderSummary({ startDate, endDate, outlet }) {
    const match = getOrderMatch(startDate, endDate, outlet);

    const [outletSummary = {}] = await Order.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          totalOrders: { $sum: 1 },
          totalAmount: { $sum: { $ifNull: ['$totalPrice', 0] } },
          averageOrderAmount: { $avg: { $ifNull: ['$totalPrice', 0] } },
        },
      },
    ]);

    const outletwise = await Order.aggregate([
      { $match: getOrderMatch(startDate, endDate) },
      {
        $group: {
          _id: { $ifNull: ['$posLocation', 'ONLINE'] },
          totalOrders: { $sum: 1 },
          totalAmount: { $sum: { $ifNull: ['$totalPrice', 0] } },
        },
      },
      { $sort: { totalAmount: -1 } },
    ]);

    const eightWeeksAgo = new Date(endDate.getTime() - 55 * DAY_MS);
    const [averageOrders = {}] = await Order.aggregate([
      { $match: { createdAt: { $gte: eightWeeksAgo, $lte: endDate } } },
      {
        $group: {
          _id: {
            year: { $isoWeekYear: '$createdAt' },
            week: { $isoWeek: '$createdAt' },
          },
          orderCount: { $sum: 1 },
        },
      },
      { $group: { _id: null, averageOrdersPerWeek: { $avg: '$orderCount' } } },
    ]);

    const { rows: warehouseRows } = await query(
      `
      SELECT
        COUNT(DISTINCT d.id) AS total_orders,
        COALESCE(SUM(COALESCE(doi.no_of_units, doi.qty, 0) * COALESCE(ip.unit_price, 0)), 0) AS total_amount
      FROM dispatch.dispatch_order d
      LEFT JOIN dispatch.dispatch_order_items doi ON doi.dispatch_order_id = d.id
      LEFT JOIN LATERAL (
        SELECT AVG(COALESCE(unit_price, 0)) AS unit_price
        FROM inventory.inventory_products ip
        WHERE ip.product_barcode_id = doi.product_barcode_id
          AND ip.exp_date::date = doi.exp_date::date
      ) ip ON true
      WHERE d.created_at BETWEEN $1 AND $2
        AND d.dispatch_status IN ('dispatched', 'received_to_outlet')
      `,
      [startDate, endDate]
    );

    return {
      outlets: {
        totalOrders: outletSummary.totalOrders || 0,
        totalAmount: roundMoney(outletSummary.totalAmount),
        averageOrderAmount: roundMoney(outletSummary.averageOrderAmount),
        averageOrdersPerWeek: roundMoney(averageOrders.averageOrdersPerWeek),
        outletwise: outletwise.map((item) => ({
          outlet: item._id,
          totalOrders: item.totalOrders,
          totalAmount: roundMoney(item.totalAmount),
        })),
      },
      warehouse: {
        totalOrders: Number(warehouseRows[0]?.total_orders || 0),
        totalAmount: roundMoney(warehouseRows[0]?.total_amount),
      },
    };
  },

  async getCustomerSummary({ startDate, endDate }) {
    const [totals, newCustomersByOutlet, activeCustomers, orderFrequency] =
      await Promise.all([
        User.countDocuments({}),
        User.aggregate([
          { $match: { createdAt: { $gte: startDate, $lte: endDate } } },
          {
            $group: {
              _id: { $ifNull: ['$deliveryAddress.city', 'UNASSIGNED'] },
              newCustomers: { $sum: 1 },
            },
          },
          { $sort: { newCustomers: -1 } },
        ]),
        Order.distinct('user', { createdAt: { $gte: startDate, $lte: endDate } }),
        Order.aggregate([
          { $match: { createdAt: { $gte: startDate, $lte: endDate } } },
          { $group: { _id: '$user', orderCount: { $sum: 1 } } },
          {
            $group: {
              _id: null,
              averageOrdersPerActiveCustomer: { $avg: '$orderCount' },
              repeatCustomers: {
                $sum: { $cond: [{ $gte: ['$orderCount', 2] }, 1, 0] },
              },
            },
          },
        ]),
      ]);

    const frequency = orderFrequency[0] || {};

    return {
      totalCustomers: totals,
      activeCustomers: activeCustomers.length,
      newCustomersLastWeek: newCustomersByOutlet.reduce(
        (sum, item) => sum + item.newCustomers,
        0
      ),
      outletwiseNewCustomers: newCustomersByOutlet.map((item) => ({
        outlet: item._id,
        newCustomers: item.newCustomers,
      })),
      averageOrdersPerActiveCustomer: roundMoney(
        frequency.averageOrdersPerActiveCustomer
      ),
      repeatCustomers: frequency.repeatCustomers || 0,
    };
  },

  async getFinanceSummary({ startDate, endDate, outlet }) {
    const orders = await Order.find(getOrderMatch(startDate, endDate, outlet))
      .select('orderItems totalPrice posLocation')
      .lean();

    const barcodes = [];
    for (const order of orders) {
      for (const item of order.orderItems || []) {
        const itemBarcodes = Array.isArray(item.barcode) ? item.barcode : [item.barcode];
        barcodes.push(...itemBarcodes);
      }
    }

    const costByBarcode = await getCostByBarcode(barcodes);

    let outletRevenue = 0;
    let outletCost = 0;
    const productProfit = {};

    for (const order of orders) {
      outletRevenue += Number(order.totalPrice || 0);

      for (const item of order.orderItems || []) {
        const barcode = normalizeBarcode(Array.isArray(item.barcode) ? item.barcode[0] : item.barcode);
        const qty = Number(item.qty || 0);
        const revenue = qty * Number(item.price || 0);
        const cost = qty * Number(costByBarcode[barcode] || 0);
        const key = `${item.name || 'Product'}|${item.brand || ''}|${item.quantity || ''}|${item.units || ''}`;

        outletCost += cost;
        productProfit[key] = productProfit[key] || {
          name: item.name,
          brand: item.brand,
          weight: `${item.quantity || ''} ${item.units || ''}`.trim(),
          qty: 0,
          revenue: 0,
          estimatedCost: 0,
          estimatedProfit: 0,
        };

        productProfit[key].qty += qty;
        productProfit[key].revenue += revenue;
        productProfit[key].estimatedCost += cost;
        productProfit[key].estimatedProfit += revenue - cost;
      }
    }

    const { rows } = await query(
      `
      SELECT
        COALESCE(SUM(COALESCE(doi.no_of_units, doi.qty, 0) * COALESCE(ip.unit_price, 0)), 0) AS dispatch_value_at_cost
      FROM dispatch.dispatch_order d
      LEFT JOIN dispatch.dispatch_order_items doi ON doi.dispatch_order_id = d.id
      LEFT JOIN LATERAL (
        SELECT AVG(COALESCE(unit_price, 0)) AS unit_price
        FROM inventory.inventory_products ip
        WHERE ip.product_barcode_id = doi.product_barcode_id
          AND ip.exp_date::date = doi.exp_date::date
      ) ip ON true
      WHERE d.created_at BETWEEN $1 AND $2
        AND d.dispatch_status IN ('dispatched', 'received_to_outlet')
      `,
      [startDate, endDate]
    );

    return {
      outlets: {
        saleAmount: roundMoney(outletRevenue),
        estimatedCost: roundMoney(outletCost),
        estimatedProfit: roundMoney(outletRevenue - outletCost),
        productProfit: Object.values(productProfit)
          .map((item) => ({
            ...item,
            revenue: roundMoney(item.revenue),
            estimatedCost: roundMoney(item.estimatedCost),
            estimatedProfit: roundMoney(item.estimatedProfit),
          }))
          .sort((a, b) => b.estimatedProfit - a.estimatedProfit)
          .slice(0, 25),
      },
      warehouse: {
        dispatchValueAtCost: roundMoney(rows[0]?.dispatch_value_at_cost),
        note: 'Warehouse dispatch value is calculated from inventory unit cost because selling price is stored in outlet sales.',
      },
    };
  },
};
