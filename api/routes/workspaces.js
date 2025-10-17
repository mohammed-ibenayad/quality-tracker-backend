const express = require('express');
const router = express.Router();
const workspacesController = require('../controllers/workspacesController');
const workspaceMembersController = require('../controllers/workspaceMembersController');
const workspaceAuth = require('../middleware/workspaceAuth');

// ============================================
// WORKSPACE ROUTES
// ============================================

// GET /api/workspaces - Get all workspaces for user
router.get('/', workspacesController.getUserWorkspaces);

// GET /api/workspaces/:id - Get single workspace
router.get('/:id', workspaceAuth.isWorkspaceMember, workspacesController.getWorkspaceById);

// POST /api/workspaces - Create new workspace
router.post('/', workspacesController.createWorkspace);

// PUT /api/workspaces/:id - Update workspace
router.put('/:id', 
  workspaceAuth.isWorkspaceMember, 
  workspaceAuth.isWorkspaceAdmin, 
  workspacesController.updateWorkspace
);

// DELETE /api/workspaces/:id - Delete workspace
router.delete('/:id', 
  workspaceAuth.isWorkspaceMember, 
  workspaceAuth.isWorkspaceOwner, 
  workspacesController.deleteWorkspace
);

// ============================================
// WORKSPACE MEMBERS ROUTES
// ============================================

// GET /api/workspaces/:workspace_id/members - Get all members
router.get('/:workspace_id/members', 
  workspaceAuth.isWorkspaceMember, 
  workspaceMembersController.getWorkspaceMembers
);

// POST /api/workspaces/:workspace_id/members - Add member
router.post('/:workspace_id/members', 
  workspaceAuth.isWorkspaceMember, 
  workspaceAuth.isWorkspaceAdmin, 
  workspaceMembersController.addWorkspaceMember
);

// PUT /api/workspaces/:workspace_id/members/:member_id - Update member
router.put('/:workspace_id/members/:member_id', 
  workspaceAuth.isWorkspaceMember, 
  workspaceAuth.isWorkspaceAdmin, 
  workspaceMembersController.updateWorkspaceMember
);

// DELETE /api/workspaces/:workspace_id/members/:member_id - Remove member
router.delete('/:workspace_id/members/:member_id', 
  workspaceAuth.isWorkspaceMember, 
  workspaceAuth.isWorkspaceAdmin, 
  workspaceMembersController.removeWorkspaceMember
);

module.exports = router;