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

    // ✅ FIXED: Join with BOTH requirement_versions AND requirement_test_mappings
    const result = await db.query(`
      SELECT 
        r.*,
        COALESCE(
          json_agg(
            DISTINCT rv.version_id
          ) FILTER (WHERE rv.version_id IS NOT NULL),
          '[]'
        ) as versions,
        COALESCE(
          json_agg(
            DISTINCT rtm.test_case_id
          ) FILTER (WHERE rtm.test_case_id IS NOT NULL),
          '[]'
        ) as test_case_ids
      FROM requirements r
      LEFT JOIN requirement_versions rv ON r.req_uuid = rv.requirement_id
      LEFT JOIN requirement_test_mappings rtm ON r.req_uuid = rtm.requirement_id
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
 * Get requirement by ID
 * ✅ FIXED: Properly handles UUID conversion
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

    // ✅ FIXED: Query using business ID (string), not UUID
    // The 'id' field is the business identifier (e.g., 'REQ-001')
    // The 'req_uuid' field is the internal UUID
    const result = await db.query(`
      SELECT 
        r.*,
        COALESCE(
          json_agg(
            DISTINCT v.id
          ) FILTER (WHERE v.id IS NOT NULL),
          '[]'
        ) as versions
      FROM requirements r
      LEFT JOIN requirement_versions rv ON r.req_uuid = rv.requirement_id
      LEFT JOIN versions v ON rv.version_id = v.ver_uuid
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
      versions = []
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

      const newRequirement = result.rows[0];

      // ✅ FIXED: Get the req_uuid that was auto-generated
      const req_uuid = newRequirement.req_uuid;

      // ✅ FIXED: Insert version mappings using UUIDs
      if (versions && Array.isArray(versions) && versions.length > 0) {
        for (const versionId of versions) {
          try {
            // Get version UUID from business ID
            const verUuidResult = await client.query(
              'SELECT ver_uuid FROM versions WHERE id = $1',
              [versionId]
            );

            if (verUuidResult.rows.length > 0) {
              const ver_uuid = verUuidResult.rows[0].ver_uuid;

              await client.query(`
                INSERT INTO requirement_versions (requirement_id, version_id)
                VALUES ($1, $2)
                ON CONFLICT (requirement_id, version_id) DO NOTHING
              `, [req_uuid, ver_uuid]);
            } else {
              console.warn(`Version ${versionId} not found, skipping mapping`);
            }
          } catch (error) {
            console.warn(`Failed to link requirement ${id} to version ${versionId}:`, error.message);
          }
        }
      }

      await client.query('COMMIT');

      // Fetch the complete requirement with versions (using business IDs for display)
      const completeResult = await client.query(`
        SELECT 
          r.*,
          COALESCE(
            json_agg(
              DISTINCT v.id
            ) FILTER (WHERE v.id IS NOT NULL),
            '[]'
          ) as versions
        FROM requirements r
        LEFT JOIN requirement_versions rv ON r.req_uuid = rv.requirement_id
        LEFT JOIN versions v ON rv.version_id = v.ver_uuid
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

    const {
      name,
      description,
      type,
      priority,
      status,
      owner,
      category,
      tags,
      custom_fields,
      businessImpact,
      technicalComplexity,
      regulatoryFactor,
      usageFrequency,
      testDepthFactor,
      minTestCases,
      versions
    } = req.body;

    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');

      // ✅ Get req_uuid for the requirement being updated
      const reqUuidResult = await client.query(
        'SELECT req_uuid FROM requirements WHERE id = $1 AND workspace_id = $2',
        [id, workspaceId]
      );

      if (reqUuidResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({
          success: false,
          error: 'Requirement not found'
        });
      }

      const req_uuid = reqUuidResult.rows[0].req_uuid;

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
      if (owner !== undefined) {
        updates.push(`owner = $${paramCounter}`);
        values.push(owner);
        paramCounter++;
      }
      if (category !== undefined) {
        updates.push(`category = $${paramCounter}`);
        values.push(category);
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

      // Update requirement fields if there are any
      if (updates.length > 0) {
        values.push(id);
        values.push(workspaceId);
        values.push(req.user.id);

        await client.query(`
          UPDATE requirements
          SET ${updates.join(', ')}, updated_at = NOW(), updated_by = $${paramCounter + 2}
          WHERE id = $${paramCounter} AND workspace_id = $${paramCounter + 1}
        `, values);
      }

      // ✅ Handle version assignments with UUID conversion
      if (versions !== undefined && Array.isArray(versions)) {
        // Delete existing version mappings using req_uuid
        await client.query(
          'DELETE FROM requirement_versions WHERE requirement_id = $1',
          [req_uuid]
        );

        // Insert new version mappings
        if (versions.length > 0) {
          for (const versionId of versions) {
            try {
              // Get version UUID from business ID
              const verUuidResult = await client.query(
                'SELECT ver_uuid FROM versions WHERE id = $1',
                [versionId]
              );

              if (verUuidResult.rows.length > 0) {
                const ver_uuid = verUuidResult.rows[0].ver_uuid;

                await client.query(`
                  INSERT INTO requirement_versions (requirement_id, version_id)
                  VALUES ($1, $2)
                  ON CONFLICT (requirement_id, version_id) DO NOTHING
                `, [req_uuid, ver_uuid]);
              }
            } catch (error) {
              console.warn(`Failed to link requirement ${id} to version ${versionId}:`, error.message);
            }
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