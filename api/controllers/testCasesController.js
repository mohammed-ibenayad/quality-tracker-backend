const db = require('../../database/connection');

/**
 * Get all test cases for a workspace
 * ✅ FIXED: workspace_id is now REQUIRED
 */
const getAllTestCases = async (req, res) => {
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
        tc.*,
        COALESCE(
          json_agg(
            DISTINCT tcv.version_id
          ) FILTER (WHERE tcv.version_id IS NOT NULL),
          '[]'
        ) as applicable_versions,
        COALESCE(
          json_agg(
            DISTINCT rtm.requirement_id
          ) FILTER (WHERE rtm.requirement_id IS NOT NULL),
          '[]'
        ) as requirement_ids
      FROM test_cases tc
      LEFT JOIN test_case_versions tcv ON tc.id = tcv.test_case_id
      LEFT JOIN requirement_test_mappings rtm ON tc.id = rtm.test_case_id
      WHERE tc.workspace_id = $1
      GROUP BY tc.id
      ORDER BY tc.created_at DESC
    `, [workspaceId]);

    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });
  } catch (error) {
    console.error('Error fetching test cases:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch test cases',
      message: error.message
    });
  }
};

/**
 * Get single test case by ID
 */
const getTestCaseById = async (req, res) => {
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

    const result = await db.query(`
      SELECT 
        tc.*,
        COALESCE(
          json_agg(
            DISTINCT tcv.version_id
          ) FILTER (WHERE tcv.version_id IS NOT NULL),
          '[]'
        ) as applicable_versions,
        COALESCE(
          json_agg(
            DISTINCT rtm.requirement_id
          ) FILTER (WHERE rtm.requirement_id IS NOT NULL),
          '[]'
        ) as requirement_ids
      FROM test_cases tc
      LEFT JOIN test_case_versions tcv ON tc.id = tcv.test_case_id
      LEFT JOIN requirement_test_mappings rtm ON tc.id = rtm.test_case_id
      WHERE tc.id = $1 AND tc.workspace_id = $2
      GROUP BY tc.id
    `, [id, workspaceId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Test case not found'
      });
    }

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error fetching test case:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch test case',
      message: error.message
    });
  }
};

/**
 * Create new test case
 */
const createTestCase = async (req, res) => {
  try {
    const workspaceId = req.body.workspace_id;

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
        error: 'Insufficient permissions to create test cases'
      });
    }

    const {
      id,
      name,
      description = '',
      priority = 'Medium',
      status = 'Not Run',
      steps = [],
      expected_result = '',
      tags = [],
      category = null,
      automation_status = 'Manual',
      custom_fields = {}
    } = req.body;

    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'Test case id is required'
      });
    }

    if (!name) {
      return res.status(400).json({
        success: false,
        error: 'Test case name is required'
      });
    }

    const result = await db.query(`
      INSERT INTO test_cases (
        id, workspace_id, name, description, category, priority, status, 
        automation_status, steps, expected_result, tags, custom_fields, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *
    `, [
      id,
      workspaceId,
      name,
      description,
      category,
      priority,
      status,
      automation_status,
      JSON.stringify(steps),
      expected_result,
      JSON.stringify(tags),
      JSON.stringify(custom_fields),
      req.user.id
    ]);

    res.status(201).json({
      success: true,
      message: 'Test case created successfully',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error creating test case:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create test case',
      message: error.message
    });
  }
};

/**
 * Update test case
 */
const updateTestCase = async (req, res) => {
  try {
    const { id } = req.params;
    const workspaceId = req.body.workspace_id || req.query.workspace_id;

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
        error: 'Insufficient permissions to update test cases'
      });
    }

    // Verify test case belongs to workspace
    const tcCheck = await db.query(
      'SELECT id FROM test_cases WHERE id = $1 AND workspace_id = $2',
      [id, workspaceId]
    );

    if (tcCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Test case not found in this workspace'
      });
    }

    const {
      name,
      description,
      category,
      priority,
      status,
      steps,
      expected_result,
      automation_status,
      tags,
      custom_fields
    } = req.body;

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
    if (category !== undefined) {
      updates.push(`category = $${paramCounter}`);
      values.push(category);
      paramCounter++;
    }
    if (priority !== undefined) {
      updates.push(`priority = $${paramCounter}`);  // ← Fixed
      values.push(priority);
      paramCounter++;
    }
    if (status !== undefined) {
      updates.push(`status = $${paramCounter}`);  // ← Fixed
      values.push(status);
      paramCounter++;
    }
    if (automation_status !== undefined) {
      updates.push(`automation_status = $${paramCounter}`);  // ← Fixed
      values.push(automation_status);
      paramCounter++;
    }
    if (steps !== undefined) {
      updates.push(`steps = $${paramCounter}`);  // ← Fixed
      values.push(JSON.stringify(steps));
      paramCounter++;
    }
    if (expected_result !== undefined) {
      updates.push(`expected_result = $${paramCounter}`);  // ← Fixed
      values.push(expected_result);
      paramCounter++;
    }
    if (tags !== undefined) {
      updates.push(`tags = $${paramCounter}`);  // ← Fixed
      values.push(JSON.stringify(tags));
      paramCounter++;
    }
    if (custom_fields !== undefined) {
      updates.push(`custom_fields = $${paramCounter}`);  // ← Fixed
      values.push(JSON.stringify(custom_fields));
      paramCounter++;
    }

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No valid fields to update'
      });
    }

    values.push(id);
    values.push(workspaceId);

    await db.query(`
      UPDATE test_cases
      SET ${updates.join(', ')}, updated_at = NOW()
      WHERE id = $${paramCounter} AND workspace_id = $${paramCounter + 1}
    `, values);

    res.json({
      success: true,
      message: 'Test case updated successfully'
    });
  } catch (error) {
    console.error('Error updating test case:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update test case',
      message: error.message
    });
  }
};

/**
 * Delete test case
 */
const deleteTestCase = async (req, res) => {
  try {
    const { id } = req.params;
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
        error: 'Insufficient permissions to delete test cases'
      });
    }

    await db.query(
      'DELETE FROM test_cases WHERE id = $1 AND workspace_id = $2',
      [id, workspaceId]
    );

    res.json({
      success: true,
      message: 'Test case deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting test case:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete test case',
      message: error.message
    });
  }
};

module.exports = {
  getAllTestCases,
  getTestCaseById,
  createTestCase,
  updateTestCase,
  deleteTestCase
};