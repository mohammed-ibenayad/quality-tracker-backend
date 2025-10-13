const db = require('../../database/connection');

const DEFAULT_WORKSPACE_ID = '00000000-0000-0000-0000-000000000002';
const DEFAULT_USER_ID = '00000000-0000-0000-0000-000000000001';

/**
 * Get all test cases for a workspace
 */
const getAllTestCases = async (req, res) => {
  try {
    const workspaceId = req.query.workspace_id || DEFAULT_WORKSPACE_ID;
    
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
      WHERE tc.id = $1
      GROUP BY tc.id
    `, [id]);

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
    const {
      id,
      name,
      description = '',
      steps = [],
      expected_result = '',
      preconditions = '',
      test_data = '',
      category = '',
      priority = 'Medium',
      tags = [],
      automation_status = 'Manual',
      automation_path = '',
      estimated_duration = null,
      status = 'Not Run',
      assignee = '',
      applicable_versions = [],
      requirement_ids = []
    } = req.body;

    // Validate required fields
    if (!id || !name) {
      return res.status(400).json({
        success: false,
        error: 'ID and name are required'
      });
    }

    const workspaceId = req.body.workspace_id || DEFAULT_WORKSPACE_ID;
    const userId = req.user?.id || DEFAULT_USER_ID;

    await db.transaction(async (client) => {
      // Insert test case
      await client.query(`
        INSERT INTO test_cases (
          id, workspace_id, name, description, steps, expected_result,
          preconditions, test_data, category, priority, tags,
          automation_status, automation_path, estimated_duration,
          status, assignee, created_by, updated_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      `, [
        id, workspaceId, name, description, JSON.stringify(steps), expected_result,
        preconditions, test_data, category, priority, JSON.stringify(tags),
        automation_status, automation_path, estimated_duration,
        status, assignee, userId, userId
      ]);

      // Insert version mappings
      if (applicable_versions.length > 0) {
        for (const versionId of applicable_versions) {
          await client.query(`
            INSERT INTO test_case_versions (test_case_id, version_id)
            VALUES ($1, $2)
            ON CONFLICT DO NOTHING
          `, [id, versionId]);
        }
      }

      // Insert requirement mappings
      if (requirement_ids.length > 0) {
        for (const reqId of requirement_ids) {
          await client.query(`
            INSERT INTO requirement_test_mappings (requirement_id, test_case_id, coverage_type, created_by)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT DO NOTHING
          `, [reqId, id, 'direct', userId]);
        }
      }

      // Audit log
      await client.query(`
        INSERT INTO audit_logs (workspace_id, user_id, action, entity_type, entity_id, new_value)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [workspaceId, userId, 'create', 'test_case', id, JSON.stringify({ id, name })]);
    });

    res.status(201).json({
      success: true,
      message: 'Test case created successfully',
      data: { id }
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
    const updates = req.body;
    const userId = req.user?.id || DEFAULT_USER_ID;

    // Get old value for audit
    const oldResult = await db.query('SELECT * FROM test_cases WHERE id = $1', [id]);
    if (oldResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Test case not found'
      });
    }

    const oldValue = oldResult.rows[0];

    // Build update query dynamically
    const allowedFields = [
      'name', 'description', 'steps', 'expected_result', 'preconditions', 'test_data',
      'category', 'priority', 'tags', 'automation_status', 'automation_path',
      'estimated_duration', 'status', 'assignee'
    ];

    const updateFields = [];
    const values = [];
    let valueIndex = 1;

    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        updateFields.push(`${field} = $${valueIndex}`);
        const value = ['steps', 'tags'].includes(field) ? 
          JSON.stringify(updates[field]) : updates[field];
        values.push(value);
        valueIndex++;
      }
    }

    if (updateFields.length === 0 && !updates.applicable_versions && !updates.requirement_ids) {
      return res.status(400).json({
        success: false,
        error: 'No valid fields to update'
      });
    }

    if (updateFields.length > 0) {
      // Add updated_by and updated_at
      updateFields.push(`updated_by = $${valueIndex}`);
      values.push(userId);
      valueIndex++;

      updateFields.push(`updated_at = NOW()`);
      values.push(id);

      await db.query(`
        UPDATE test_cases 
        SET ${updateFields.join(', ')}
        WHERE id = $${valueIndex}
      `, values);
    }

    await db.transaction(async (client) => {
      // Update versions if provided
      if (updates.applicable_versions) {
        await client.query('DELETE FROM test_case_versions WHERE test_case_id = $1', [id]);
        
        for (const versionId of updates.applicable_versions) {
          await client.query(`
            INSERT INTO test_case_versions (test_case_id, version_id)
            VALUES ($1, $2)
            ON CONFLICT DO NOTHING
          `, [id, versionId]);
        }
      }

      // Update requirement mappings if provided
      if (updates.requirement_ids) {
        await client.query('DELETE FROM requirement_test_mappings WHERE test_case_id = $1', [id]);
        
        for (const reqId of updates.requirement_ids) {
          await client.query(`
            INSERT INTO requirement_test_mappings (requirement_id, test_case_id, coverage_type, created_by)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT DO NOTHING
          `, [reqId, id, 'direct', userId]);
        }
      }

      // Audit log
      await client.query(`
        INSERT INTO audit_logs (workspace_id, user_id, action, entity_type, entity_id, old_value, new_value)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [oldValue.workspace_id, userId, 'update', 'test_case', id, 
          JSON.stringify(oldValue), JSON.stringify(updates)]);
    });

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
    const userId = req.user?.id || DEFAULT_USER_ID;

    const result = await db.query('SELECT * FROM test_cases WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Test case not found'
      });
    }

    const testCase = result.rows[0];

    await db.transaction(async (client) => {
      await client.query('DELETE FROM test_cases WHERE id = $1', [id]);

      await client.query(`
        INSERT INTO audit_logs (workspace_id, user_id, action, entity_type, entity_id, old_value)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [testCase.workspace_id, userId, 'delete', 'test_case', id, JSON.stringify(testCase)]);
    });

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
