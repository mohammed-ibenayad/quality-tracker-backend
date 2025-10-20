const express = require('express');
const router = express.Router();
const db = require('../../database/connection');
const { authenticateToken, canRead, canWrite } = require('../middleware/auth');

const DEFAULT_WORKSPACE_ID = '00000000-0000-0000-0000-000000000002';

// All routes require authentication
router.use(authenticateToken);

// GET /api/mappings - Get all requirement-test mappings (ALL roles can read)
router.get('/', canRead, async (req, res) => {
  try {
    const workspaceId = req.query.workspace_id || DEFAULT_WORKSPACE_ID;
    
    const result = await db.query(`
      SELECT 
        rtm.*,
        r.name as requirement_name,
        tc.name as test_case_name
      FROM requirement_test_mappings rtm
      JOIN requirements r ON rtm.requirement_id = r.id
      JOIN test_cases tc ON rtm.test_case_id = tc.id
      WHERE r.workspace_id = $1
      ORDER BY rtm.created_at DESC
    `, [workspaceId]);

    // Transform to localStorage-compatible format
    const mappingObject = {};
    result.rows.forEach(row => {
      if (!mappingObject[row.requirement_id]) {
        mappingObject[row.requirement_id] = [];
      }
      mappingObject[row.requirement_id].push(row.test_case_id);
    });

    res.json({
      success: true,
      count: result.rows.length,
      data: mappingObject,
      details: result.rows // Include detailed mappings
    });
  } catch (error) {
    console.error('Error fetching mappings:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch mappings',
      message: error.message
    });
  }
});

// POST /api/mappings - Create new mapping (owner, admin, editor only)
router.post('/', canWrite, async (req, res) => {
  try {
    const { requirement_id, test_case_id } = req.body;

    if (!requirement_id || !test_case_id) {
      return res.status(400).json({
        success: false,
        error: 'requirement_id and test_case_id are required'
      });
    }

    await db.query(`
      INSERT INTO requirement_test_mappings (requirement_id, test_case_id)
      VALUES ($1, $2)
      ON CONFLICT (requirement_id, test_case_id) DO NOTHING
    `, [requirement_id, test_case_id]);

    res.status(201).json({
      success: true,
      message: 'Mapping created successfully'
    });
  } catch (error) {
    console.error('Error creating mapping:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create mapping',
      message: error.message
    });
  }
});

// DELETE /api/mappings/:requirement_id/:test_case_id - Delete mapping (owner, admin, editor only)
router.delete('/:requirement_id/:test_case_id', canWrite, async (req, res) => {
  try {
    const { requirement_id, test_case_id } = req.params;

    await db.query(`
      DELETE FROM requirement_test_mappings
      WHERE requirement_id = $1 AND test_case_id = $2
    `, [requirement_id, test_case_id]);

    res.json({
      success: true,
      message: 'Mapping deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting mapping:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete mapping',
      message: error.message
    });
  }
});

module.exports = router;