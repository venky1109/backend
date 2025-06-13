// import jwt from 'jsonwebtoken';

// const generateTokenPOS = (userId) => {
// //   console.log('🧾 Signing POS token with:', process.env.JWT_SECRET_POS); // Add this log
//   return jwt.sign({ id: userId, type: 'pos' }, process.env.JWT_SECRET_POS, {
//     expiresIn: '30d',
//   });
// };

// export default generateTokenPOS;


import jwt from 'jsonwebtoken';

const generateTokenPOS = (user) => {
  return jwt.sign(
    {
      id: user._id,
      role: user.role,       // ✅ Include role
      username: user.username,
      type: 'pos',
    },
    process.env.JWT_SECRET_POS,
    { expiresIn: '30d' }
  );
};

export default generateTokenPOS;
