const express = require('express');
const router = express.Router();
const db = require('../../database/connection');
const { authenticateToken, canRead, canWrite, isAdminOrOwner } = require('../middleware/auth');

const DEFAULT_WORKSPACE_ID = '00000000-0000-0000-0000-000000000002';

// All routes require authentication
router.use(authenticateToken);

// GET /api/versions - Get all versions (ALL roles can read)
router.get('/', canRead, async (req, res) => {
  try {
    const workspaceId = req.query.workspace_id || DEFAULT_WORKSPACE_ID;
    
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
    
    const result = await db.query('SELECT * FROM versions WHERE id = $1', [id]);

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
      sort_order
    } = req.body;

    if (!id || !name) {
      return res.status(400).json({
        success: false,
        error: 'ID and name are required'
      });
    }

    const workspaceId = req.body.workspace_id || DEFAULT_WORKSPACE_ID;

    await db.query(`
      INSERT INTO versions (
        id, workspace_id, name, description, status,
        planned_release_date, sort_order
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    `, [id, workspaceId, name, description, status, planned_release_date, sort_order]);

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

    const allowedFields = ['name', 'description', 'status', 'planned_release_date', 
                          'actual_release_date', 'sort_order', 'release_notes'];

    const updateFields = [];
    const values = [];
    let paramCounter = 1;

    Object.keys(updates).forEach(key => {
      if (allowedFields.includes(key)) {
        updateFields.push(`${key} = $${paramCounter}`);
        values.push(updates[key]);
        paramCounter++;
      }
    });

    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No valid fields to update'
      });
    }

    values.push(id);

    await db.query(`
      UPDATE versions 
      SET ${updateFields.join(', ')}, updated_at = NOW()
      WHERE id = $${paramCounter}
    `, values);

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

    await db.query('DELETE FROM versions WHERE id = $1', [id]);

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