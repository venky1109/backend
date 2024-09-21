import path from 'path';
import express from 'express';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import cors from 'cors';  // Import the CORS package
import connectDB from './config/db.js';
import productRoutes from './routes/productRoutes.js';
import userRoutes from './routes/userRoutes.js';
import orderRoutes from './routes/orderRoutes.js';
import uploadRoutes from './routes/uploadRoutes.js';
import promotionRoutes from './routes/promotionRoutes.js'; // Import promotion routes
import { notFound, errorHandler } from './middleware/errorMiddleware.js';

// Load environment variables
dotenv.config();

// Connect to the database
connectDB();

const app = express();
const allowedOrigins = [
  'https://manakiranaonline.onrender.com',
  'https://manakirana.online',
  'https://etrug.app',
  'http://192.168.1.6:3000',
  'http://localhost:3000',
  'https://manakirana.com',
  'https://www.etrug.app' // Added this origin
];

// Set up the port
const port = process.env.PORT || 5000;
const env = process.env.NODE_ENV || 'development';  // Default to development if NODE_ENV is not set
// app.set('trust proxy', 1);  // Add this line/
// Enable CORS for all routes
app.set('trust proxy', 1); // Trust first proxy

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: 'GET,POST,PUT,DELETE,OPTIONS',
    credentials: true
  })
);

// Middleware to parse JSON and URL-encoded data
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Define routes
app.use('/api/products', productRoutes);
app.use('/api/users', userRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/promotions', promotionRoutes);

// PayPal configuration route
app.get('/api/config/paypal', (req, res) =>
  res.send({ clientId: process.env.PAYPAL_CLIENT_ID })
);

const __dirname = path.resolve(); // Define __dirname for ES6 module

if (env === 'production') {
  // Serve static files from the /frontend/build directory in production mode
  app.use('/uploads', express.static('/var/data/uploads'));  // Ensure this path is correct on your server
  app.use(express.static(path.join(__dirname, '/frontend/build')));

  // All non-API routes should serve the frontend build index.html
  app.get('*', (req, res) =>
    res.sendFile(path.resolve(__dirname, 'frontend', 'build', 'index.html'))
  );
} else {
  // Serve static files from the /uploads directory in development mode
  app.use('/uploads', express.static(path.join(__dirname, '/uploads')));
  app.get('/', (req, res) => {
    res.send('API is running....');
  });
}

// Error handling middleware
app.use(notFound);
app.use(errorHandler);

// Start the server
app.listen(port, () =>
  console.log(`Server running in ${env} mode on port ${port}`)
);
