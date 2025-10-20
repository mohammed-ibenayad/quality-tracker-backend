const express = require('express');
const router = express.Router();
const db = require('../../database/connection');
const { authenticateToken, canRead, canWrite, isAdminOrOwner } = require('../middleware/auth');

// All routes require authentication
router.use(authenticateToken);

// ✅ REMOVED: const DEFAULT_WORKSPACE_ID

// GET /api/versions - Get all versions (ALL roles can read)
router.get('/', canRead, async (req, res) => {
  try {
    // ✅ REQUIRE workspace_id - no default fallback
    const workspaceId = req.query.workspace_id;
    
    if (!workspaceId) {
      return res.status(400).json({
        success: false,
        error: 'workspace_id is required'
      });
    }

    // ✅ Verify user has access to this workspace
    const accessCheck = await db.query(`
      SELECT role FROM workspace_members
      WHERE workspace_id = $1 AND user_id = $2
    `, [workspaceId, req.user.id]);

    if (accessCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        error: 'Access denied to this workspace'
      });
    }
    
    const result = await db.query(`
      SELECT * FROM versions
      WHERE workspace_id = $1
      ORDER BY sort_order ASC, created_at DESC
    `, [workspaceId]);

    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });
  } catch (error) {
    console.error('Error fetching versions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch versions',
      message: error.message
    });
  }
});

// GET /api/versions/:id - Get single version (ALL roles can read)
router.get('/:id', canRead, async (req, res) => {
  try {
    const { id } = req.params;
    const workspaceId = req.query.workspace_id;

    if (!workspaceId) {
      return res.status(400).json({
        success: false,
        error: 'workspace_id is required'
      });
    }

    // Verify user has access
    const accessCheck = await db.query(`
      SELECT role FROM workspace_members
      WHERE workspace_id = $1 AND user_id = $2
    `, [workspaceId, req.user.id]);

    if (accessCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        error: 'Access denied to this workspace'
      });
    }
    
    const result = await db.query(
      'SELECT * FROM versions WHERE id = $1 AND workspace_id = $2',
      [id, workspaceId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Version not found'
      });
    }

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error fetching version:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch version',
      message: error.message
    });
  }
});

// POST /api/versions - Create new version (owner, admin, editor only)
router.post('/', canWrite, async (req, res) => {
  try {
    const {
      id,
      name,
      description = '',
      status = 'Planning',
      planned_release_date,
      sort_order,
      workspace_id
    } = req.body;

    if (!id || !name) {
      return res.status(400).json({
        success: false,
        error: 'ID and name are required'
      });
    }

    // ✅ REQUIRE workspace_id
    if (!workspace_id) {
      return res.status(400).json({
        success: false,
        error: 'workspace_id is required'
      });
    }

    // ✅ Verify user has write access
    const accessCheck = await db.query(`
      SELECT role FROM workspace_members
      WHERE workspace_id = $1 AND user_id = $2
    `, [workspace_id, req.user.id]);

    if (accessCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        error: 'Access denied to this workspace'
      });
    }

    const userRole = accessCheck.rows[0].role;
    if (!['owner', 'admin', 'editor'].includes(userRole)) {
      return res.status(403).json({
        success: false,
        error: 'Insufficient permissions to create versions'
      });
    }

    await db.query(`
      INSERT INTO versions (
        id, workspace_id, name, description, status,
        planned_release_date, sort_order, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [id, workspace_id, name, description, status, planned_release_date, sort_order, req.user.id]);

    res.status(201).json({
      success: true,
      message: 'Version created successfully',
      data: { id }
    });
  } catch (error) {
    console.error('Error creating version:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create version',
      message: error.message
    });
  }
});

// PUT /api/versions/:id - Update version (owner, admin, editor only)
router.put('/:id', canWrite, async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    const workspaceId = updates.workspace_id || req.query.workspace_id;

    if (!workspaceId) {
      return res.status(400).json({
        success: false,
        error: 'workspace_id is required'
      });
    }

    // Verify user has write access
    const accessCheck = await db.query(`
      SELECT role FROM workspace_members
      WHERE workspace_id = $1 AND user_id = $2
    `, [workspaceId, req.user.id]);

    if (accessCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        error: 'Access denied to this workspace'
      });
    }

    const userRole = accessCheck.rows[0].role;
    if (!['owner', 'admin', 'editor'].includes(userRole)) {
      return res.status(403).json({
        success: false,
        error: 'Insufficient permissions to update versions'
      });
    }

    // Verify version belongs to workspace
    const versionCheck = await db.query(
      'SELECT id FROM versions WHERE id = $1 AND workspace_id = $2',
      [id, workspaceId]
    );

    if (versionCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Version not found in this workspace'
      });
    }

    const allowedFields = ['name', 'description', 'status', 'planned_release_date', 
                           'actual_release_date', 'sort_order', 'is_default', 'release_notes'];
    
    const updateFields = [];
    const updateValues = [];
    let paramIndex = 1;

    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        updateFields.push(`${key} = $${paramIndex}`);
        updateValues.push(value);
        paramIndex++;
      }
    }

    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No valid fields to update'
      });
    }

    updateValues.push(id);
    updateValues.push(workspaceId);

    await db.query(`
      UPDATE versions
      SET ${updateFields.join(', ')}, updated_at = NOW()
      WHERE id = $${paramIndex} AND workspace_id = $${paramIndex + 1}
    `, updateValues);

    res.json({
      success: true,
      message: 'Version updated successfully'
    });
  } catch (error) {
    console.error('Error updating version:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update version',
      message: error.message
    });
  }
});

// DELETE /api/versions/:id - Delete version (owner, admin only)
router.delete('/:id', isAdminOrOwner, async (req, res) => {
  try {
    const { id } = req.params;
    const workspaceId = req.query.workspace_id;

    if (!workspaceId) {
      return res.status(400).json({
        success: false,
        error: 'workspace_id is required'
      });
    }

    // Verify user has admin/owner access
    const accessCheck = await db.query(`
      SELECT role FROM workspace_members
      WHERE workspace_id = $1 AND user_id = $2
    `, [workspaceId, req.user.id]);

    if (accessCheck.rows.length === 0) {
      return res.status(403).json({
        success: false,
        error: 'Access denied to this workspace'
      });
    }

    const userRole = accessCheck.rows[0].role;
    if (!['owner', 'admin'].includes(userRole)) {
      return res.status(403).json({
        success: false,
        error: 'Insufficient permissions to delete versions'
      });
    }

    await db.query(
      'DELETE FROM versions WHERE id = $1 AND workspace_id = $2',
      [id, workspaceId]
    );

    res.json({
      success: true,
      message: 'Version deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting version:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete version',
      message: error.message
    });
  }
});

module.exports = router;