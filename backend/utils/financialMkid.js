export const assignFinancialMkIds = async (Product) => {
  const products = await Product.find({
    'details.financials.catalogProductBarcodeId': { $exists: true },
  });
  const updates = [];
  let totalFinancials = 0;

  products.forEach((product) => {
    product.details?.forEach((detail) => {
      detail.financials?.forEach((financial) => {
        totalFinancials += 1;

        const nextMkid = Number(financial.catalogProductBarcodeId);
        if (!Number.isFinite(nextMkid) || financial.mkid === nextMkid) return;

        updates.push({
          updateOne: {
            filter: { _id: product._id },
            update: {
              $set: {
                'details.$[detail].financials.$[financial].mkid': nextMkid,
              },
            },
            arrayFilters: [
              { 'detail._id': detail._id },
              { 'financial._id': financial._id },
            ],
          },
        });
      });
    });
  });

  if (updates.length > 0) {
    await Product.bulkWrite(updates);
  }

  return {
    totalFinancials,
    updatedFinancials: updates.length,
  };
};

export const findFinancialByMkid = async (Product, mkid) => {
  const catalogProductBarcodeId = Number(mkid);
  if (!Number.isInteger(catalogProductBarcodeId) || catalogProductBarcodeId < 1) return null;

  const product = await Product.findOne({
    'details.financials.catalogProductBarcodeId': catalogProductBarcodeId,
  });

  if (!product) return null;

  for (const detail of product.details || []) {
    const financial = detail.financials?.find(
      (item) => Number(item.catalogProductBarcodeId) === catalogProductBarcodeId
    );

    if (financial) {
      return { product, detail, financial };
    }
  }

  return null;
};
