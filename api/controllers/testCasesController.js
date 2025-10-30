const db = require('../../database/connection');

/**
 * Get all test cases for a workspace
 * ✅ FIXED: Updated GROUP BY to use tc_uuid (UUID primary key)
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
        DISTINCT v.id  -- ✅ CORRECT - returns business ID like "v1.0"
      ) FILTER (WHERE v.id IS NOT NULL),
      '[]'
    ) as applicable_versions,
    COALESCE(
      json_agg(
        DISTINCT r.id  -- ✅ CORRECT - returns business ID like "REQ-001"
      ) FILTER (WHERE r.id IS NOT NULL),
      '[]'
    ) as requirement_ids
  FROM test_cases tc
  LEFT JOIN test_case_versions tcv ON tc.tc_uuid = tcv.test_case_id
  LEFT JOIN versions v ON tcv.version_id = v.ver_uuid  -- ✅ ADD THIS JOIN
  LEFT JOIN requirement_test_mappings rtm ON tc.tc_uuid = rtm.test_case_id
  LEFT JOIN requirements r ON rtm.requirement_id = r.req_uuid  -- ✅ ADD THIS JOIN
  WHERE tc.workspace_id = $1
  GROUP BY tc.tc_uuid
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
 * ✅ FIXED: Updated GROUP BY to use tc_uuid (UUID primary key)
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
        DISTINCT v.id  -- ✅ CORRECT - returns business ID like "v1.0"
      ) FILTER (WHERE v.id IS NOT NULL),
      '[]'
    ) as applicable_versions,
    COALESCE(
      json_agg(
        DISTINCT r.id  -- ✅ CORRECT - returns business ID like "REQ-001"
      ) FILTER (WHERE r.id IS NOT NULL),
      '[]'
    ) as requirement_ids
  FROM test_cases tc
  LEFT JOIN test_case_versions tcv ON tc.tc_uuid = tcv.test_case_id
  LEFT JOIN versions v ON tcv.version_id = v.ver_uuid  -- ✅ ADD THIS JOIN
  LEFT JOIN requirement_test_mappings rtm ON tc.tc_uuid = rtm.test_case_id
  LEFT JOIN requirements r ON rtm.requirement_id = r.req_uuid  -- ✅ ADD THIS JOIN
  WHERE tc.id = $1 AND tc.workspace_id = $2
  GROUP BY tc.tc_uuid
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
      steps = [],
      expected_result = '',
      preconditions = '',
      test_data = '',
      category = null,
      priority = 'Medium',
      tags = [],
      automation_status = 'Manual',
      automation_path = null,
      estimated_duration = null,
      status = 'Not Run',
      assignee = null,
      custom_fields = {},
      requirement_ids = [],
      applicable_versions = []
    } = req.body;

    if (!id || !name) {
      return res.status(400).json({
        success: false,
        error: 'Test case ID and name are required'
      });
    }

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      // Create the test case
      const result = await client.query(`
        INSERT INTO test_cases (
          id, workspace_id, name, description, steps, expected_result,
          preconditions, test_data, category, priority, tags, automation_status,
          automation_path, estimated_duration, status, assignee, custom_fields, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
        RETURNING *
      `, [
        id, workspaceId, name, description, JSON.stringify(steps), expected_result,
        preconditions, test_data, category, priority, JSON.stringify(tags), automation_status,
        automation_path, estimated_duration, status, assignee, JSON.stringify(custom_fields), req.user.id
      ]);

      const newTestCase = result.rows[0];

      // ✅ Get the tc_uuid that was auto-generated
      const tc_uuid = newTestCase.tc_uuid;

      // ✅ Insert requirement mappings using UUIDs
      if (requirement_ids && requirement_ids.length > 0) {
        for (const reqId of requirement_ids) {
          try {
            // Get requirement UUID from business ID
            const reqUuidResult = await client.query(
              'SELECT req_uuid FROM requirements WHERE id = $1 AND workspace_id = $2',
              [reqId, workspaceId]
            );

            if (reqUuidResult.rows.length > 0) {
              const req_uuid = reqUuidResult.rows[0].req_uuid;

              await client.query(`
                INSERT INTO requirement_test_mappings (requirement_id, test_case_id, created_by)
                VALUES ($1, $2, $3)
                ON CONFLICT (requirement_id, test_case_id) DO NOTHING
              `, [req_uuid, tc_uuid, req.user.id]);
            }
          } catch (error) {
            console.warn(`Failed to link test case ${id} to requirement ${reqId}:`, error.message);
          }
        }
      }

      // ✅ Insert version mappings using UUIDs
      if (applicable_versions && applicable_versions.length > 0) {
        for (const versionId of applicable_versions) {
          try {
            // Get version UUID from business ID
            const verUuidResult = await client.query(
              'SELECT ver_uuid FROM versions WHERE id = $1',
              [versionId]
            );

            if (verUuidResult.rows.length > 0) {
              const ver_uuid = verUuidResult.rows[0].ver_uuid;

              await client.query(`
                INSERT INTO test_case_versions (test_case_id, version_id)
                VALUES ($1, $2)
                ON CONFLICT (test_case_id, version_id) DO NOTHING
              `, [tc_uuid, ver_uuid]);
            }
          } catch (error) {
            console.warn(`Failed to link test case ${id} to version ${versionId}:`, error.message);
          }
        }
      }

      await client.query('COMMIT');

      // Fetch the complete test case with mappings
      const completeResult = await client.query(`
  SELECT 
    tc.*,
    COALESCE(
      json_agg(
        DISTINCT v.id  -- ✅ CORRECT
      ) FILTER (WHERE v.id IS NOT NULL),
      '[]'
    ) as applicable_versions,
    COALESCE(
      json_agg(
        DISTINCT r.id  -- ✅ CORRECT
      ) FILTER (WHERE r.id IS NOT NULL),
      '[]'
    ) as requirement_ids
  FROM test_cases tc
  LEFT JOIN test_case_versions tcv ON tc.tc_uuid = tcv.test_case_id
  LEFT JOIN versions v ON tcv.version_id = v.ver_uuid  -- ✅ ADD THIS JOIN
  LEFT JOIN requirement_test_mappings rtm ON tc.tc_uuid = rtm.test_case_id
  LEFT JOIN requirements r ON rtm.requirement_id = r.req_uuid  -- ✅ ADD THIS JOIN
  WHERE tc.id = $1
  GROUP BY tc.tc_uuid
`, [id]);

      res.status(201).json({
        success: true,
        message: 'Test case created successfully',
        data: completeResult.rows[0]
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
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

    const {
      name,
      description,
      steps,
      expected_result,
      preconditions,
      test_data,
      category,
      priority,
      tags,
      automation_status,
      automation_path,
      estimated_duration,
      status,
      assignee,
      custom_fields,
      requirement_ids,
      applicable_versions
    } = req.body;

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      // ✅ Get tc_uuid for the test case being updated
      const tcUuidResult = await client.query(
        'SELECT tc_uuid FROM test_cases WHERE id = $1 AND workspace_id = $2',
        [id, workspaceId]
      );

      if (tcUuidResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          error: 'Test case not found'
        });
      }

      const tc_uuid = tcUuidResult.rows[0].tc_uuid;

      // Build dynamic update query for test case fields
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
      if (steps !== undefined) {
        updates.push(`steps = $${paramCounter}`);
        values.push(JSON.stringify(steps));
        paramCounter++;
      }
      if (expected_result !== undefined) {
        updates.push(`expected_result = $${paramCounter}`);
        values.push(expected_result);
        paramCounter++;
      }
      if (preconditions !== undefined) {
        updates.push(`preconditions = $${paramCounter}`);
        values.push(preconditions);
        paramCounter++;
      }
      if (test_data !== undefined) {
        updates.push(`test_data = $${paramCounter}`);
        values.push(test_data);
        paramCounter++;
      }
      if (category !== undefined) {
        updates.push(`category = $${paramCounter}`);
        values.push(category);
        paramCounter++;
      }
      if (priority !== undefined) {
        updates.push(`priority = $${paramCounter}`);
        values.push(priority);
        paramCounter++;
      }
      if (tags !== undefined) {
        updates.push(`tags = $${paramCounter}`);
        values.push(JSON.stringify(tags));
        paramCounter++;
      }
      if (automation_status !== undefined) {
        updates.push(`automation_status = $${paramCounter}`);
        values.push(automation_status);
        paramCounter++;
      }
      if (automation_path !== undefined) {
        updates.push(`automation_path = $${paramCounter}`);
        values.push(automation_path);
        paramCounter++;
      }
      if (estimated_duration !== undefined) {
        updates.push(`estimated_duration = $${paramCounter}`);
        values.push(estimated_duration);
        paramCounter++;
      }
      if (status !== undefined) {
        updates.push(`status = $${paramCounter}`);
        values.push(status);
        paramCounter++;
      }
      if (assignee !== undefined) {
        updates.push(`assignee = $${paramCounter}`);
        values.push(assignee);
        paramCounter++;
      }
      if (custom_fields !== undefined) {
        updates.push(`custom_fields = $${paramCounter}`);
        values.push(JSON.stringify(custom_fields));
        paramCounter++;
      }

      // Update test case fields if there are any updates
      if (updates.length > 0) {
        values.push(id);
        values.push(workspaceId);
        values.push(req.user.id);

        await client.query(`
          UPDATE test_cases
          SET ${updates.join(', ')}, updated_at = NOW(), updated_by = $${paramCounter + 2}
          WHERE id = $${paramCounter} AND workspace_id = $${paramCounter + 1}
        `, values);
      }

      // ✅ Handle requirement_ids updates with UUID conversion
      if (requirement_ids !== undefined && Array.isArray(requirement_ids)) {
        // Delete existing requirement mappings using tc_uuid
        await client.query(`
          DELETE FROM requirement_test_mappings 
          WHERE test_case_id = $1
        `, [tc_uuid]);

        // Insert new requirement mappings
        if (requirement_ids.length > 0) {
          for (const reqId of requirement_ids) {
            try {
              // Get requirement UUID from business ID
              const reqUuidResult = await client.query(
                'SELECT req_uuid FROM requirements WHERE id = $1 AND workspace_id = $2',
                [reqId, workspaceId]
              );

              if (reqUuidResult.rows.length > 0) {
                const req_uuid = reqUuidResult.rows[0].req_uuid;

                await client.query(`
                  INSERT INTO requirement_test_mappings (requirement_id, test_case_id)
                  VALUES ($1, $2)
                  ON CONFLICT (requirement_id, test_case_id) DO NOTHING
                `, [req_uuid, tc_uuid]);
              }
            } catch (error) {
              console.warn(`Failed to link test case ${id} to requirement ${reqId}:`, error.message);
            }
          }
        }
      }

      // ✅ Handle applicable_versions updates with UUID conversion
      if (applicable_versions !== undefined && Array.isArray(applicable_versions)) {
        // Delete existing version mappings using tc_uuid
        await client.query(`
          DELETE FROM test_case_versions 
          WHERE test_case_id = $1
        `, [tc_uuid]);

        // Insert new version mappings
        if (applicable_versions.length > 0) {
          for (const versionId of applicable_versions) {
            try {
              // Get version UUID from business ID
              const verUuidResult = await client.query(
                'SELECT ver_uuid FROM versions WHERE id = $1',
                [versionId]
              );

              if (verUuidResult.rows.length > 0) {
                const ver_uuid = verUuidResult.rows[0].ver_uuid;

                await client.query(`
                  INSERT INTO test_case_versions (test_case_id, version_id)
                  VALUES ($1, $2)
                  ON CONFLICT (test_case_id, version_id) DO NOTHING
                `, [tc_uuid, ver_uuid]);
              }
            } catch (error) {
              console.warn(`Failed to link test case ${id} to version ${versionId}:`, error.message);
            }
          }
        }
      }

      await client.query('COMMIT');

      res.json({
        success: true,
        message: 'Test case updated successfully'
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
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