const express = require('express');
const cors = require('cors');
const importRoutes = require('./api/routes/import');

require('dotenv').config();

const db = require('./database/connection');

// Import routes
const authRoutes = require('./api/routes/auth'); // NEW - Authentication routes
const requirementsRoutes = require('./api/routes/requirements');
const testCasesRoutes = require('./api/routes/testCases');
const testSuitesRoutes = require('./api/routes/testSuites');
const versionsRoutes = require('./api/routes/versions');
const mappingsRoutes = require('./api/routes/mappings');
const workspacesRoutes = require('./api/routes/workspaces'); // Workspace routes

const app = express();
const PORT = process.env.API_PORT || 3002; // Different port from webhook server
const HOST = process.env.HOST || '0.0.0.0';

// CORS configuration - MORE PERMISSIVE (KEPT YOUR ORIGINAL)
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl)
    if (!origin) return callback(null, true);
    
    const allowedOrigins = [
      'http://213.6.2.229',
      'https://213.6.2.229',
      'http://localhost:5173',
      'http://localhost:3000',
      'http://127.0.0.1:5173',
      'http://127.0.0.1:3000',
      process.env.FRONTEND_URL,
      process.env.FRONTEND_URL_ALT,
      process.env.INTERNAL_IP
    ].filter(Boolean);
    
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.log('⚠️ CORS blocked origin:', origin);
      callback(null, true); // Allow anyway for debugging
    }
  },
  credentials: true,
  optionsSuccessStatus: 200,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

// Middleware
app.use(cors(corsOptions));
app.use(express.json({ limit: process.env.MAX_PAYLOAD_SIZE || '10mb' }));
app.use(express.urlencoded({ extended: true, limit: process.env.MAX_PAYLOAD_SIZE || '10mb' }));

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (process.env.LOG_LEVEL === 'debug') {
      console.log(`${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
    }
  });
  next();
});

// Health check endpoint
app.get('/api/health', async (req, res) => {
  try {
    const dbHealthy = await db.healthCheck();
    const poolStats = db.getPoolStats();

    res.json({
      success: true,
      status: 'healthy',
      timestamp: new Date().toISOString(),
      database: {
        connected: dbHealthy,
        pool: poolStats
      },
      uptime: process.uptime(),
      environment: process.env.NODE_ENV
    });
  } catch (error) {
    res.status(503).json({
      success: false,
      status: 'unhealthy',
      error: error.message
    });
  }
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/requirements', requirementsRoutes);
app.use('/api/test-cases', testCasesRoutes);
app.use('/api/test-suites', testSuitesRoutes);
app.use('/api/versions', versionsRoutes);
app.use('/api/mappings', mappingsRoutes);
app.use('/api/import', importRoutes);
app.use('/api/workspaces', workspacesRoutes);

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    message: 'Quality Tracker API Server',
    version: '1.0.0',
    endpoints: {
      auth: '/api/auth',
      health: '/api/health',
      requirements: '/api/requirements',
      testCases: '/api/test-cases',
      testSuites: '/api/test-suites',
      versions: '/api/versions',
      mappings: '/api/mappings',
      import: '/api/import',
      workspaces: '/api/workspaces'
    }
  });
});

// 404 handler
app.use('/api/*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'API endpoint not found',
    path: req.path,
    method: req.method
  });
});

// Error handler
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message
  });
});

// Start server
const server = app.listen(PORT, HOST, async () => {
  console.log(`🚀 Quality Tracker API Server running on ${HOST}:${PORT}`);
  console.log(`🌐 Environment: ${process.env.NODE_ENV}`);
  console.log(`🔗 Health check: http://${HOST}:${PORT}/api/health`);
  
  // Test database connection
  try {
    const isHealthy = await db.healthCheck();
    if (isHealthy) {
      console.log('✅ Database connection established');
    } else {
      console.warn('⚠️ Database connection failed');
    }
  } catch (error) {
    console.error('❌ Database connection error:', error.message);
  }
});

// Graceful shutdown
const gracefulShutdown = async (signal) => {
  console.log(`\n${signal} received, shutting down gracefully...`);
  
  server.close(async () => {
    console.log('✅ HTTP server closed');
    
    try {
      await db.close();
      console.log('✅ Database connections closed');
    } catch (error) {
      console.error('❌ Error closing database:', error.message);
    }
    
    process.exit(0);
  });

  // Force shutdown after 10 seconds
  setTimeout(() => {
    console.error('⚠️ Forcing shutdown after timeout');
    process.exit(1);
  }, 10000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

module.exports = { app, server };