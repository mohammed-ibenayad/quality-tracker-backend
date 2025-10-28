const express = require('express');
const router = express.Router();
const db = require('../../database/connection');
const { authenticateToken, canRead, canWrite } = require('../middleware/auth');

// All routes require authentication
router.use(authenticateToken);

// GET /api/mappings - Get all requirement-test mappings (ALL roles can read)
router.get('/', canRead, async (req, res) => {
  try {
    const workspaceId = req.query.workspace_id;
    
    if (!workspaceId) {
      return res.status(400).json({
        success: false,
        error: 'workspace_id is required'
      });
    }

    // Verify user has access to this workspace
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
    
    // ✅ FIXED: JOIN using UUID columns
    const result = await db.query(`
      SELECT 
        rtm.*,
        r.id as requirement_id,
        r.name as requirement_name,
        tc.id as test_case_id,
        tc.name as test_case_name
      FROM requirement_test_mappings rtm
      JOIN requirements r ON rtm.requirement_id = r.req_uuid
      JOIN test_cases tc ON rtm.test_case_id = tc.tc_uuid
      WHERE r.workspace_id = $1
      ORDER BY rtm.created_at DESC
    `, [workspaceId]);

    // Transform to localStorage-compatible format (using business IDs)
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

    if (!workspace_id) {
      return res.status(400).json({
        success: false,
        error: 'workspace_id is required'
      });
    }

    // Verify user has write access
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

    // ✅ NEW: Get UUIDs from business IDs
    const reqUuidResult = await db.query(
      'SELECT req_uuid FROM requirements WHERE id = $1 AND workspace_id = $2',
      [requirement_id, workspace_id]
    );

    if (reqUuidResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Requirement not found in this workspace'
      });
    }

    const tcUuidResult = await db.query(
      'SELECT tc_uuid FROM test_cases WHERE id = $1 AND workspace_id = $2',
      [test_case_id, workspace_id]
    );

    if (tcUuidResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Test case not found in this workspace'
      });
    }

    const req_uuid = reqUuidResult.rows[0].req_uuid;
    const tc_uuid = tcUuidResult.rows[0].tc_uuid;

    // ✅ NEW: Insert mapping using UUIDs
    const result = await db.query(`
      INSERT INTO requirement_test_mappings (requirement_id, test_case_id, created_by)
      VALUES ($1, $2, $3)
      ON CONFLICT (requirement_id, test_case_id) DO NOTHING
      RETURNING *
    `, [req_uuid, tc_uuid, req.user.id]);

    if (result.rows.length === 0) {
      return res.status(409).json({
        success: false,
        error: 'Mapping already exists'
      });
    }

    res.status(201).json({
      success: true,
      message: 'Mapping created successfully',
      data: result.rows[0]
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

    // ✅ NEW: Get UUIDs before deleting
    const reqUuidResult = await db.query(
      'SELECT req_uuid FROM requirements WHERE id = $1 AND workspace_id = $2',
      [requirement_id, workspaceId]
    );

    if (reqUuidResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Requirement not found in this workspace'
      });
    }

    const tcUuidResult = await db.query(
      'SELECT tc_uuid FROM test_cases WHERE id = $1 AND workspace_id = $2',
      [test_case_id, workspaceId]
    );

    if (tcUuidResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Test case not found in this workspace'
      });
    }

    const req_uuid = reqUuidResult.rows[0].req_uuid;
    const tc_uuid = tcUuidResult.rows[0].tc_uuid;

    // ✅ NEW: Delete using UUIDs
    const result = await db.query(`
      DELETE FROM requirement_test_mappings
      WHERE requirement_id = $1 AND test_case_id = $2
      RETURNING *
    `, [req_uuid, tc_uuid]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Mapping not found'
      });
    }

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