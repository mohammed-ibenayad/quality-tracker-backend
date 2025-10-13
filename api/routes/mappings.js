const express = require('express');
const router = express.Router();
const db = require('../../database/connection');

const DEFAULT_WORKSPACE_ID = '00000000-0000-0000-0000-000000000002';

// GET /api/mappings - Get all requirement-test mappings
router.get('/', async (req, res) => {
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

module.exports = router;
