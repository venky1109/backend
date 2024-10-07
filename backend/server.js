import path from 'path';
import express from 'express';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import cors from 'cors';
// import helmet from 'helmet';  
import connectDB from './config/db.js';
import productRoutes from './routes/productRoutes.js';
import userRoutes from './routes/userRoutes.js';
import orderRoutes from './routes/orderRoutes.js';
import uploadRoutes from './routes/uploadRoutes.js';
import promotionRoutes from './routes/promotionRoutes.js';
import { notFound, errorHandler } from './middleware/errorMiddleware.js';
import { Server } from 'socket.io';
import { createServer } from 'http';
import Product from './models/productModel.js';

dotenv.config();

connectDB();

const app = express();
const server = createServer(app); 

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

const port = process.env.PORT || 5000;
const env = process.env.NODE_ENV || 'development'; 
app.set('trust proxy', 1); 

// // Enable Helmet middleware to set security-related headers
// app.use(helmet());  
// app.use(helmet.frameguard({ action: 'SAMEORIGIN' }));



// CORS configuration
const allowedOrigins = [
  'https://manakiranaonline.onrender.com',
  'https://manakirana.online',
  'https://etrug.app',
  'http://192.168.1.6:3000',
  'http://localhost:3000',
  'https://manakirana.com',
  'https://www.etrug.app',
];


app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');

  // Content Security Policy to control sources for content
  res.setHeader(
    'Content-Security-Policy',
    "frame-ancestors 'self' https://manakirana.com https://manakirana.online https://etrug.app;"
  );

  // Enforce HTTPS with HSTS
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');

  // Prevent MIME sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Set Referrer Policy
  res.setHeader('Referrer-Policy', 'no-referrer-when-downgrade');

  next();
});




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

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

app.use('/api/products', productRoutes);
app.use('/api/users', userRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/promotions', promotionRoutes);

app.get('/api/config/paypal', (req, res) =>
  res.send({ clientId: process.env.PAYPAL_CLIENT_ID })
);

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

app.use(notFound);
app.use(errorHandler);

const clients = {};  

// WebSocket handling
io.on('connection', (socket) => {
  console.log(`Client connected: ${socket.id}`);

  let productChangeStream;  

  socket.on('clientCart', async (cartItems) => {
    clients[socket.id] = cartItems;  

    const updatesToSend = [];

    for (const cartItem of cartItems) {
      const product = await Product.findById(cartItem.productId);
      if (product) {
        const matchingDetail = product.details.find(
          (detail) => detail._id.toString() === cartItem.brandId
        );

        if (matchingDetail) {
          const matchingFinancial = matchingDetail.financials.find(
            (financial) => financial._id.toString() === cartItem.financialId
          );

          if (matchingFinancial) {
            if (
              matchingFinancial.price !== cartItem.price ||
              matchingFinancial.dprice !== cartItem.dprice ||
              matchingFinancial.countInStock !== cartItem.countInStock
            ) {
              updatesToSend.push(product);
            }
          }
        }
      }
    }

    if (updatesToSend.length > 0) {
      updatesToSend.forEach((updatedProduct) => {
        socket.emit('productUpdate', updatedProduct);
      });
    }

    if (!productChangeStream) {
      productChangeStream = Product.watch();

      productChangeStream.on('change', async (change) => {
        if (change.operationType === 'update') {
          const updatedProductId = change.documentKey._id;

          try {
            const updatedProduct = await Product.findById(updatedProductId);

            if (updatedProduct) {
              io.emit('productUpdate', updatedProduct);
            }
          } catch (error) {
            console.error('Error fetching updated product:', error.message);
          }
        }
      });
    }
  });

  socket.on('disconnect', () => {
    console.log(`Client disconnected: ${socket.id}`);
    delete clients[socket.id];

    if (productChangeStream) {
      productChangeStream.close();
      productChangeStream = null;
    }
  });
});

server.listen(port, () =>
  console.log(`Server running in ${env} mode on port ${port}`)
);
