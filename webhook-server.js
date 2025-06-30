// webhook-server.js - Fixed version with proper request isolation
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { createServer } = require('http');
const { Server } = require('socket.io');

const app = express();
const server = createServer(app);

// Environment detection
const isProduction = process.env.NODE_ENV === 'production';
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '127.0.0.1';

// Enhanced CORS configuration for production
const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:5173",
  "http://127.0.0.1:3000",
  "http://127.0.0.1:5173",
  "http://213.6.2.229",
  "https://213.6.2.229",
  process.env.FRONTEND_URL,
  process.env.FRONTEND_URL_ALT
].filter(Boolean);

// Socket.IO configuration
const io = new Server(server, {
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST", "PUT", "DELETE"],
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization"]
  },
  transports: ['websocket', 'polling'],
  allowEIO3: true,
  pingTimeout: 60000,
  pingInterval: 25000,
});

// FIXED: Use requestId-based storage instead of just requirementId
const webhookResults = new Map(); // Key: requestId, Value: webhook data
const processedWebhooks = new Set(); // Track processed webhook IDs
const activeRequests = new Map(); // Key: requirementId, Value: Set of active requestIds

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(cors({
  origin: allowedOrigins,
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
}));

// Logging
function log(level, message, data = null) {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] ${level.toUpperCase()}: ${message}`, data || '');
}

// FIXED: Enhanced validation to check for requestId
function validateWebhookPayload(payload) {
  const errors = [];
  
  if (!payload) {
    errors.push('Payload is required');
    return { valid: false, errors };
  }
  
  if (!payload.requirementId) {
    errors.push('requirementId is required');
  }
  
  if (!payload.requestId) {
    errors.push('requestId is required for proper request isolation');
  }
  
  if (!payload.timestamp) {
    errors.push('timestamp is required');
  }
  
  if (!payload.results || !Array.isArray(payload.results)) {
    errors.push('results must be an array');
  }
  
  return { valid: errors.length === 0, errors };
}

// FIXED: Process webhook with proper request isolation
async function processWebhookData(webhookData) {
  log('info', '🔔 Processing webhook data', { 
    requirementId: webhookData.requirementId,
    requestId: webhookData.requestId,
    resultCount: webhookData.results?.length || 0 
  });

  console.log('🔍 WEBHOOK RESULTS:', JSON.stringify(webhookData.results?.map(r => ({id: r.id, status: r.status})) || [], null, 2));
  
  // Validate webhook payload
  const validation = validateWebhookPayload(webhookData);
  if (!validation.valid) {
    log('error', '❌ Invalid webhook payload', validation.errors);
    throw new Error(`Invalid webhook payload: ${validation.errors.join(', ')}`);
  }
  
  // SIMPLE FIX: Skip duplicate detection for incremental updates
  const webhookId = webhookData.requestId;
  const hasRunningTests = webhookData.results?.some(r => r.status === 'Running' || r.status === 'Passed' || r.status === 'Failed');

  if (processedWebhooks.has(webhookId) && !hasRunningTests) {
    log('warn', '⚠️ Duplicate webhook detected', { webhookId });
    return {
      message: 'Webhook already processed',
      webhookId,
      duplicate: true
    };
  }

  // Allow incremental updates - don't add to processed set until all tests complete
  const allTestsComplete = webhookData.results?.every(r => r.status === 'Passed' || r.status === 'Failed');
  if (allTestsComplete) {
    processedWebhooks.add(webhookId);
  }
  
  // FIXED: Store by requestId, not requirementId
  const resultData = {
    ...webhookData,
    receivedAt: new Date().toISOString(),
    webhookId,
    ttl: Date.now() + (parseInt(process.env.RESULT_TTL) || 3600000) // 1 hour default
  };
  
  webhookResults.set(webhookId, resultData);
  
  // FIXED: Track active requests per requirement
  if (!activeRequests.has(webhookData.requirementId)) {
    activeRequests.set(webhookData.requirementId, new Set());
  }
  activeRequests.get(webhookData.requirementId).add(webhookId);
  
  // Broadcast to connected clients - FIXED: Include requestId in broadcast
  log('debug', `📡 Broadcasting to ${io.engine.clientsCount} connected clients`);
  
  const broadcastData = {
    requirementId: webhookData.requirementId,
    requestId: webhookData.requestId,
    data: webhookData,
    timestamp: new Date().toISOString()
  };
  
  // Emit to all clients
  io.emit('webhook-received', broadcastData);
  
  // Emit to specific requirement room
  io.to(`requirement-${webhookData.requirementId}`).emit('test-results', webhookData);
  
  // FIXED: Also emit to specific request room for precise targeting
  io.to(`request-${webhookId}`).emit('test-results', webhookData);
  
  log('info', '✅ Webhook processed successfully', { 
    requirementId: webhookData.requirementId,
    requestId: webhookData.requestId,
    resultCount: webhookData.results?.length || 0,
    connectedClients: io.engine.clientsCount
  });
  
  return {
    message: 'Webhook received and processed',
    requirementId: webhookData.requirementId,
    requestId: webhookData.requestId,
    resultCount: webhookData.results?.length || 0,
    webhookId,
    connectedClients: io.engine.clientsCount
  };
}

// FIXED: Cleanup expired results and old requests
function cleanupExpiredResults() {
  const now = Date.now();
  let cleanedCount = 0;
  
  // Clean expired webhook results
  for (const [requestId, value] of webhookResults.entries()) {
    if (value.ttl && value.ttl < now) {
      webhookResults.delete(requestId);
      processedWebhooks.delete(requestId);
      
      // Remove from active requests
      for (const [reqId, requestSet] of activeRequests.entries()) {
        if (requestSet.has(requestId)) {
          requestSet.delete(requestId);
          if (requestSet.size === 0) {
            activeRequests.delete(reqId);
          }
          break;
        }
      }
      
      cleanedCount++;
    }
  }
  
  if (cleanedCount > 0) {
    log('debug', '🧹 Cleaned up expired results', { count: cleanedCount });
  }
}

// Run cleanup every 15 minutes
setInterval(cleanupExpiredResults, 15 * 60 * 1000);

// ===== API ROUTES =====

// Health check
app.get('/api/webhook/health', (req, res) => {
  cleanupExpiredResults();
  
  const healthData = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    storedResults: webhookResults.size,
    processedWebhooks: processedWebhooks.size,
    activeRequests: Array.from(activeRequests.entries()).map(([reqId, requestSet]) => ({
      requirementId: reqId,
      activeRequestCount: requestSet.size,
      requestIds: Array.from(requestSet)
    })),
    connectedClients: io.engine.clientsCount,
    environment: process.env.NODE_ENV || 'development'
  };
  
  res.status(200).json(healthData);
});

// Main webhook endpoint - GitHub Actions sends results here
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

// FIXED: Get results by requestId (more precise than requirementId)
app.get('/api/test-results/request/:requestId', (req, res) => {
  const { requestId } = req.params;
  
  log('debug', `📋 Frontend requesting results for requestId: ${requestId}`);
  
  const result = webhookResults.get(requestId);
  
  if (!result) {
    return res.status(404).json({
      error: 'No results found',
      requestId
    });
  }
  
  // Check if result has expired
  if (result.ttl && result.ttl < Date.now()) {
    webhookResults.delete(requestId);
    return res.status(404).json({
      error: 'Results have expired',
      requestId
    });
  }
  
  res.status(200).json({
    requestId,
    ...result,
    retrievedAt: new Date().toISOString()
  });
});

// FIXED: Get latest results for a requirement (returns most recent requestId)
app.get('/api/test-results/:requirementId', (req, res) => {
  const { requirementId } = req.params;
  
  log('debug', `📋 Frontend requesting latest results for requirement: ${requirementId}`);
  
  // Find the most recent requestId for this requirement
  const requestIds = activeRequests.get(requirementId);
  if (!requestIds || requestIds.size === 0) {
    return res.status(404).json({
      error: 'No results found',
      requirementId
    });
  }
  
  // Get the most recent result (by timestamp)
  let latestResult = null;
  let latestTimestamp = 0;
  
  for (const requestId of requestIds) {
    const result = webhookResults.get(requestId);
    if (result && (!result.ttl || result.ttl > Date.now())) {
      const resultTimestamp = new Date(result.receivedAt).getTime();
      if (resultTimestamp > latestTimestamp) {
        latestTimestamp = resultTimestamp;
        latestResult = result;
      }
    }
  }
  
  if (!latestResult) {
    return res.status(404).json({
      error: 'No valid results found',
      requirementId
    });
  }
  
  res.status(200).json({
    requirementId,
    ...latestResult,
    retrievedAt: new Date().toISOString()
  });
});

// Enhanced manual webhook trigger with unique requestId
app.post('/api/test-webhook', async (req, res) => {
  try {
    log('info', '🧪 Manual webhook trigger for testing');
    
    // FIXED: Always generate unique requestId for test webhooks
    const testWebhook = {
      requirementId: req.body.requirementId || 'REQ-TEST',
      requestId: `manual-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      timestamp: new Date().toISOString(),
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

