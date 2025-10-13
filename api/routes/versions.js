const express = require('express');
const router = express.Router();
const db = require('../../database/connection');

const DEFAULT_WORKSPACE_ID = '00000000-0000-0000-0000-000000000002';

// GET /api/versions - Get all versions
router.get('/', async (req, res) => {
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

// GET /api/versions/:id - Get single version
router.get('/:id', async (req, res) => {
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

// POST /api/versions - Create new version
router.post('/', async (req, res) => {
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

// PUT /api/versions/:id - Update version
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const allowedFields = ['name', 'description', 'status', 'planned_release_date', 
                          'actual_release_date', 'sort_order', 'release_notes'];

    const updateFields = [];
    const values = [];
    let valueIndex = 1;

    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        updateFields.push(`${field} = $${valueIndex}`);
        values.push(updates[field]);
        valueIndex++;
      }
    }

    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No valid fields to update'
      });
    }

    updateFields.push(`updated_at = NOW()`);
    values.push(id);

    await db.query(`
      UPDATE versions 
      SET ${updateFields.join(', ')}
      WHERE id = $${valueIndex}
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

// DELETE /api/versions/:id - Delete version
router.delete('/:id', async (req, res) => {
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
