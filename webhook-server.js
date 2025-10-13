require('dotenv').config();

const db = require('./database/connection');
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

// MODIFIED: Storage for individual test case results
const testCaseResults = new Map(); // Key: "requestId-testCaseId", Value: test case data
const processedWebhooks = new Set(); // Track processed webhook IDs to prevent duplicates
const requestExecutions = new Map(); // Key: requestId, Value: { testCaseIds: Set, timestamp }

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
  // Only log debug messages if not in production or if explicitly enabled via LOG_LEVEL
  if (level === 'debug' && isProduction && process.env.LOG_LEVEL !== 'debug') {
      return; // Skip debug logs in production unless LOG_LEVEL is 'debug'
  }
  console.log(`[${timestamp}] ${level.toUpperCase()}: ${message}`, data || '');
}

// MODIFIED: Validation for single test case per webhook
function validateWebhookPayload(payload) {
  const errors = [];

  if (!payload) {
    errors.push('Payload is required');
    return { valid: false, errors };
  }

  if (!payload.requestId) {
    errors.push('requestId is required for proper request isolation');
  }

  if (!payload.timestamp) {
    errors.push('timestamp is required');
  }

  if (!payload.results || !Array.isArray(payload.results)) {
    errors.push('results must be an array');
  } else if (payload.results.length !== 1) {
    errors.push('exactly one test case result expected per webhook');
  } else if (!payload.results[0].id) {
    errors.push('test case id is required in results');
  }

  return { valid: errors.length === 0, errors };
}

// ENHANCED: Process webhook for individual test case with improved duplicate detection
async function processWebhookData(webhookData) {
  log('info', '🔔 Processing test case webhook', {
    requestId: webhookData.requestId,
    testCaseId: webhookData.results[0]?.id,
    status: webhookData.results[0]?.status
  });

  // Validate webhook payload
  const validation = validateWebhookPayload(webhookData);
  if (!validation.valid) {
    log('error', '❌ Invalid webhook payload', validation.errors);
    throw new Error(`Invalid webhook payload: ${validation.errors.join(', ')}`);
  }

  const testCase = webhookData.results[0];
  const testCaseId = testCase.id;
  const compositeKey = `${webhookData.requestId}-${testCaseId}`;

  // Changed log level from 'debug' to 'info' for the failure object
  if (testCase.failure) {
    log('info', `🚨 Failure object received for test case ${testCaseId}:`, JSON.stringify(testCase.failure, null, 2));
  } else {
    log('info', `✅ No detailed failure object for test case ${testCaseId}. Status: ${testCase.status}`);
  }

  // Track request execution
  if (!requestExecutions.has(webhookData.requestId)) {
    requestExecutions.set(webhookData.requestId, {
      testCaseIds: new Set(),
      timestamp: Date.now()
    });
  }

  const execution = requestExecutions.get(webhookData.requestId);
  execution.testCaseIds.add(testCaseId);

  // ENHANCED: Improved duplicate detection to allow enhanced updates
  const statusKey = `${compositeKey}-${testCase.status}`;
  const existingResult = testCaseResults.get(compositeKey);
  
  // Check if this is an enhanced update (same status but now with failure object)
  const isEnhancedUpdate = existingResult && 
    existingResult.testCase.status === testCase.status &&
    !existingResult.testCase.failure && 
    testCase.failure;

  // Allow enhanced updates, block true duplicates
  const isDuplicate = processedWebhooks.has(statusKey) && !isEnhancedUpdate;
  
  if (isDuplicate) {
    log('warn', '⚠️ Duplicate test case webhook detected', { compositeKey, status: testCase.status });
    return {
      message: 'Test case webhook already processed',
      compositeKey,
      duplicate: true
    };
  }

  // ENHANCED: Log when processing an enhanced update
  if (isEnhancedUpdate) {
    log('info', '🔄 Processing enhanced update with failure details', { 
      compositeKey, 
      status: testCase.status,
      hasFailureObject: !!testCase.failure
    });
  }

  // Store test case result (will overwrite existing result with enhanced data)
  const testCaseData = {
    requestId: webhookData.requestId,
    testCaseId: testCaseId,
    testCase: testCase,
    receivedAt: new Date().toISOString(),
    compositeKey,
    ttl: Date.now() + (parseInt(process.env.RESULT_TTL) || 3600000) // 1 hour default
  };

  testCaseResults.set(compositeKey, testCaseData);

  // Mark as processed for this specific status (only if not an enhanced update)
  if (!isEnhancedUpdate) {
    processedWebhooks.add(statusKey);
  }

  // Broadcast to WebSocket subscribers
  const broadcastData = {
    requestId: webhookData.requestId,
    testCaseId: testCaseId,
    testCase: testCase,
    timestamp: testCaseData.receivedAt,
    enhanced: isEnhancedUpdate
  };

  // Send to request-specific room
  io.to(`request-${webhookData.requestId}`).emit('test-case-result', broadcastData);

  log('info', '✅ Test case webhook processed successfully', {
    compositeKey,
    status: testCase.status,
    enhanced: isEnhancedUpdate,
    hasFailureObject: !!testCase.failure,
    subscribers: io.sockets.adapter.rooms.get(`request-${webhookData.requestId}`)?.size || 0
  });

  return {
    message: isEnhancedUpdate ? 'Test case webhook enhanced with failure details' : 'Test case webhook processed successfully',
    compositeKey,
    testCaseId,
    status: testCase.status,
    enhanced: isEnhancedUpdate,
    broadcastSent: true
  };
}

