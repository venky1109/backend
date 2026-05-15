const compareText = (left, right) =>
  String(left || '').localeCompare(String(right || ''), undefined, {
    numeric: true,
    sensitivity: 'base',
  });

const compareNumber = (left, right) => Number(left || 0) - Number(right || 0);

const compareFinancialRows = (left, right) =>
  compareText(left.category, right.category) ||
  compareText(left.productName, right.productName) ||
  compareText(left.brand, right.brand) ||
  compareNumber(left.quantity, right.quantity) ||
  compareText(left.units, right.units) ||
  compareNumber(left.dprice, right.dprice) ||
  compareNumber(left.price, right.price) ||
  compareText(left.financialId, right.financialId);

export const assignFinancialMkIds = async (Product) => {
  const products = await Product.find({});
  const rows = [];

  products.forEach((product) => {
    product.details?.forEach((detail) => {
      detail.financials?.forEach((financial) => {
        rows.push({
          product,
          detail,
          financial,
          category: product.category,
          productName: product.name,
          brand: detail.brand,
          quantity: financial.quantity,
          units: financial.units,
          dprice: financial.dprice,
          price: financial.price,
          financialId: financial._id?.toString(),
        });
      });
    });
  });

  rows.sort(compareFinancialRows);

  const updates = [];
  rows.forEach((row, index) => {
    const nextMkid = index + 1;
    if (row.financial.mkid !== nextMkid) {
      row.financial.mkid = nextMkid;
      updates.push({
        updateOne: {
          filter: { _id: row.product._id },
          update: {
            $set: {
              'details.$[detail].financials.$[financial].mkid': nextMkid,
            },
          },
          arrayFilters: [
            { 'detail._id': row.detail._id },
            { 'financial._id': row.financial._id },
          ],
        },
      });
    }
  });

  if (updates.length > 0) {
    await Product.bulkWrite(updates);
  }

  return {
    totalFinancials: rows.length,
    updatedFinancials: updates.length,
  };
};

export const findFinancialByMkid = async (Product, mkid) => {
  const numericMkid = Number(mkid);
  if (!Number.isInteger(numericMkid) || numericMkid < 1) return null;

  await assignFinancialMkIds(Product);

  const product = await Product.findOne({
    'details.financials.mkid': numericMkid,
  });

  if (!product) return null;

  for (const detail of product.details || []) {
    const financial = detail.financials?.find((item) => item.mkid === numericMkid);
    if (financial) {
      return { product, detail, financial };
    }
  }

  return null;
};
