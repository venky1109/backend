const products = [
  {
    "name": "Salt",
    "category": "Condiments",
    "rating": "5",
    "numReviews": "100",
    "details": [
      {
      "brand": "tata",
      "description": "Common salt used for seasoning and cooking.",
        "images": [
          { "image": "/images/pepper.jpg" },
          { "image": "/images/pepper.jpg" },
          { "image": "/images/10000067_23-fresho-capsicum-green.jpg"}
        ],
     
        "financials": [
          {
            "price": "100.00",
            "dprice": "75.00",
            "Discount": "0",
            "quantity": "0.5",
            "countInStock": "100",
          },
          {
            "price": "200.00",
            "dprice": "140.00",
            "Discount": "30",
            "quantity": "1",
            "countInStock": "100",
            "rating": "4.5",
            "numReviews": "100"
          },
          {
            "price": "400.00",
            "dprice": "310.00",
            "Discount": "90",
            "quantity": "1.5",
            "countInStock": "100"
          }
        ]
      },
      {
      "brand": "Aashervaad",
      "description": "Common salt used for seasoning and cooking.",
      "rating": "5",
      "numReviews": "100",
        "images": [
          { "image": "/images/1kg-tata-salt-packet.jpg" },
          { "image": "/images/1kg-tata-salt-packet.jpg" }
        ],
        "financials": [
          {
            "price": "100.00",
            "dprice": "20.00",
            "Discount": "80",
            "quantity": "250",
            "countInStock": "100"
          }
        ]
      },
      {
      "brand": "ManaKirana",
      "description": "Common salt used for seasoning and cooking.",
      "rating": "5",
      "numReviews": "100",
      "images": [
          { "image": "/images/pepper.jpg" },
          { "image": "/images/1kg-tata-salt-packet.jpg" }
        ],
        "financials": [
          {
            "price": "100.00",
            "dprice": "75.00",
            "Discount": "25",
            "quantity": "0.5",
            "countInStock": "100"
          }
        ]
      }
    ]

  },
  // ... details for other products
  {
    "name": "Sample Product",
    "category": "Test Category",
    "details": [
      {
        "brand": "TestBrand1",
        "description": "Test description 1",
        "images": [
          { "image": "/images/pepper.jpg" }
        ],
        "financials": [
          {
            "price": 50.00,
            "dprice": 40.00,
            "Discount": 20,
            "quantity": 0.5,
            "countInStock": 100
          },
          {
            "price": 100.00,
            "dprice": 80.00,
            "Discount": 20,
            "quantity": 1,
            "countInStock": 50
          },
          {
            "price": 150.00,
            "dprice": 120.00,
            "Discount": 20,
            "quantity": 1.5,
            "countInStock": 25
          }
        ]
      },
      {
        "brand": "TestBrand2",
        "description": "Test description 2",
        "images": [
          { "image": "/images/pepper.jpg" }
        ],
        "financials": [
          {
            "price": 75.00,
            "dprice": 60.00,
            "Discount": 20,
            "quantity": 0.5,
            "countInStock": 75
          },
          {
            "price": 150.00,
            "dprice": 120.00,
            "Discount": 20,
            "quantity": 1,
            "countInStock": 40
          },
          {
            "price": 225.00,
            "dprice": 180.00,
            "Discount": 20,
            "quantity": 1.5,
            "countInStock": 20
          }
        ]
      }
    ]
  }
  
  ];
  
 

export default products;