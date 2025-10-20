const express = require('express');
const router = express.Router();
const db = require('../../database/connection');
const { authenticateToken, canRead, canWrite } = require('../middleware/auth');

// All routes require authentication
router.use(authenticateToken);

// ✅ REMOVED: const DEFAULT_WORKSPACE_ID

// GET /api/mappings - Get all requirement-test mappings (ALL roles can read)
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
    const { requirement_id, test_case_id, workspace_id } = req.body;

    if (!requirement_id || !test_case_id) {
      return res.status(400).json({
        success: false,
        error: 'requirement_id and test_case_id are required'
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
        error: 'Insufficient permissions to create mappings'
      });
    }

    // ✅ Verify both requirement and test case belong to the workspace
    const verifyReq = await db.query(
      'SELECT id FROM requirements WHERE id = $1 AND workspace_id = $2',
      [requirement_id, workspace_id]
    );

    const verifyTC = await db.query(
      'SELECT id FROM test_cases WHERE id = $1 AND workspace_id = $2',
      [test_case_id, workspace_id]
    );

    if (verifyReq.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Requirement not found in this workspace'
      });
    }

    if (verifyTC.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Test case not found in this workspace'
      });
    }

    await db.query(`
      INSERT INTO requirement_test_mappings (requirement_id, test_case_id, created_by)
      VALUES ($1, $2, $3)
      ON CONFLICT (requirement_id, test_case_id) DO NOTHING
    `, [requirement_id, test_case_id, req.user.id]);

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
    const workspaceId = req.query.workspace_id;

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
        error: 'Insufficient permissions to delete mappings'
      });
    }

    // Verify both requirement and test case belong to the workspace
    const verifyReq = await db.query(
      'SELECT id FROM requirements WHERE id = $1 AND workspace_id = $2',
      [requirement_id, workspaceId]
    );

    const verifyTC = await db.query(
      'SELECT id FROM test_cases WHERE id = $1 AND workspace_id = $2',
      [test_case_id, workspaceId]
    );

    if (verifyReq.rows.length === 0 || verifyTC.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Mapping not found in this workspace'
      });
    }

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