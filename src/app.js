const express = require('express');
const cors = require('cors');
const config = require('./config');

// Import controllers
const blockController = require('./controllers/blockController');
const assetController = require('./controllers/assetController');
const exchangeController = require('./controllers/exchangeController');
const pairController = require('./controllers/pairController');
const eventsController = require('./controllers/eventsController');
const healthController = require('./controllers/healthController');

// Create Express app
const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Basic error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    code: '500',
    message: 'Server was not able to return a response. Try later'
  });
});

// Rate limiting middleware (simple implementation)
const requestCounts = {};
const RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const RATE_LIMIT = 100; // requests per minute

app.use((req, res, next) => {
  const ip = req.ip;
  const now = Date.now();
  
  // Initialize or clean up old timestamps
  requestCounts[ip] = requestCounts[ip] || [];
  requestCounts[ip] = requestCounts[ip].filter(timestamp => timestamp > now - RATE_LIMIT_WINDOW);
  
  // Check if rate limit exceeded
  if (requestCounts[ip].length >= RATE_LIMIT) {
    return res.status(429).json({
      code: '429',
      message: 'Rate limit occured handling request'
    });
  }
  
  // Add current request
  requestCounts[ip].push(now);
  next();
});

// DEXTools HTTP Adapter Required Endpoints (as per specification)
app.get('/latest-block', blockController.getLatestBlock);
app.get('/block', blockController.getBlock);
app.get('/asset', assetController.getAsset);
app.get('/asset/holders', assetController.getAssetHolders);
app.get('/exchange', exchangeController.getExchange);
app.get('/pair', pairController.getPair);
app.get('/events', eventsController.getEvents);

// Optional health check routes (not required by DEXTools spec)
app.get('/health', healthController.getHealth);
app.get('/health/rpc', healthController.getMainRpcHealth);
app.get('/health/api', healthController.getTransfersApiHealth);

// Default route (404)
app.use((req, res) => {
  res.status(404).json({
    code: '404',
    message: 'Endpoint not found'
  });
});

module.exports = app; 