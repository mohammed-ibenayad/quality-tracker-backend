const db = require('../../database/connection');

/**
 * Get all test suites for a workspace
 */
const getAllTestSuites = async (req, res) => {
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

    // Get test suites with member count
    const result = await db.query(`
  SELECT 
    tsd.*,
    COUNT(tsm.test_case_id) as test_count,
    COUNT(CASE WHEN tc.automation_status = 'Automated' THEN 1 END) as automated_count,
    u.full_name as created_by_name
  FROM test_suite_definitions tsd
  LEFT JOIN test_suite_members tsm ON tsd.id = tsm.suite_id
  LEFT JOIN test_cases tc ON tsm.test_case_id = tc.tc_uuid
  LEFT JOIN users u ON tsd.created_by = u.id
  WHERE tsd.workspace_id = $1 AND tsd.is_active = true
  GROUP BY tsd.id, u.full_name
  ORDER BY tsd.created_at DESC
`, [workspaceId]);

    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });
  } catch (error) {
    console.error('Error fetching test suites:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch test suites',
      message: error.message
    });
  }
};

/**
 * Get single test suite by ID
 */
const getTestSuiteById = async (req, res) => {
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
        tsd.*,
        COUNT(tsm.test_case_id) as test_count,
        COUNT(CASE WHEN tc.automation_status = 'Automated' THEN 1 END) as automated_count,
        u.full_name as created_by_name
      FROM test_suite_definitions tsd
      LEFT JOIN test_suite_members tsm ON tsd.id = tsm.suite_id
      LEFT JOIN test_cases tc ON tsm.test_case_id = tc.tc_uuid
      LEFT JOIN users u ON tsd.created_by = u.id
      WHERE tsd.id = $1 AND tsd.workspace_id = $2
      GROUP BY tsd.id, u.full_name
    `, [id, workspaceId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Test suite not found'
      });
    }

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error fetching test suite:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch test suite',
      message: error.message
    });
  }
};

/**
 * Get test suite members (test cases in the suite)
 */
const getTestSuiteMembers = async (req, res) => {
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

    // Verify suite exists and belongs to workspace
    const suiteCheck = await db.query(`
      SELECT id FROM test_suite_definitions
      WHERE id = $1 AND workspace_id = $2
    `, [id, workspaceId]);

    if (suiteCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Test suite not found'
      });
    }

    const result = await db.query(`
  SELECT 
    tc.*,
    tsm.execution_order,
    tsm.is_mandatory,
    tsm.added_at,
    u.full_name as added_by_name,
    COALESCE(
      json_agg(
        DISTINCT v.id  -- ✅ CORRECT - returns business ID like "v1.0"
      ) FILTER (WHERE v.id IS NOT NULL),
      '[]'
    ) as applicable_versions
  FROM test_suite_members tsm
  JOIN test_cases tc ON tsm.test_case_id = tc.tc_uuid
  LEFT JOIN test_case_versions tcv ON tc.tc_uuid = tcv.test_case_id
  LEFT JOIN versions v ON tcv.version_id = v.ver_uuid  -- ✅ ADD THIS JOIN
  LEFT JOIN users u ON tsm.added_by = u.id
  WHERE tsm.suite_id = $1
  GROUP BY tc.tc_uuid, tsm.execution_order, tsm.is_mandatory, tsm.added_at, u.full_name
  ORDER BY tsm.execution_order ASC, tc.id ASC
`, [id]);

    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });
  } catch (error) {
    console.error('Error fetching test suite members:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch test suite members',
      message: error.message
    });
  }
};


/**
 * Create new test suite
 */
const createTestSuite = async (req, res) => {
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
        error: 'Insufficient permissions to create test suite'
      });
    }

    const {
      name,
      description,
      version,
      suite_type,
      estimated_duration,
      recommended_environment,
      test_case_ids = []
    } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        error: 'Suite name is required'
      });
    }

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      // Create test suite
      const result = await client.query(`
        INSERT INTO test_suite_definitions (
          workspace_id, name, description, version, suite_type,
          estimated_duration, recommended_environment,
          created_by, updated_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
        RETURNING *
      `, [
        workspaceId,
        name,
        description || null,
        version || null,
        suite_type || 'custom',
        estimated_duration || null,
        recommended_environment || null,
        req.user.id
      ]);

      const newSuite = result.rows[0];

      // ✅ Add test cases if provided - convert business IDs to UUIDs
      if (test_case_ids && Array.isArray(test_case_ids) && test_case_ids.length > 0) {
        // Get UUIDs for all test case business IDs
        const tcCheck = await client.query(`
          SELECT id, tc_uuid FROM test_cases
          WHERE id = ANY($1) AND workspace_id = $2
        `, [test_case_ids, workspaceId]);

        const tcIdToUuidMap = {};
        tcCheck.rows.forEach(row => {
          tcIdToUuidMap[row.id] = row.tc_uuid;
        });

        // Add test cases to suite using UUIDs
        for (let i = 0; i < test_case_ids.length; i++) {
          const tc_uuid = tcIdToUuidMap[test_case_ids[i]];
          if (tc_uuid) {
            await client.query(`
              INSERT INTO test_suite_members (suite_id, test_case_id, execution_order, added_by)
              VALUES ($1, $2, $3, $4)
            `, [newSuite.id, tc_uuid, i, req.user.id]);
          }
        }
      }

      await client.query('COMMIT');

      // Fetch the complete suite with counts
      const finalResult = await db.query(`
        SELECT 
          tsd.*,
          COUNT(tsm.test_case_id) as test_count,
          COUNT(CASE WHEN tc.automation_status = 'Automated' THEN 1 END) as automated_count
        FROM test_suite_definitions tsd
        LEFT JOIN test_suite_members tsm ON tsd.id = tsm.suite_id
        LEFT JOIN test_cases tc ON tsm.test_case_id = tc.tc_uuid
        WHERE tsd.id = $1
        GROUP BY tsd.id
      `, [newSuite.id]);

      res.status(201).json({
        success: true,
        data: finalResult.rows[0]
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error creating test suite:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create test suite',
      message: error.message
    });
  }
};

/**
 * Update test suite
 */
const updateTestSuite = async (req, res) => {
  try {
    const { id } = req.params;
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
        error: 'Insufficient permissions to update test suite'
      });
    }

    // Verify suite exists
    const suiteCheck = await db.query(`
      SELECT id FROM test_suite_definitions
      WHERE id = $1 AND workspace_id = $2
    `, [id, workspaceId]);

    if (suiteCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Test suite not found'
      });
    }

    const {
      name,
      description,
      version,
      suite_type,
      estimated_duration,
      recommended_environment,
      is_active
    } = req.body;

    // Build dynamic update query
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
    if (version !== undefined) {
      updates.push(`version = $${paramCounter}`);
      values.push(version);
      paramCounter++;
    }
    if (suite_type !== undefined) {
      updates.push(`suite_type = $${paramCounter}`);
      values.push(suite_type);
      paramCounter++;
    }
    if (estimated_duration !== undefined) {
      updates.push(`estimated_duration = $${paramCounter}`);
      values.push(estimated_duration);
      paramCounter++;
    }
    if (recommended_environment !== undefined) {
      updates.push(`recommended_environment = $${paramCounter}`);
      values.push(recommended_environment);
      paramCounter++;
    }
    if (is_active !== undefined) {
      updates.push(`is_active = $${paramCounter}`);
      values.push(is_active);
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
    values.push(req.user.id);

    await db.query(`
      UPDATE test_suite_definitions
      SET ${updates.join(', ')}, updated_at = NOW(), updated_by = $${paramCounter + 2}
      WHERE id = $${paramCounter} AND workspace_id = $${paramCounter + 1}
    `, values);

    // Fetch updated suite
    const result = await db.query(`
      SELECT 
        tsd.*,
        COUNT(tsm.test_case_id) as test_count,
        COUNT(CASE WHEN tc.automation_status = 'Automated' THEN 1 END) as automated_count
      FROM test_suite_definitions tsd
      LEFT JOIN test_suite_members tsm ON tsd.id = tsm.suite_id
      LEFT JOIN test_cases tc ON tsm.test_case_id = tc.tc_uuid
      WHERE tsd.id = $1
      GROUP BY tsd.id
    `, [id]);

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating test suite:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update test suite',
      message: error.message
    });
  }
};

/**
 * Add test cases to suite
 */
const addTestCasesToSuite = async (req, res) => {
  try {
    const { id } = req.params;
    const workspaceId = req.body.workspace_id;
    const { test_case_ids } = req.body;

    if (!workspaceId) {
      return res.status(400).json({
        success: false,
        error: 'workspace_id is required'
      });
    }

    if (!test_case_ids || !Array.isArray(test_case_ids) || test_case_ids.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'test_case_ids array is required'
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
        error: 'Insufficient permissions to modify test suite'
      });
    }

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      // Verify suite exists
      const suiteCheck = await client.query(`
        SELECT id FROM test_suite_definitions
        WHERE id = $1 AND workspace_id = $2
      `, [id, workspaceId]);

      if (suiteCheck.rows.length === 0) {
        throw new Error('Test suite not found');
      }

      // ✅ Verify all test cases exist and get their UUIDs
      const tcCheck = await client.query(`
        SELECT id, tc_uuid FROM test_cases
        WHERE id = ANY($1) AND workspace_id = $2
      `, [test_case_ids, workspaceId]);

      const tcIdToUuidMap = {};
      tcCheck.rows.forEach(row => {
        tcIdToUuidMap[row.id] = row.tc_uuid;
      });

      if (Object.keys(tcIdToUuidMap).length === 0) {
        throw new Error('No valid test cases found');
      }

      // Get current max execution order
      const maxOrderResult = await client.query(`
        SELECT COALESCE(MAX(execution_order), -1) as max_order
        FROM test_suite_members
        WHERE suite_id = $1
      `, [id]);

      let currentOrder = maxOrderResult.rows[0].max_order + 1;

      // ✅ Add test cases using UUIDs
      const addedCount = { added: 0, skipped: 0 };
      for (const testCaseId of test_case_ids) {
        const tc_uuid = tcIdToUuidMap[testCaseId];
        if (tc_uuid) {
          try {
            await client.query(`
              INSERT INTO test_suite_members (suite_id, test_case_id, execution_order, added_by)
              VALUES ($1, $2, $3, $4)
              ON CONFLICT (suite_id, test_case_id) DO NOTHING
            `, [id, tc_uuid, currentOrder, req.user.id]);

            addedCount.added++;
            currentOrder++;
          } catch (error) {
            addedCount.skipped++;
            console.warn(`Skipped test case ${testCaseId}:`, error.message);
          }
        } else {
          addedCount.skipped++;
        }
      }

      await client.query('COMMIT');

      res.json({
        success: true,
        message: `Added ${addedCount.added} test case(s) to suite`,
        added: addedCount.added,
        skipped: addedCount.skipped
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error adding test cases to suite:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to add test cases to suite',
      message: error.message
    });
  }
};

/**
 * Remove test case from suite
 */
const removeTestCaseFromSuite = async (req, res) => {
  try {
    const { id, testCaseId } = req.params;
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
        error: 'Insufficient permissions to modify test suite'
      });
    }

    // Verify suite exists and belongs to workspace
    const suiteCheck = await db.query(`
      SELECT id FROM test_suite_definitions
      WHERE id = $1 AND workspace_id = $2
    `, [id, workspaceId]);

    if (suiteCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Test suite not found'
      });
    }

    // ✅ Get tc_uuid from business ID
    const tcUuidResult = await db.query(
      'SELECT tc_uuid FROM test_cases WHERE id = $1 AND workspace_id = $2',
      [testCaseId, workspaceId]
    );

    if (tcUuidResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Test case not found'
      });
    }

    const tc_uuid = tcUuidResult.rows[0].tc_uuid;

    // ✅ Remove test case from suite using UUID
    const result = await db.query(`
      DELETE FROM test_suite_members
      WHERE suite_id = $1 AND test_case_id = $2
      RETURNING *
    `, [id, tc_uuid]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Test case not found in suite'
      });
    }

    res.json({
      success: true,
      message: 'Test case removed from suite'
    });
  } catch (error) {
    console.error('Error removing test case from suite:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to remove test case from suite',
      message: error.message
    });
  }
};

/**
 * Delete test suite
 */
const deleteTestSuite = async (req, res) => {
  try {
    const { id } = req.params;
    const workspaceId = req.query.workspace_id;

    if (!workspaceId) {
      return res.status(400).json({
        success: false,
        error: 'workspace_id is required'
      });
    }

    // Verify user is admin or owner
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
        error: 'Only owners and admins can delete test suites'
      });
    }

    // Verify suite exists
    const suiteCheck = await db.query(`
      SELECT id FROM test_suite_definitions
      WHERE id = $1 AND workspace_id = $2
    `, [id, workspaceId]);

    if (suiteCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Test suite not found'
      });
    }

    // Delete suite (CASCADE will handle test_suite_members)
    await db.query(`
      DELETE FROM test_suite_definitions
      WHERE id = $1 AND workspace_id = $2
    `, [id, workspaceId]);

    res.json({
      success: true,
      message: 'Test suite deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting test suite:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete test suite',
      message: error.message
    });
  }
};

module.exports = {
  getAllTestSuites,
  getTestSuiteById,
  getTestSuiteMembers,
  createTestSuite,
  updateTestSuite,
  addTestCasesToSuite,
  removeTestCaseFromSuite,
  deleteTestSuite
};