// FIXED: Clear results for a specific request
app.delete('/api/test-results/request/:requestId', (req, res) => {
  const { requestId } = req.params;
  
  const existed = webhookResults.has(requestId);
  webhookResults.delete(requestId);
  processedWebhooks.delete(requestId);
  
  // Remove from active requests
  for (const [reqId, requestSet] of activeRequests.entries()) {
    if (requestSet.has(requestId)) {
      requestSet.delete(requestId);
      if (requestSet.size === 0) {
        activeRequests.delete(reqId);
      }
      break;
    }
  }
  
  log('info', existed ? '🗑️ Request results cleared' : '🗑️ No results to clear', { requestId });
  
  res.status(200).json({
    message: existed ? 'Results cleared' : 'No results to clear',
    requestId
  });
});

// ===== WEBSOCKET HANDLING =====

io.on('connection', (socket) => {
  log('info', `🔌 Quality Tracker connected: ${socket.id}`);
  
  socket.emit('connection-info', {
    socketId: socket.id,
    timestamp: new Date().toISOString(),
    serverVersion: process.env.npm_package_version || '1.0.0'
  });
  
  // FIXED: Subscribe to both requirement and specific request
  socket.on('subscribe-requirement', (requirementId) => {
    socket.join(`requirement-${requirementId}`);
    log('debug', `📝 Client ${socket.id} subscribed to requirement ${requirementId}`);
  });
  
  // NEW: Subscribe to specific request for precise targeting
  socket.on('subscribe-request', (requestId) => {
    socket.join(`request-${requestId}`);
    log('debug', `📝 Client ${socket.id} subscribed to request ${requestId}`);
    
    // Send existing result if available
    const existingResult = webhookResults.get(requestId);
    if (existingResult && (!existingResult.ttl || existingResult.ttl > Date.now())) {
      socket.emit('test-results', existingResult);
      log('debug', `📤 Sent existing results to ${socket.id} for request ${requestId}`);
    }
  });
  
  socket.on('unsubscribe-requirement', (requirementId) => {
    socket.leave(`requirement-${requirementId}`);
    log('debug', `📝 Client ${socket.id} unsubscribed from requirement ${requirementId}`);
  });
  
  socket.on('unsubscribe-request', (requestId) => {
    socket.leave(`request-${requestId}`);
    log('debug', `📝 Client ${socket.id} unsubscribed from request ${requestId}`);
  });
  
  socket.on('disconnect', (reason) => {
    log('info', `🔌 Quality Tracker disconnected: ${socket.id}`, { reason });
  });
});

// Error handling
app.use('/api/*', (req, res) => {
  res.status(404).json({
    error: 'API endpoint not found',
    path: req.path,
    method: req.method
  });
});

app.use((error, req, res, next) => {
  log('error', '💥 Unhandled error in Express', error.message);
  res.status(500).json({
    error: 'Internal server error',
    message: isProduction ? 'Internal server error' : error.message
  });
});

// Startup
server.listen(PORT, HOST, () => {
  log('info', `🚀 Quality Tracker Webhook Server running on ${HOST}:${PORT}`);
  log('info', `🔗 Webhook endpoint: http://${HOST}:${PORT}/api/webhook/test-results`);
  log('info', `🌐 Health check: http://${HOST}:${PORT}/api/webhook/health`);
  log('info', `📊 Results API: http://${HOST}:${PORT}/api/test-results`);
  log('info', `🌐 CORS origins: ${allowedOrigins.join(', ')}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  log('info', '\n🛑 Shutting down webhook server...');
  
  io.close(() => {
    log('info', '📡 WebSocket server closed');
  });
  
  server.close(() => {
    log('info', '✅ HTTP server closed');
    process.exit(0);
  });
});

module.exports = { app, server, io };