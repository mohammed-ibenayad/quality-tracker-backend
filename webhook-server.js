// webhook-server.js - Simple Express.js backend for Quality Tracker
const express = require('express');
const cors = require('cors');
const { createServer } = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');

const app = express();
const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

// In-memory storage (use Redis/Database in production)
const webhookResults = new Map();
const processedWebhooks = new Set();

// Middleware
app.use(express.json({ limit: '10mb' }));
app.use(cors());

// Serve static files for Quality Tracker frontend
app.use(express.static('dist'));

// ===== WEBHOOK ENDPOINTS (GitHub Actions calls these) =====

/**
 * Main webhook endpoint - GitHub Actions sends results here
 */
app.post('/api/webhook/test-results', async (req, res) => {
  try {
    console.log('🔔 Webhook received from GitHub Actions');
    console.log('Timestamp:', new Date().toISOString());
    console.log('Payload:', JSON.stringify(req.body, null, 2));
    
    const webhookData = req.body;
    
    // Validate webhook payload
    const validation = validateWebhookPayload(webhookData);
    if (!validation.valid) {
      console.error('❌ Invalid webhook payload:', validation.errors);
      return res.status(400).json({
        error: 'Invalid webhook payload',
        details: validation.errors
      });
    }
    
    // Check for duplicates
    const webhookId = `${webhookData.requirementId}-${webhookData.requestId || webhookData.timestamp}`;
    if (processedWebhooks.has(webhookId)) {
      console.log('⚠️ Duplicate webhook detected, skipping');
      return res.status(200).json({
        message: 'Webhook already processed',
        webhookId
      });
    }
    
    // Store webhook result
    const resultKey = webhookData.requirementId;
    webhookResults.set(resultKey, {
      ...webhookData,
      receivedAt: new Date().toISOString(),
      webhookId
    });
    
    // Mark as processed
    processedWebhooks.add(webhookId);
    
    // Broadcast to connected Quality Tracker clients via WebSocket
    console.log(`📡 Broadcasting to clients for requirement: ${resultKey}`);
    io.emit('webhook-received', {
      requirementId: webhookData.requirementId,
      data: webhookData,
      timestamp: new Date().toISOString()
    });
    
    // Also emit to specific requirement room if clients are listening
    io.to(`requirement-${resultKey}`).emit('test-results', webhookData);
    
    console.log('✅ Webhook processed successfully');
    
    res.status(200).json({
      message: 'Webhook received and processed',
      requirementId: webhookData.requirementId,
      resultCount: webhookData.results?.length || 0,
      webhookId
    });
    
  } catch (error) {
    console.error('❌ Error processing webhook:', error);
    
    res.status(500).json({
      error: 'Internal server error',
      message: error.message
    });
  }
});

/**
 * Webhook health check for GitHub Actions
 */
app.get('/api/webhook/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    storedResults: webhookResults.size,
    processedWebhooks: processedWebhooks.size
  });
});

// ===== API ENDPOINTS (Quality Tracker calls these) =====

/**
 * Get latest test results for a requirement
 */
app.get('/api/test-results/:requirementId', (req, res) => {
  const { requirementId } = req.params;
  
  console.log(`📋 Frontend requesting results for: ${requirementId}`);
  
  const result = webhookResults.get(requirementId);
  
  if (!result) {
    return res.status(404).json({
      error: 'No results found',
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
  
  res.status(200).json({
    message: existed ? 'Results cleared' : 'No results to clear',
    requirementId
  });
});

/**
 * Manual webhook trigger (for testing)
 */
app.post('/api/test-webhook', (req, res) => {
  console.log('🧪 Manual webhook trigger for testing');
  
  // Simulate webhook data
  const testWebhook = {
    requirementId: req.body.requirementId || 'REQ-TEST',
    timestamp: new Date().toISOString(),
    requestId: `manual-${Date.now()}`,
    results: req.body.results || [
      {
        id: 'TC_001',
        name: 'Test Case 1',
        status: 'Passed',
        duration: 1200,
        logs: 'Manual test execution completed successfully'
      }
    ]
  };
  
  // Process as if it came from GitHub Actions
  req.body = testWebhook;
  app._router.handle(req, res);
});

// ===== WEBSOCKET HANDLING =====

io.on('connection', (socket) => {
  console.log(`🔌 Quality Tracker connected: ${socket.id}`);
  
  // Join requirement-specific rooms for targeted updates
  socket.on('subscribe-requirement', (requirementId) => {
    socket.join(`requirement-${requirementId}`);
    console.log(`📝 Client ${socket.id} subscribed to ${requirementId}`);
  });
  
  socket.on('unsubscribe-requirement', (requirementId) => {
    socket.leave(`requirement-${requirementId}`);
    console.log(`📝 Client ${socket.id} unsubscribed from ${requirementId}`);
  });
  
  socket.on('disconnect', () => {
    console.log(`🔌 Quality Tracker disconnected: ${socket.id}`);
  });
});

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

// ===== STARTUP =====

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log(`🚀 Quality Tracker Webhook Server running on port ${PORT}`);
  console.log(`📡 WebSocket server ready for real-time updates`);
  console.log(`🔗 Webhook endpoint: http://localhost:${PORT}/api/webhook/test-results`);
  console.log(`🌐 Health check: http://localhost:${PORT}/api/webhook/health`);
  console.log(`📊 Results API: http://localhost:${PORT}/api/test-results`);
  
  if (process.env.NODE_ENV === 'development') {
    console.log(`🧪 Test webhook: curl -X POST http://localhost:${PORT}/api/test-webhook -H "Content-Type: application/json" -d '{"requirementId":"REQ-001"}'`);
  }
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down webhook server...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

module.exports = { app, server, io };