// webhook-server.js - Enhanced version with .env support
require('dotenv').config(); // Load environment variables from .env file

const express = require('express');
const cors = require('cors');
const { createServer } = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');

const app = express();
const server = createServer(app);

// Enhanced CORS configuration with multiple origins support
const allowedOrigins = [
  "http://localhost:3000",      // Create React App default
  "http://localhost:5173",      // Vite default
  "http://127.0.0.1:3000",      // Alternative localhost format
  "http://127.0.0.1:5173",      // Alternative localhost format
  process.env.FRONTEND_URL,     // Environment variable
  process.env.FRONTEND_URL_ALT  // Alternative frontend URL
].filter(Boolean); // Remove undefined values

console.log('🌐 Allowed CORS origins:', allowedOrigins);

const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization"]
  }
});

// In-memory storage (use Redis/Database in production)
const webhookResults = new Map();
const processedWebhooks = new Set();

// Middleware with enhanced CORS
app.use(express.json({ limit: process.env.MAX_PAYLOAD_SIZE || '10mb' }));
app.use(cors({
  origin: allowedOrigins,
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization"]
}));

// Serve static files for Quality Tracker frontend
app.use(express.static('dist'));

// Enhanced logging based on environment
const isProduction = process.env.NODE_ENV === 'production';
const logLevel = process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug');

