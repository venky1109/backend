import path from 'path';
import express from 'express';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';  // Import Helmet for security headers
import connectDB from './config/db.js';
import productRoutes from './routes/productRoutes.js';
import userRoutes from './routes/userRoutes.js';
import orderRoutes from './routes/orderRoutes.js';
import uploadRoutes from './routes/uploadRoutes.js';
import promotionRoutes from './routes/promotionRoutes.js';
import { notFound, errorHandler } from './middleware/errorMiddleware.js';
import { Server } from 'socket.io';
import { createServer } from 'http';
import Product from './models/productModel.js';  // Import product model

// Load environment variables
dotenv.config();

// Connect to the database (reused across WebSocket connections)
connectDB();

const app = express();
const server = createServer(app); // Create HTTP server for both Express and Socket.IO
const io = new Server(server, {
  cors: {
    origin: [
      'https://manakiranaonline.onrender.com',
      'https://manakirana.online',
      'https://etrug.app',
      'http://192.168.1.6:3000',
      'http://localhost:3000',
      'https://manakirana.com',
      'https://www.etrug.app',
    ],
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    credentials: true,
  },
});

// Set up the port
const port = process.env.PORT || 5000;
const env = process.env.NODE_ENV || 'development'; // Default to development if NODE_ENV is not set
app.set('trust proxy', 1); // Trust first proxy

// Enable Helmet middleware to set security-related headers
app.use(helmet());  
app.use(helmet.frameguard({ action: 'SAMEORIGIN' }));

// Enable CORS for all routes
const allowedOrigins = [
  'https://manakiranaonline.onrender.com',
  'https://manakirana.online',
  'https://etrug.app',
  'http://192.168.1.6:3000',
  'http://localhost:3000',
  'https://manakirana.com',
  'https://www.etrug.app',
];

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
    credentials: true,
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

// Define __dirname for ES6 modules
const __dirname = path.resolve();

if (env === 'production') {
  app.use('/uploads', express.static('/var/data/uploads')); 
  app.use(express.static(path.join(__dirname, '/frontend/build')));
  app.get('*', (req, res) =>
    res.sendFile(path.resolve(__dirname, 'frontend', 'build', 'index.html'))
  );
} else {
  app.use('/uploads', express.static(path.join(__dirname, '/uploads')));
  app.get('/', (req, res) => {
    res.send('API is running....');
  });
}

// Error handling middleware
app.use(notFound);
app.use(errorHandler);

const clients = {};  // Object to store cart items for connected clients

// MongoDB Change Streams to monitor product updates
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  // Handle product updates in the MongoDB collection
  let productChangeStream;  // Define outside to close later

  // Listen for the client sending their cart items
  socket.on('clientCart', async (cartItems) => {
    clients[socket.id] = cartItems;  // Store client's cart items on the server

    const updatesToSend = [];

    // Check each product in the client's cart for updates
    for (const cartItem of cartItems) {
      const product = await Product.findById(cartItem.productId);  // Fetch product from DB
      if (product) {
        const matchingDetail = product.details.find(
          (detail) => detail._id.toString() === cartItem.brandId
        );

        if (matchingDetail) {
          const matchingFinancial = matchingDetail.financials.find(
            (financial) => financial._id.toString() === cartItem.financialId
          );

          if (matchingFinancial) {
            // Check if there are any updates (e.g., price, dprice, countInStock)
            if (
              matchingFinancial.price !== cartItem.price ||
              matchingFinancial.dprice !== cartItem.dprice ||
              matchingFinancial.countInStock !== cartItem.countInStock
            ) {
              updatesToSend.push(product);  // If product has changed, add to updates array
            }
          }
        }
      }
    }

    // If there are updates to send, emit them to the client
    if (updatesToSend.length > 0) {
      updatesToSend.forEach((updatedProduct) => {
        socket.emit('productUpdate', updatedProduct);  // Send missed updates
      });
    }

    // Initialize the change stream only once, when cart is sent
    if (!productChangeStream) {
      productChangeStream = Product.watch();

      productChangeStream.on('change', async (change) => {
        if (change.operationType === 'update') {
          const updatedProductId = change.documentKey._id;

          try {
            const updatedProduct = await Product.findById(updatedProductId);

            if (updatedProduct) {
              io.emit('productUpdate', updatedProduct); // Emit to all connected clients
            }
          } catch (error) {
            console.error('Error fetching updated product:', error.message);
          }
        }
      });
    }
  });

  // Handle client disconnection and cleanup
  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
    delete clients[socket.id];  // Remove client cart from tracking when they disconnect

    // Clean up change stream
    if (productChangeStream) {
      productChangeStream.close();
      productChangeStream = null;
    }
  });
});

// Start the server using the "server.listen()" method
server.listen(port, () =>
  console.log(`Server running in ${env} mode on port ${port}`)
);
