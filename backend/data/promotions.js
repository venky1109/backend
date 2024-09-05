const promotions = [
    {
      title: "First Order Discount",
      description: "Get 20% off on your first order over $4,000.",
      startDate: new Date('2024-09-01'),
      endDate: new Date('2024-09-30'),
      discountPercentage: 20,
      promoCode: "FIRST20",
      isActive: true,
      scope: 'order',
      conditions: {
        minTotalBillAmount: 4000,
        orderCount: 1,
      },
    },
    {
      title: "Summer BrandX Promotion",
      description: "15% off on all BrandX products.",
      startDate: new Date('2024-07-01'),
      endDate: new Date('2024-07-31'),
      discountPercentage: 15,
      promoCode: "BRANDX15",
      isActive: true,
      scope: 'product',
      conditions: {
        brand: "BrandX",
      },
    },
    // Add more promotions as needed
  ];
  
  export default promotions; // Make sure to use default export
  