// ===== API ENDPOINTS =====

// Health check


app.get('/api/webhook/health', async (req, res) => {
  const stats = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    testCaseResults: testCaseResults.size,
    activeExecutions: requestExecutions.size,
    processedWebhooks: processedWebhooks.size,
    uptime: process.uptime()
  };

  // Add database health check
  if (process.env.ENABLE_DATABASE === 'true') {
    try {
      const dbHealthy = await db.healthCheck();
      const poolStats = db.getPoolStats();
      stats.database = {
        healthy: dbHealthy,
        pool: poolStats
      };
    } catch (error) {
      stats.database = {
        healthy: false,
        error: error.message
      };
    }
  }

  res.status(200).json(stats);
});


// MAIN: Webhook endpoint for test case results
app.post('/api/webhook/test-results', async (req, res) => {
  try {
    const webhookData = req.body;

    log('info', '📥 Webhook received', {
      requestId: webhookData?.requestId,
      testCaseId: webhookData?.results?.[0]?.id,
      status: webhookData?.results?.[0]?.status,
      userAgent: req.get('User-Agent'),
      source: req.get('X-Request-ID') || 'unknown'
    });

    // MODIFIED: Changed log level from 'debug' to 'info' for the full incoming webhook payload
    log('info', 'Full incoming webhook payload:', JSON.stringify(webhookData, null, 2));

    const result = await processWebhookData(webhookData);

    res.status(200).json({
      success: true,
      ...result,
      receivedAt: new Date().toISOString()
    });

  } catch (error) {
    log('error', '❌ Error processing webhook', error.message);

    res.status(400).json({
      success: false,
      error: 'Webhook processing failed',
      message: isProduction ? 'Webhook processing failed' : error.message
    });
  }
});

// NEW: Get specific test case result
app.get('/api/test-results/request/:requestId/testcase/:testCaseId', (req, res) => {
  const { requestId, testCaseId } = req.params;
  const compositeKey = `${requestId}-${testCaseId}`;

  log('debug', `📋 Frontend requesting specific test case result`, { compositeKey });

  const result = testCaseResults.get(compositeKey);

  if (!result) {
    return res.status(404).json({
      error: 'Test case result not found',
      requestId,
      testCaseId,
      compositeKey
    });
  }

  // Changed log level from 'debug' to 'info' for the retrieved failure object
  if (result.testCase && result.testCase.failure) {
    log('info', `Retrieved test case ${testCaseId} contains failure:`, JSON.stringify(result.testCase.failure, null, 2));
  } else if (result.testCase) {
     log('info', `Retrieved test case ${testCaseId}. Status: ${result.testCase.status}`);
  }

  // Check if result has expired
  if (result.ttl && result.ttl < Date.now()) {
    testCaseResults.delete(compositeKey);
    return res.status(404).json({
      error: 'Test case result has expired',
      requestId,
      testCaseId,
      compositeKey
    });
  }

  res.status(200).json({
    requestId,
    testCaseId,
    compositeKey,
    ...result,
    retrievedAt: new Date().toISOString()
  });
});

