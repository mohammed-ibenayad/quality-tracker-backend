const db = require('../../database/connection');

const DEFAULT_USER_ID = '00000000-0000-0000-0000-000000000001';

/**
 * Middleware to check if user is member of workspace
 */
const isWorkspaceMember = async (req, res, next) => {
  try {
    const workspaceId = req.params.workspace_id || req.params.id || req.body.workspace_id;
    const userId = req.user?.id || DEFAULT_USER_ID;
    
    // Skip auth in development mode with default user
    if (process.env.NODE_ENV === 'development' && userId === DEFAULT_USER_ID) {
      req.userWorkspaceRole = 'owner'; // Give full access in development
      return next();
    }
    
    if (!workspaceId) {
      return res.status(400).json({
        success: false,
        error: 'Workspace ID is required'
      });
    }
    
    const result = await db.query(`
      SELECT role FROM workspace_members 
      WHERE workspace_id = $1 AND user_id = $2
    `, [workspaceId, userId]);
    
    if (result.rows.length === 0) {
      return res.status(403).json({
        success: false,
        error: 'You are not a member of this workspace'
      });
    }
    
    // Add role to request for further permission checks
    req.userWorkspaceRole = result.rows[0].role;
    next();
  } catch (error) {
    console.error('Workspace auth error:', error);
    res.status(500).json({
      success: false,
      error: 'Authorization check failed',
      message: error.message
    });
  }
};

/**
 * Middleware to check if user has admin privileges in workspace
 */
const isWorkspaceAdmin = (req, res, next) => {
  const adminRoles = ['owner', 'admin'];
  
  if (!req.userWorkspaceRole) {
    return res.status(500).json({
      success: false,
      error: 'Role check failed: Run isWorkspaceMember middleware first'
    });
  }
  
  if (!adminRoles.includes(req.userWorkspaceRole)) {
    return res.status(403).json({
      success: false,
      error: 'Insufficient permissions: Admin role required'
    });
  }
  
  next();
};

/**
 * Middleware to check if user is workspace owner
 */
const isWorkspaceOwner = (req, res, next) => {
  if (!req.userWorkspaceRole) {
    return res.status(500).json({
      success: false,
      error: 'Role check failed: Run isWorkspaceMember middleware first'
    });
  }
  
  if (req.userWorkspaceRole !== 'owner') {
    return res.status(403).json({
      success: false,
      error: 'Insufficient permissions: Owner role required'
    });
  }
  
  next();
};

/**
 * Middleware to check if user is editor or higher
 */
const canEdit = (req, res, next) => {
  const editorRoles = ['owner', 'admin', 'editor'];
  
  if (!req.userWorkspaceRole) {
    return res.status(500).json({
      success: false,
      error: 'Role check failed: Run isWorkspaceMember middleware first'
    });
  }
  
  if (!editorRoles.includes(req.userWorkspaceRole)) {
    return res.status(403).json({
      success: false,
      error: 'Insufficient permissions: Editor role or higher required'
    });
  }
  
  next();
};

/**
 * Middleware to check if user can execute tests
 */
const canExecuteTests = (req, res, next) => {
  const executorRoles = ['owner', 'admin', 'editor', 'test_executor'];
  
  if (!req.userWorkspaceRole) {
    return res.status(500).json({
      success: false,
      error: 'Role check failed: Run isWorkspaceMember middleware first'
    });
  }
  
  if (!executorRoles.includes(req.userWorkspaceRole)) {
    return res.status(403).json({
      success: false,
      error: 'Insufficient permissions: Test executor role or higher required'
    });
  }
  
  next();
};

module.exports = {
  isWorkspaceMember,
  isWorkspaceAdmin,
  isWorkspaceOwner,
  canEdit,
  canExecuteTests
};