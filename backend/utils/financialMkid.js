export const assignFinancialMkIds = async (Product) => {
  const products = await Product.find({
    $or: [
      { 'details.financials.catalogProductBarcodeId': { $exists: true } },
      { 'details.financials.product_barcode_id': { $exists: true } },
    ],
  });
  const updates = [];
  let totalFinancials = 0;

  products.forEach((product) => {
    product.details?.forEach((detail) => {
      detail.financials?.forEach((financial) => {
        totalFinancials += 1;

        const nextMkid = Number(financial.mkid ?? financial.catalogProductBarcodeId ?? financial.product_barcode_id);
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
  const numericMkid = Number(mkid);
  if (!Number.isInteger(numericMkid) || numericMkid < 1) return null;

  const product = await Product.findOne({
    $or: [
      { 'details.financials.mkid': numericMkid },
      { 'details.financials.catalogProductBarcodeId': numericMkid },
      { 'details.financials.product_barcode_id': numericMkid },
    ],
  });

  if (!product) return null;

  for (const detail of product.details || []) {
    const financial = detail.financials?.find(
      (item) =>
        Number(item.mkid) === numericMkid ||
        Number(item.catalogProductBarcodeId) === numericMkid ||
        Number(item.product_barcode_id) === numericMkid
    );

    if (financial) {
      return { product, detail, financial };
    }
  }

  return null;
};
