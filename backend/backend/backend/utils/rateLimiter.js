import rateLimit from 'express-rate-limit';
const loginLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 5, // Limit each IP to 5 login attempts per windowMs
    message: 'Too many login attempts from this IP, please try again after 15 minutes',
    handler: (req, res) => {
      res.status(429).json({
        message: 'Too many login attempts. Please try again after 15 minutes.',
      });
    },
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  });

export default loginLimiter;