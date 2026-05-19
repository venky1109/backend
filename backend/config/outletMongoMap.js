export const OUTLET_MONGO_URLS = {
  GOLLAVELLI_Mini_Mart:
    'mongodb+srv://roopavenky916:vbQn20HuwTygFPoE@cluster0.fwquaxr.mongodb.net/ManaKiranaDevelopment?retryWrites=true&w=majority&appName=Cluster0',
};

export const OUTLET_BY_MONGO_URL = Object.fromEntries(
  Object.entries(OUTLET_MONGO_URLS).map(([outletName, mongoUrl]) => [mongoUrl, outletName])
);

export const getOutletStockNameForMongoUrl = (mongoUrl = process.env.MONGO_URI) =>
  OUTLET_BY_MONGO_URL[mongoUrl] || null;