function log(level, message, data = null) {
  const levels = { error: 0, warn: 1, info: 2, debug: 3 };
  const currentLevel = levels[logLevel] || 3;
  
  if (levels[level] <= currentLevel) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${level.toUpperCase()}: ${message}`;
    
    if (level === 'error') {
      console.error(logMessage, data || '');
    } else if (level === 'warn') {
      console.warn(logMessage, data || '');
    } else {
      console.log(logMessage, data || '');
    }
  }
}

// ===== HELPER FUNCTIONS =====

function validateWebhookPayload(payload) {
  const errors = [];
  
  if (!payload) {
    errors.push('Payload is required');
    return { valid: false, errors };
  }
  
  if (!payload.requirementId) {
    errors.push('requirementId is required');
  }
  
  if (!payload.timestamp) {
    errors.push('timestamp is required');
  }
  
  if (!payload.results || !Array.isArray(payload.results)) {
    errors.push('results must be an array');
  } else {
    payload.results.forEach((result, index) => {
      if (!result.id) {
        errors.push(`results[${index}].id is required`);
      }
      if (!result.status) {
        errors.push(`results[${index}].status is required`);
      }
      if (!['Passed', 'Failed', 'Not Run', 'Blocked'].includes(result.status)) {
        errors.push(`results[${index}].status must be one of: Passed, Failed, Not Run, Blocked`);
      }
    });
  }
  
  return {
    valid: errors.length === 0,
    errors
  };
}

// Enhanced webhook processing with better error handling
async function processWebhookData(webhookData) {
  log('info', '🔔 Processing webhook data', { requirementId: webhookData.requirementId });
  
  // Validate webhook payload
  const validation = validateWebhookPayload(webhookData);
  if (!validation.valid) {
    log('error', '❌ Invalid webhook payload', validation.errors);
    throw new Error(`Invalid webhook payload: ${validation.errors.join(', ')}`);
  }
  
  // Check for duplicates
  const webhookId = `${webhookData.requirementId}-${webhookData.requestId || webhookData.timestamp}`;
  if (processedWebhooks.has(webhookId)) {
    log('warn', '⚠️ Duplicate webhook detected', { webhookId });
    return {
      message: 'Webhook already processed',
      webhookId,
      duplicate: true
    };
  }
  
  // Store webhook result with TTL if configured
  const resultKey = webhookData.requirementId;
  const resultData = {
    ...webhookData,
    receivedAt: new Date().toISOString(),
    webhookId,
    ttl: process.env.RESULT_TTL ? Date.now() + parseInt(process.env.RESULT_TTL) : null
  };
  
  webhookResults.set(resultKey, resultData);
  
  // Mark as processed
  processedWebhooks.add(webhookId);
  
  // Clean up old processed webhooks to prevent memory leak
  if (processedWebhooks.size > (parseInt(process.env.MAX_PROCESSED_WEBHOOKS) || 1000)) {
    const webhooksArray = Array.from(processedWebhooks);
    const toRemove = webhooksArray.slice(0, webhooksArray.length - 500);
    toRemove.forEach(id => processedWebhooks.delete(id));
    log('debug', '🧹 Cleaned up old processed webhooks', { removed: toRemove.length });
  }
  
  // Broadcast to connected Quality Tracker clients via WebSocket
  log('debug', `📡 Broadcasting to clients for requirement: ${resultKey}`);
  
  const broadcastData = {
    requirementId: webhookData.requirementId,
    data: webhookData,
    timestamp: new Date().toISOString()
  };
  
  // Emit to all clients
  io.emit('webhook-received', broadcastData);
  
  // Emit to specific requirement room
  io.to(`requirement-${resultKey}`).emit('test-results', webhookData);
  
  log('info', '✅ Webhook processed successfully', { 
    requirementId: webhookData.requirementId,
    resultCount: webhookData.results?.length || 0
  });
  
  return {
    message: 'Webhook received and processed',
    requirementId: webhookData.requirementId,
    resultCount: webhookData.results?.length || 0,
    webhookId
  };
}

// Cleanup expired results
function cleanupExpiredResults() {
  const now = Date.now();
  let cleanedCount = 0;
  
  for (const [key, value] of webhookResults.entries()) {
    if (value.ttl && value.ttl < now) {
      webhookResults.delete(key);
      cleanedCount++;
    }
  }
  
  if (cleanedCount > 0) {
    log('debug', '🧹 Cleaned up expired results', { count: cleanedCount });
  }
}

// Run cleanup every hour if TTL is configured
if (process.env.RESULT_TTL) {
  setInterval(cleanupExpiredResults, parseInt(process.env.CLEANUP_INTERVAL) || 3600000);
}

// ===== WEBHOOK ENDPOINTS (GitHub Actions calls these) =====

/**
 * Main webhook endpoint - GitHub Actions sends results here
 */
app.post('/api/webhook/test-results', async (req, res) => {
  try {
    const result = await processWebhookData(req.body);
    
    if (result.duplicate) {
      return res.status(200).json(result);
    }
    
    res.status(200).json(result);
    
  } catch (error) {
    log('error', '❌ Error processing webhook', error.message);
    
    res.status(500).json({
      error: 'Internal server error',
      message: isProduction ? 'Internal server error' : error.message
    });
  }
});

/**
 * Enhanced webhook health check
 */
app.get('/api/webhook/health', (req, res) => {
  cleanupExpiredResults(); // Run cleanup on health check
  
  const healthData = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    storedResults: webhookResults.size,
    processedWebhooks: processedWebhooks.size,
    environment: process.env.NODE_ENV || 'development',
    version: process.env.npm_package_version || '1.0.0',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    cors: {
      allowedOrigins: allowedOrigins
    }
  };
  
  res.status(200).json(healthData);
});

// ===== API ENDPOINTS (Quality Tracker calls these) =====

/**
 * Get latest test results for a requirement
 */
app.get('/api/test-results/:requirementId', (req, res) => {
  const { requirementId } = req.params;
  
  log('debug', `📋 Frontend requesting results for: ${requirementId}`);
  
  const result = webhookResults.get(requirementId);
  
  if (!result) {
    return res.status(404).json({
      error: 'No results found',
      requirementId
    });
  }
  
  // Check if result has expired
  if (result.ttl && result.ttl < Date.now()) {
    webhookResults.delete(requirementId);
    return res.status(404).json({
      error: 'Results have expired',
      requirementId
    });
  }
  
  res.status(200).json({
    requirementId,
    ...result,
    retrievedAt: new Date().toISOString()
  });
});

/**
 * Get all stored webhook results (for debugging)
 */
app.get('/api/test-results', (req, res) => {
  if (isProduction && !req.query.debug) {
    return res.status(403).json({
      error: 'Debug endpoint not available in production'
    });
  }
  
  cleanupExpiredResults();
  
  const allResults = {};
  
  for (const [key, value] of webhookResults.entries()) {
    allResults[key] = value;
  }
  
  res.status(200).json({
    results: allResults,
    count: webhookResults.size,
    retrievedAt: new Date().toISOString()
  });
});

/**
 * Clear results for a requirement (useful for testing)
 */
app.delete('/api/test-results/:requirementId', (req, res) => {
  const { requirementId } = req.params;
  
  const existed = webhookResults.has(requirementId);
  webhookResults.delete(requirementId);
  
  log('info', existed ? '🗑️ Results cleared' : '🗑️ No results to clear', { requirementId });
  
  res.status(200).json({
    message: existed ? 'Results cleared' : 'No results to clear',
    requirementId
  });
});

/**
 * Enhanced manual webhook trigger (for testing)
 */
app.post('/api/test-webhook', async (req, res) => {
  try {
    log('info', '🧪 Manual webhook trigger for testing');
    
    // Simulate webhook data with more realistic test scenarios
    const testWebhook = {
      requirementId: req.body.requirementId || 'REQ-TEST',
      timestamp: new Date().toISOString(),
      requestId: `manual-${Date.now()}`,
      source: 'manual-trigger',
      results: req.body.results || [
        {
          id: 'TC_001',
          name: 'Test Manual Webhook Delivery',
          status: 'Passed',
          duration: Math.floor(Math.random() * 2000) + 500,
          logs: 'Manual test webhook execution completed successfully'
        },
        {
          id: 'TC_002', 
          name: 'Test Webhook Processing',
          status: Math.random() > 0.3 ? 'Passed' : 'Failed',
          duration: Math.floor(Math.random() * 1500) + 300,
          logs: 'Webhook processing test completed'
        }
      ]
    };
    
    const result = await processWebhookData(testWebhook);
    
    res.status(200).json({
      ...result,
      testTrigger: true,
      message: 'Test webhook processed successfully'
    });
    
  } catch (error) {
    log('error', '❌ Error processing test webhook', error.message);
    
    res.status(500).json({
      error: 'Test webhook failed',
      message: isProduction ? 'Test webhook failed' : error.message
    });
  }
});

// ===== WEBSOCKET HANDLING =====

io.on('connection', (socket) => {
  log('info', `🔌 Quality Tracker connected: ${socket.id}`);
  
  // Enhanced connection info
  socket.emit('connection-info', {
    socketId: socket.id,
    timestamp: new Date().toISOString(),
    serverVersion: process.env.npm_package_version || '1.0.0'
  });
  
  // Join requirement-specific rooms for targeted updates
  socket.on('subscribe-requirement', (requirementId) => {
    socket.join(`requirement-${requirementId}`);
    log('debug', `📝 Client ${socket.id} subscribed to ${requirementId}`);
    
    // Send any existing results for this requirement
    const existingResult = webhookResults.get(requirementId);
    if (existingResult && (!existingResult.ttl || existingResult.ttl > Date.now())) {
      socket.emit('test-results', existingResult);
      log('debug', `📤 Sent existing results to ${socket.id} for ${requirementId}`);
    }
  });
  
  socket.on('unsubscribe-requirement', (requirementId) => {
    socket.leave(`requirement-${requirementId}`);
    log('debug', `📝 Client ${socket.id} unsubscribed from ${requirementId}`);
  });
  
  socket.on('ping', (callback) => {
    callback('pong');
  });
  
  socket.on('disconnect', (reason) => {
    log('info', `🔌 Quality Tracker disconnected: ${socket.id}`, { reason });
  });
});

// ===== STARTUP =====

const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || 'localhost';

server.listen(PORT, HOST, () => {
  log('info', `🚀 Quality Tracker Webhook Server running on ${HOST}:${PORT}`);
  log('info', `📡 WebSocket server ready for real-time updates`);
  log('info', `🔗 Webhook endpoint: http://${HOST}:${PORT}/api/webhook/test-results`);
  log('info', `🌐 Health check: http://${HOST}:${PORT}/api/webhook/health`);
  log('info', `📊 Results API: http://${HOST}:${PORT}/api/test-results`);
  log('info', `🌐 CORS origins: ${allowedOrigins.join(', ')}`);
  
  if (!isProduction) {
    log('info', `🧪 Test webhook: curl -X POST http://${HOST}:${PORT}/api/test-webhook -H "Content-Type: application/json" -d '{"requirementId":"REQ-001"}'`);
  }
});

// Enhanced graceful shutdown
process.on('SIGINT', () => {
  log('info', '\n🛑 Shutting down webhook server...');
  
  // Close all socket connections
  io.close(() => {
    log('info', '📡 WebSocket server closed');
  });
  
  server.close(() => {
    log('info', '✅ HTTP server closed');
    process.exit(0);
  });
});

process.on('SIGTERM', () => {
  log('info', '🛑 SIGTERM received, shutting down gracefully');
  process.exit(0);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  log('error', '💥 Uncaught exception', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  log('error', '💥 Unhandled rejection at Promise', { reason, promise });
});

module.exports = { app, server, io };