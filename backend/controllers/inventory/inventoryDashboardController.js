import asyncHandler from '../../middleware/asyncHandler.js';
import { InventoryDashboard } from '../../models/inventory/inventoryDashboardModel.js';

const getRangeFromRequest = (req) =>
  InventoryDashboard.getRange({
    from: req.query.from,
    to: req.query.to,
    days: req.query.days || 7,
  });

const getBaseParams = (req) => {
  const { startDate, endDate } = getRangeFromRequest(req);

  return {
    startDate,
    endDate,
    outlet: req.query.outlet || req.query.posLocation || null,
    limit: Number(req.query.limit || 10),
  };
};

const normalizeWarehouseTopProducts = (products = []) =>
  products.map((product) => {
    const rawPackQuantity =
      product.packQuantity ??
      product.pack_quantity ??
      product.barcodeQuantity ??
      product.barcode_quantity ??
      product.quantity ??
      null;
    const packQuantity =
      rawPackQuantity === null || rawPackQuantity === undefined
        ? null
        : Number(rawPackQuantity);
    const units = product.units || '';
    const weight =
      product.weight ||
      (packQuantity === null ? null : `${packQuantity} ${units}`.trim());

    return {
      ...product,
      packQuantity,
      pack_quantity: packQuantity,
      barcodeQuantity: packQuantity,
      barcode_quantity: packQuantity,
      quantity: packQuantity,
      weight,
    };
  });

export const getInventoryDashboardSummary = asyncHandler(async (req, res) => {
  const params = getBaseParams(req);

  const [
    outletTopProducts,
    warehouseTopProducts,
    outletProductsRequiringOrder,
    warehouseProductsRequiringOrder,
    newOutletProducts,
    newWarehouseProducts,
    outletOutOfStockProducts,
    warehouseOutOfStockProducts,
    orders,
    customers,
    finance,
  ] = await Promise.all([
    InventoryDashboard.getOutletTopProducts(params),
    InventoryDashboard.getWarehouseTopProducts(params),
    InventoryDashboard.getOutletProductsRequiringOrder(params),
    InventoryDashboard.getWarehouseProductsRequiringOrder(params),
    InventoryDashboard.getNewOutletProducts(params),
    InventoryDashboard.getNewWarehouseProducts(params),
    InventoryDashboard.getOutletOutOfStockProducts({ limit: 100 }),
    InventoryDashboard.getWarehouseOutOfStockProducts({ limit: 100 }),
    InventoryDashboard.getOrderSummary(params),
    InventoryDashboard.getCustomerSummary(params),
    InventoryDashboard.getFinanceSummary(params),
  ]);
  const normalizedWarehouseTopProducts =
    normalizeWarehouseTopProducts(warehouseTopProducts);

  res.json({
    range: {
      from: params.startDate,
      to: params.endDate,
      days: Math.ceil((params.endDate - params.startDate + 1) / (24 * 60 * 60 * 1000)),
    },
    filters: {
      outlet: params.outlet,
    },
    products: {
      outletTopProducts,
      warehouseTopProducts: normalizedWarehouseTopProducts,
      outletProductsRequiringOrder,
      warehouseProductsRequiringOrder,
      newOutletProducts,
      newWarehouseProducts,
      outletOutOfStockProducts,
      warehouseOutOfStockProducts,
    },
    orders,
    customers,
    finance,
    recommendedSections: {
      dashboardBuild: 'inventory-dashboard-pack-fields-v2',
      stockHealth: {
        outletOutOfStockCount: outletOutOfStockProducts.length,
        warehouseOutOfStockCount: warehouseOutOfStockProducts.length,
        outletReorderCount: outletProductsRequiringOrder.length,
        warehouseReorderCount: warehouseProductsRequiringOrder.length,
      },
    },
  });
});

export const getInventoryDashboardProducts = asyncHandler(async (req, res) => {
  const params = getBaseParams(req);

  const [
    outletTopProducts,
    warehouseTopProducts,
    outletProductsRequiringOrder,
    warehouseProductsRequiringOrder,
    newOutletProducts,
    newWarehouseProducts,
    outletOutOfStockProducts,
    warehouseOutOfStockProducts,
  ] = await Promise.all([
    InventoryDashboard.getOutletTopProducts(params),
    InventoryDashboard.getWarehouseTopProducts(params),
    InventoryDashboard.getOutletProductsRequiringOrder(params),
    InventoryDashboard.getWarehouseProductsRequiringOrder(params),
    InventoryDashboard.getNewOutletProducts(params),
    InventoryDashboard.getNewWarehouseProducts(params),
    InventoryDashboard.getOutletOutOfStockProducts({ limit: Number(req.query.stockLimit || 100) }),
    InventoryDashboard.getWarehouseOutOfStockProducts({ limit: Number(req.query.stockLimit || 100) }),
  ]);
  const normalizedWarehouseTopProducts =
    normalizeWarehouseTopProducts(warehouseTopProducts);

  res.json({
    dashboardBuild: 'inventory-dashboard-pack-fields-v3',
    outletTopProducts,
    warehouseTopProducts: normalizedWarehouseTopProducts,
    outletProductsRequiringOrder,
    warehouseProductsRequiringOrder,
    newOutletProducts,
    newWarehouseProducts,
    outletOutOfStockProducts,
    warehouseOutOfStockProducts,
  });
});

export const getInventoryDashboardOrders = asyncHandler(async (req, res) => {
  const params = getBaseParams(req);
  const orders = await InventoryDashboard.getOrderSummary(params);
  res.json(orders);
});

export const getInventoryDashboardCustomers = asyncHandler(async (req, res) => {
  const params = getBaseParams(req);
  const customers = await InventoryDashboard.getCustomerSummary(params);
  res.json(customers);
});

export const getInventoryDashboardFinance = asyncHandler(async (req, res) => {
  const params = getBaseParams(req);
  const finance = await InventoryDashboard.getFinanceSummary(params);
  res.json(finance);
});
