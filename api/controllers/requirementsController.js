const db = require('../../database/connection');

/**
 * Get all requirements for a workspace
 * ✅ FIXED: Includes versions array from requirement_versions junction table
 */
const getAllRequirements = async (req, res) => {
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

    // ✅ Join with requirement_versions to get versions array
    const result = await db.query(`
      SELECT 
        r.*,
        COALESCE(
          json_agg(
            DISTINCT rv.version_id
          ) FILTER (WHERE rv.version_id IS NOT NULL),
          '[]'
        ) as versions
      FROM requirements r
      LEFT JOIN requirement_versions rv ON r.id = rv.requirement_id
      WHERE r.workspace_id = $1
      GROUP BY r.req_uuid
      ORDER BY r.created_at DESC
    `, [workspaceId]);

    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });
  } catch (error) {
    console.error('Error fetching requirements:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch requirements',
      message: error.message
    });
  }
};

/**
 * Get single requirement by ID
 * ✅ FIXED: Includes versions array from requirement_versions junction table
 */
const getRequirementById = async (req, res) => {
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
    
    // ✅ Join with requirement_versions to get versions array
    const result = await db.query(`
      SELECT 
        r.*,
        COALESCE(
          json_agg(
            DISTINCT rv.version_id
          ) FILTER (WHERE rv.version_id IS NOT NULL),
          '[]'
        ) as versions
      FROM requirements r
      LEFT JOIN requirement_versions rv ON r.id = rv.requirement_id
      WHERE r.id = $1 AND r.workspace_id = $2
      GROUP BY r.req_uuid
    `, [id, workspaceId]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Requirement not found'
      });
    }

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error fetching requirement:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch requirement',
      message: error.message
    });
  }
};

/**
 * Create new requirement
 */
const createRequirement = async (req, res) => {
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
        error: 'Insufficient permissions to create requirements'
      });
    }

    const {
      id,
      name,
      description = '',
      type = 'Functional',
      priority = 'Medium',
      status = 'Active',
      businessImpact = null,
      technicalComplexity = null,
      regulatoryFactor = null,
      usageFrequency = null,
      testDepthFactor = null,
      minTestCases = null,
      tags = [],
      custom_fields = {},
      versions = [] // ✅ ADD THIS
    } = req.body;

    if (!id) {
      return res.status(400).json({
        success: false,
        error: 'Requirement ID is required'
      });
    }

    if (!name) {
      return res.status(400).json({
        success: false,
        error: 'Requirement name is required'
      });
    }

    // ✅ Use a transaction to create requirement and version mappings
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      // Create the requirement
      const result = await client.query(`
        INSERT INTO requirements (
          id, workspace_id, name, description, type, priority, status, 
          business_impact, technical_complexity, regulatory_factor, usage_frequency,
          test_depth_factor, min_test_cases, tags, custom_fields, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        RETURNING *
      `, [
        id, workspaceId, name, description, type, priority, status,
        businessImpact, technicalComplexity, regulatoryFactor, usageFrequency,
        testDepthFactor, minTestCases,
        JSON.stringify(tags), JSON.stringify(custom_fields), req.user.id
      ]);

      // ✅ Insert version mappings if provided
      if (versions && Array.isArray(versions) && versions.length > 0) {
        for (const versionId of versions) {
          try {
            await client.query(`
              INSERT INTO requirement_versions (requirement_id, version_id)
              VALUES ($1, $2)
              ON CONFLICT (requirement_id, version_id) DO NOTHING
            `, [id, versionId]);
          } catch (error) {
            console.warn(`Failed to link requirement ${id} to version ${versionId}:`, error.message);
          }
        }
      }

      await client.query('COMMIT');

      // Fetch the complete requirement with versions
      const completeResult = await client.query(`
        SELECT 
          r.*,
          COALESCE(
            json_agg(
              DISTINCT rv.version_id
            ) FILTER (WHERE rv.version_id IS NOT NULL),
            '[]'
          ) as versions
        FROM requirements r
        LEFT JOIN requirement_versions rv ON r.id = rv.requirement_id
        WHERE r.id = $1
        GROUP BY r.req_uuid
      `, [id]);

      res.status(201).json({
        success: true,
        message: 'Requirement created successfully',
        data: completeResult.rows[0]
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error('Error creating requirement:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create requirement',
      message: error.message
    });
  }
};

/**
 * Update requirement
 * ✅ FIXED: Now handles versions array updates
 */