// NEW: Get all test case results for a request
app.get('/api/test-results/request/:requestId', (req, res) => {
  const { requestId } = req.params;

  log('debug', `📋 Frontend requesting all test case results for request: ${requestId}`);

  const execution = requestExecutions.get(requestId);
  if (!execution) {
    return res.status(404).json({
      error: 'No execution found for request',
      requestId
    });
  }

  const results = [];
  const expiredKeys = [];

  for (const testCaseId of execution.testCaseIds) {
    const compositeKey = `${requestId}-${testCaseId}`;
    const result = testCaseResults.get(compositeKey);

    if (result) {
      if (result.ttl && result.ttl < Date.now()) {
        expiredKeys.push(compositeKey);
      } else {
        results.push({
          testCaseId,
          compositeKey,
          ...result
        });
      }
    }
  }

  // Clean up expired results
  expiredKeys.forEach(key => testCaseResults.delete(key));

  if (results.length === 0) {
    return res.status(404).json({
      error: 'No valid test case results found',
      requestId
    });
  }

  res.status(200).json({
    requestId,
    testCaseCount: results.length,
    totalExpected: execution.testCaseIds.size,
    results,
    retrievedAt: new Date().toISOString()
  });
});

// Manual test webhook trigger
app.post('/api/test-webhook', async (req, res) => {
  try {
    log('info', '🧪 Manual test case webhook trigger');

    const testRequestId = `manual-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
    const testCaseId = req.body.testCaseId || 'TC_001';

    const testWebhook = {
      requestId: testRequestId,
      timestamp: new Date().toISOString(),
      results: [
        {
          id: testCaseId,
          name: req.body.testCaseName || `Test ${testCaseId}`,
          status: req.body.status || (Math.random() > 0.3 ? 'Passed' : 'Failed'),
          duration: Math.floor(Math.random() * 2000) + 500,
          logs: req.body.logs || `Manual test execution for ${testCaseId} completed`
        }
      ]
    };

    const result = await processWebhookData(testWebhook);

    res.status(200).json({
      ...result,
      testTrigger: true,
      message: 'Manual test case webhook processed successfully'
    });

  } catch (error) {
    log('error', '❌ Error processing manual test webhook', error.message);

    res.status(500).json({
      error: 'Manual test webhook failed',
      message: isProduction ? 'Manual test webhook failed' : error.message
    });
  }
});

// NEW: Clear results for a specific request
app.delete('/api/test-results/request/:requestId', (req, res) => {
  const { requestId } = req.params;

  const execution = requestExecutions.get(requestId);
  let clearedCount = 0;

  if (execution) {
    // Clear all test case results for this request
    for (const testCaseId of execution.testCaseIds) {
      const compositeKey = `${requestId}-${testCaseId}`;
      if (testCaseResults.has(compositeKey)) {
        testCaseResults.delete(compositeKey);
        clearedCount++;
      }

      // Clear processed webhook tracking
      for (const status of ['Not Started', 'Running', 'Passed', 'Failed']) {
        processedWebhooks.delete(`${compositeKey}-${status}`);
      }
    }

    // Remove execution tracking
    requestExecutions.delete(requestId);
  }

  log('info', clearedCount > 0 ? '🗑️ Request results cleared' : '🗑️ No results to clear', {
    requestId,
    clearedCount
  });

  res.status(200).json({
    message: clearedCount > 0 ? 'Results cleared' : 'No results to clear',
    requestId,
    clearedCount
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

  // Subscribe to specific request for test case updates
  socket.on('subscribe-request', (requestId) => {
    socket.join(`request-${requestId}`);
    log('debug', `📝 Client ${socket.id} subscribed to request ${requestId}`);

    // Send existing results for this request if available
    const execution = requestExecutions.get(requestId);
    if (execution) {
      for (const testCaseId of execution.testCaseIds) {
        const compositeKey = `${requestId}-${testCaseId}`;
        const existingResult = testCaseResults.get(compositeKey);

        if (existingResult && (!existingResult.ttl || existingResult.ttl > Date.now())) {
          const broadcastData = {
            requestId: requestId,
            testCaseId: testCaseId,
            testCase: existingResult.testCase,
            timestamp: existingResult.receivedAt
          };

          socket.emit('test-case-result', broadcastData);
          log('debug', `📤 Sent existing test case result to ${socket.id}`, { compositeKey });
        }
      }
    }
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
  log('info', `📊 Test case results API: http://${HOST}:${PORT}/api/test-results`);
  log('info', `🌐 CORS origins: ${allowedOrigins.join(', ')}`);
  log('info', `✨ NEW: Per test case result handling with composite keys`);
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
