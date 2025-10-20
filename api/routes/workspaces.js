const express = require('express');
const router = express.Router();
const db = require('../../database/connection');
const { authenticateToken, isOwner, isAdminOrOwner } = require('../middleware/auth');

// All routes require authentication
router.use(authenticateToken);

// GET /api/workspaces - Get all workspaces for current user
router.get('/', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT w.*, wm.role, wm.joined_at
      FROM workspaces w
      JOIN workspace_members wm ON w.id = wm.workspace_id
      WHERE wm.user_id = $1 AND w.is_active = true
      ORDER BY wm.joined_at DESC
    `, [req.user.id]);

    res.json({
      success: true,
      data: result.rows
    });
  } catch (error) {
    console.error('Error fetching workspaces:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch workspaces',
      message: error.message
    });
  }
});

// GET /api/workspaces/:id - Get single workspace details
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    // Check if user has access to this workspace
    const accessCheck = await db.query(`
      SELECT role FROM workspace_members
      WHERE workspace_id = $1 AND user_id = $2
    `, [id, req.user.id]);

    if (accessCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        error: 'Access denied to this workspace'
      });
    }

    const result = await db.query(`
      SELECT w.*, 
        (SELECT json_agg(json_build_object(
          'id', u.id,
          'name', u.full_name,
          'email', u.email,
          'role', wm.role,
          'joined_at', wm.joined_at
        ))
        FROM workspace_members wm
        JOIN users u ON wm.user_id = u.id
        WHERE wm.workspace_id = w.id) as members
      FROM workspaces w
      WHERE w.id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Workspace not found'
      });
    }

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error fetching workspace:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch workspace',
      message: error.message
    });
  }
});

// POST /api/workspaces - Create new workspace (authenticated users can create)
router.post('/', async (req, res) => {
  try {
    const { name, description, slug } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        error: 'Workspace name is required'
      });
    }

    // Create workspace
    const workspaceResult = await db.query(`
      INSERT INTO workspaces (name, description, slug, owner_id)
      VALUES ($1, $2, $3, $4)
      RETURNING *
    `, [name, description, slug, req.user.id]);

    const workspace = workspaceResult.rows[0];

    // Add creator as owner
    await db.query(`
      INSERT INTO workspace_members (workspace_id, user_id, role)
      VALUES ($1, $2, 'owner')
    `, [workspace.id, req.user.id]);

    res.status(201).json({
      success: true,
      message: 'Workspace created successfully',
      data: workspace
    });
  } catch (error) {
    console.error('Error creating workspace:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create workspace',
      message: error.message
    });
  }
});

// PUT /api/workspaces/:id - Update workspace (owner or admin only)
router.put('/:id', isAdminOrOwner, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, slug, settings } = req.body;

    const updates = [];
    const values = [];
    let paramCounter = 1;

    if (name !== undefined) {
      updates.push(`name = $${paramCounter}`);
      values.push(name);
      paramCounter++;
    }
    if (description !== undefined) {
      updates.push(`description = $${paramCounter}`);
      values.push(description);
      paramCounter++;
    }
    if (slug !== undefined) {
      updates.push(`slug = $${paramCounter}`);
      values.push(slug);
      paramCounter++;
    }
    if (settings !== undefined) {
      updates.push(`settings = $${paramCounter}`);
      values.push(JSON.stringify(settings));
      paramCounter++;
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No valid fields to update'
      });
    }

    values.push(id);

    await db.query(`
      UPDATE workspaces
      SET ${updates.join(', ')}, updated_at = NOW()
      WHERE id = $${paramCounter}
    `, values);

    res.json({
      success: true,
      message: 'Workspace updated successfully'
    });
  } catch (error) {
    console.error('Error updating workspace:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update workspace',
      message: error.message
    });
  }
});

// DELETE /api/workspaces/:id - Delete workspace (owner only)
router.delete('/:id', isOwner, async (req, res) => {
  try {
    const { id } = req.params;

    // Soft delete (mark as inactive)
    await db.query(`
      UPDATE workspaces
      SET is_active = false, updated_at = NOW()
      WHERE id = $1
    `, [id]);

    res.json({
      success: true,
      message: 'Workspace deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting workspace:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete workspace',
      message: error.message
    });
  }
});

module.exports = router;