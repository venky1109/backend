import jwt from 'jsonwebtoken';

/**
 * Generate a JWT token specifically for the payment gateway (PGW).
 * 
 * @param {Object} payload - The payload to include in the JWT (e.g., orderId, userId, etc.).
 * @param {Object} options - Additional options for generating the JWT token.
 * @returns {string} The generated JWT token.
 */
const generateTokenJWTPGW = (payload, options = {}) => {
  const token = jwt.sign(payload, process.env.JWT_SECRET_PGW, {
    expiresIn: options.expiresIn || '1h', // Default to 1 hour expiry for payment tokens
    algorithm: 'RS256', // Use RS256 for asymmetric signing if needed
  });

  return token;
};

export default generateTokenJWTPGW;
