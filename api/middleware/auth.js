const jwt = require('jsonwebtoken');
const db = require('../../database/connection');

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

/**
 * Middleware to verify JWT token
 */
const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error: 'No token provided'
      });
    }

    const token = authHeader.substring(7);

    // Verify JWT token
    const decoded = jwt.verify(token, JWT_SECRET);

    // Get user from database
    const result = await db.query(
      `SELECT id, email, full_name, is_active 
       FROM users 
       WHERE id = $1`,
      [decoded.userId]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        error: 'User not found'
      });
    }

    const user = result.rows[0];

    if (!user.is_active) {
      return res.status(401).json({
        success: false,
        error: 'Account is inactive'
      });
    }

    // Attach user to request
    req.user = {
      id: user.id,
      email: user.email,
      name: user.full_name
    };

    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        error: 'Invalid token'
      });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        error: 'Token expired'
      });
    }

    console.error('Auth middleware error:', error);
    res.status(500).json({
      success: false,
      error: 'Authentication failed',
      message: error.message
    });
  }
};

/**
 * Middleware to check workspace access and role
 * @param {Array<string>} allowedRoles - Array of allowed roles (e.g., ['owner', 'admin', 'editor'])
 */
const requireWorkspaceRole = (allowedRoles = []) => {
  return async (req, res, next) => {
    try {
      // User must be authenticated first
      if (!req.user) {
        return res.status(401).json({
          success: false,
          error: 'Authentication required'
        });
      }

      // Get workspace_id from query, body, or params
      const workspaceId = req.query.workspace_id || req.body.workspace_id || req.params.workspace_id || req.params.id;
      if (!workspaceId) {
        return res.status(400).json({
          success: false,
          error: 'Workspace ID is required'
        });
      }

      // Check user's role in the workspace
      const result = await db.query(
        `SELECT role 
         FROM workspace_members 
         WHERE workspace_id = $1 AND user_id = $2`,
        [workspaceId, req.user.id]
      );

      if (result.rows.length === 0) {
        return res.status(403).json({
          success: false,
          error: 'You do not have access to this workspace'
        });
      }

      const userRole = result.rows[0].role;

      // Check if user's role is allowed
      if (allowedRoles.length > 0 && !allowedRoles.includes(userRole)) {
        return res.status(403).json({
          success: false,
          error: `Access denied. Required role: ${allowedRoles.join(' or ')}. Your role: ${userRole}`
        });
      }

      // Attach workspace info to request
      req.workspace = {
        id: workspaceId,
        userRole: userRole
      };

      next();
    } catch (error) {
      console.error('Role check middleware error:', error);
      res.status(500).json({
        success: false,
        error: 'Authorization check failed',
        message: error.message
      });
    }
  };
};

/**
 * Role hierarchy helper - checks if user has sufficient privileges
 * owner > admin > editor > test_executor > viewer
 */
const hasMinimumRole = (userRole, minimumRole) => {
  const roleHierarchy = {
    'owner': 5,
    'admin': 4,
    'editor': 3,
    'test_executor': 2,
    'viewer': 1
  };

  return roleHierarchy[userRole] >= roleHierarchy[minimumRole];
};

/**
 * Quick role check middlewares for common cases
 */
const canWrite = requireWorkspaceRole(['owner', 'admin', 'editor']);
const canExecuteTests = requireWorkspaceRole(['owner', 'admin', 'editor', 'test_executor']);
const canRead = requireWorkspaceRole(['owner', 'admin', 'editor', 'test_executor', 'viewer']);
const isAdminOrOwner = requireWorkspaceRole(['owner', 'admin']);
const isOwner = requireWorkspaceRole(['owner']);

module.exports = {
  authenticateToken,
  requireWorkspaceRole,
  hasMinimumRole,
  // Convenience exports
  canWrite,
  canExecuteTests,
  canRead,
  isAdminOrOwner,
  isOwner
};