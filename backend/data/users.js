import bcrypt from 'bcryptjs';
const users = [
    {
      name: 'Admin User',
      email: 'admin@email.com',
      password: bcrypt.hashSync('123456', 10),
      isAdmin: true,
      phoneNo: '1234567890',
      deliveryAddress: {
        street: '123 Admin St',
        city: 'Admin City',
        postalCode: '10001',
      },
      location: {
        latitude: 40.7128,
        longitude: -74.0060,
      },
    },

  ];
  
  export default users;