const updateRequirement = async (req, res) => {
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
        error: 'Insufficient permissions to update requirements'
      });
    }

    // Verify requirement belongs to workspace
    const reqCheck = await db.query(
      'SELECT id FROM requirements WHERE id = $1 AND workspace_id = $2',
      [id, workspaceId]
    );

    if (reqCheck.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Requirement not found in this workspace'
      });
    }

    const {
      name,
      description,
      type,
      priority,
      status,
      tags,
      custom_fields,
      businessImpact,
      technicalComplexity,
      regulatoryFactor,
      usageFrequency,
      testDepthFactor,
      minTestCases,
      versions // ✅ ADD THIS
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
    if (type !== undefined) {
      updates.push(`type = $${paramCounter}`);
      values.push(type);
      paramCounter++;
    }
    if (priority !== undefined) {
      updates.push(`priority = $${paramCounter}`);
      values.push(priority);
      paramCounter++;
    }
    if (status !== undefined) {
      updates.push(`status = $${paramCounter}`);
      values.push(status);
      paramCounter++;
    }
    if (tags !== undefined) {
      updates.push(`tags = $${paramCounter}`);
      values.push(JSON.stringify(tags));
      paramCounter++;
    }
    if (custom_fields !== undefined) {
      updates.push(`custom_fields = $${paramCounter}`);
      values.push(JSON.stringify(custom_fields));
      paramCounter++;
    }
    if (businessImpact !== undefined) {
      updates.push(`business_impact = $${paramCounter}`);
      values.push(businessImpact);
      paramCounter++;
    }
    if (technicalComplexity !== undefined) {
      updates.push(`technical_complexity = $${paramCounter}`);
      values.push(technicalComplexity);
      paramCounter++;
    }
    if (regulatoryFactor !== undefined) {
      updates.push(`regulatory_factor = $${paramCounter}`);
      values.push(regulatoryFactor);
      paramCounter++;
    }
    if (usageFrequency !== undefined) {
      updates.push(`usage_frequency = $${paramCounter}`);
      values.push(usageFrequency);
      paramCounter++;
    }
    if (testDepthFactor !== undefined) {
      updates.push(`test_depth_factor = $${paramCounter}`);
      values.push(testDepthFactor);
      paramCounter++;
    }
    if (minTestCases !== undefined) {
      updates.push(`min_test_cases = $${paramCounter}`);
      values.push(minTestCases);
      paramCounter++;
    }

    if (updates.length === 0 && versions === undefined) {
      return res.status(400).json({
        success: false,
        error: 'No valid fields to update'
      });
    }

    // ✅ Use a transaction to update both requirement and version mappings
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      // Update requirement fields if there are any
      if (updates.length > 0) {
        values.push(id);
        values.push(workspaceId);

        await client.query(`
          UPDATE requirements
          SET ${updates.join(', ')}, updated_at = NOW(), updated_by = $${paramCounter + 2}
          WHERE id = $${paramCounter} AND workspace_id = $${paramCounter + 1}
        `, [...values, req.user.id]);
      }

      // ✅ Handle version assignments if provided
      if (versions !== undefined && Array.isArray(versions)) {
        // Delete existing version mappings
        await client.query(
          'DELETE FROM requirement_versions WHERE requirement_id = $1',
          [id]
        );

        // Insert new version mappings
        for (const versionId of versions) {
          try {
            await client.query(`
              INSERT INTO requirement_versions (requirement_id, version_id)
              VALUES ($1, $2)
              ON CONFLICT (requirement_id, version_id) DO NOTHING
            `, [id, versionId]);
          } catch (error) {
            console.warn(`Failed to link requirement ${id} to version ${versionId}:`, error.message);
          }
        }
      }

      await client.query('COMMIT');

      res.json({
        success: true,
        message: 'Requirement updated successfully'
      });
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

  } catch (error) {
    console.error('Error updating requirement:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update requirement',
      message: error.message
    });
  }
};

/**
 * Delete requirement
 */
const deleteRequirement = async (req, res) => {
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
        error: 'Insufficient permissions to delete requirements'
      });
    }

    // Delete will cascade to requirement_versions due to foreign key
    await db.query(
      'DELETE FROM requirements WHERE id = $1 AND workspace_id = $2',
      [id, workspaceId]
    );

    res.json({
      success: true,
      message: 'Requirement deleted successfully'
    });
  } catch (error) {
    console.error('Error deleting requirement:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete requirement',
      message: error.message
    });
  }
};

module.exports = {
  getAllRequirements,
  getRequirementById,
  createRequirement,
  updateRequirement,
  deleteRequirement
};