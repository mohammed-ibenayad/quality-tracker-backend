const { Pool } = require('pg');
require('dotenv').config();

// Parse log level from environment
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';
const isDebug = LOG_LEVEL === 'debug';
const isProduction = process.env.NODE_ENV === 'production';

// Database configuration
const poolConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || 'quality_tracker_db',
  user: process.env.DB_USER || 'quality_tracker_user',
  password: process.env.DB_PASSWORD,
  min: parseInt(process.env.DB_POOL_MIN) || 2,
  max: parseInt(process.env.DB_POOL_MAX) || 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  // Production settings
  ssl: isProduction && process.env.DB_SSL === 'true' ? {
    rejectUnauthorized: false
  } : false,
};

const pool = new Pool(poolConfig);

// Connection event handlers
pool.on('connect', (client) => {
  if (!isProduction || isDebug) {
    console.log('✅ Connected to PostgreSQL database');
  }
});

pool.on('error', (err, client) => {
  console.error('❌ Unexpected error on idle PostgreSQL client:', err.message);
  if (isDebug) {
    console.error('Error details:', err);
  }
});

pool.on('remove', () => {
  if (isDebug) {
    console.log('🔌 Client removed from pool');
  }
});

/**
 * Execute a query with automatic error handling
 * @param {string} text - SQL query text
 * @param {Array} params - Query parameters
 * @returns {Promise} Query result
 */
const query = async (text, params) => {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    
    if (isDebug) {
      console.log('Executed query', { 
        text: text.substring(0, 100), 
        duration: `${duration}ms`, 
        rows: res.rowCount 
      });
    }
    
    return res;
  } catch (error) {
    console.error('Database query error:', error.message);
    if (isDebug) {
      console.error('Query:', text);
      console.error('Params:', params);
      console.error('Full error:', error);
    }
    throw error;
  }
};

/**
 * Execute a transaction
 * @param {Function} callback - Transaction callback function
 * @returns {Promise} Transaction result
 */
const transaction = async (callback) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Transaction error:', error.message);
    throw error;
  } finally {
    client.release();
  }
};

/**
 * Check database health
 * @returns {Promise<boolean>} Database health status
 */
const healthCheck = async () => {
  try {
    await query('SELECT 1');
    return true;
  } catch (error) {
    console.error('Database health check failed:', error.message);
    return false;
  }
};

/**
 * Get pool statistics
 * @returns {Object} Pool statistics
 */
const getPoolStats = () => {
  return {
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount
  };
};

/**
 * Gracefully close all connections
 */
let isClosing = false;

const close = async () => {
  if (isClosing) {
    console.log('⚠️ Database pool already closing/closed');
    return;
  }
  
  isClosing = true;
  
  try {
    await pool.end();
    console.log('✅ Database pool closed gracefully');
  } catch (error) {
    console.error('Error closing database pool:', error.message);
  }
};

// Graceful shutdown handling
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down database connection...');
  await close();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Shutting down database connection...');
  await close();
  process.exit(0);
});

module.exports = {
  pool,
  query,
  transaction,
  healthCheck,
  getPoolStats,
  close
};
