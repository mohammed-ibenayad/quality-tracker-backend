const db = require('../../database/connection');

const DEFAULT_WORKSPACE_ID = '00000000-0000-0000-0000-000000000002';
const DEFAULT_USER_ID = '00000000-0000-0000-0000-000000000001';

/**
 * Get all requirements for a workspace
 */
const getAllRequirements = async (req, res) => {
  try {
    const workspaceId = req.query.workspace_id || DEFAULT_WORKSPACE_ID;
    
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
      GROUP BY r.id
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
 */
const getRequirementById = async (req, res) => {
  try {
    const { id } = req.params;
    
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
            DISTINCT jsonb_build_object(
              'test_case_id', rtm.test_case_id,
              'coverage_type', rtm.coverage_type
            )
          ) FILTER (WHERE rtm.test_case_id IS NOT NULL),
          '[]'
        ) as test_cases
      FROM requirements r
      LEFT JOIN requirement_versions rv ON r.id = rv.requirement_id
      LEFT JOIN requirement_test_mappings rtm ON r.id = rtm.requirement_id
      WHERE r.id = $1
      GROUP BY r.id
    `, [id]);

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
    const {
      id,
      name,
      description,
      priority = 'Medium',
      type = 'Functional',
      status = 'Active',
      business_impact,
      technical_complexity,
      regulatory_factor,
      usage_frequency,
      owner,
      category,
      tags = [],
      versions = []
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

    // Calculate TDF
    const test_depth_factor = (
      (business_impact || 3) * 0.4 +
      (technical_complexity || 3) * 0.3 +
      (regulatory_factor || 3) * 0.2 +
      (usage_frequency || 3) * 0.1
    ).toFixed(1);

    // Calculate min test cases
    const tdf = parseFloat(test_depth_factor);
    let min_test_cases = 1;
    if (tdf >= 4.1) min_test_cases = 8;
    else if (tdf >= 3.1) min_test_cases = 5;
    else if (tdf >= 2.1) min_test_cases = 3;

    await db.transaction(async (client) => {
      // Insert requirement
      await client.query(`
        INSERT INTO requirements (
          id, workspace_id, name, description, priority, type, status,
          business_impact, technical_complexity, regulatory_factor, usage_frequency,
          test_depth_factor, min_test_cases, owner, category, tags,
          created_by, updated_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
      `, [
        id, workspaceId, name, description, priority, type, status,
        business_impact, technical_complexity, regulatory_factor, usage_frequency,
        test_depth_factor, min_test_cases, owner, category, JSON.stringify(tags),
        userId, userId
      ]);

      // Insert version mappings
      if (versions.length > 0) {
        for (const versionId of versions) {
          await client.query(`
            INSERT INTO requirement_versions (requirement_id, version_id)
            VALUES ($1, $2)
            ON CONFLICT DO NOTHING
          `, [id, versionId]);
        }
      }

      // Audit log
      await client.query(`
        INSERT INTO audit_logs (workspace_id, user_id, action, entity_type, entity_id, new_value)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [workspaceId, userId, 'create', 'requirement', id, JSON.stringify({ id, name })]);
    });

    res.status(201).json({
      success: true,
      message: 'Requirement created successfully',
      data: { id, test_depth_factor, min_test_cases }
    });
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
 */
const updateRequirement = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;
    const userId = req.user?.id || DEFAULT_USER_ID;

    // Get old value for audit
    const oldResult = await db.query('SELECT * FROM requirements WHERE id = $1', [id]);
    if (oldResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Requirement not found'
      });
    }

    const oldValue = oldResult.rows[0];

    // Build update query dynamically
    const allowedFields = [
      'name', 'description', 'priority', 'type', 'status',
      'business_impact', 'technical_complexity', 'regulatory_factor', 'usage_frequency',
      'owner', 'category', 'tags'
    ];

    const updateFields = [];
    const values = [];
    let valueIndex = 1;

    for (const field of allowedFields) {
      if (updates[field] !== undefined) {
        updateFields.push(`${field} = $${valueIndex}`);
        values.push(field === 'tags' ? JSON.stringify(updates[field]) : updates[field]);
        valueIndex++;
      }
    }

    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No valid fields to update'
      });
    }

    // Add updated_by and updated_at
    updateFields.push(`updated_by = $${valueIndex}`);
    values.push(userId);
    valueIndex++;

    updateFields.push(`updated_at = NOW()`);

    // Recalculate TDF if risk factors changed
    if (updates.business_impact || updates.technical_complexity || 
        updates.regulatory_factor || updates.usage_frequency) {
      const bi = updates.business_impact || oldValue.business_impact;
      const tc = updates.technical_complexity || oldValue.technical_complexity;
      const rf = updates.regulatory_factor || oldValue.regulatory_factor;
      const uf = updates.usage_frequency || oldValue.usage_frequency;

      const tdf = (bi * 0.4 + tc * 0.3 + rf * 0.2 + uf * 0.1).toFixed(1);
      let minTests = 1;
      if (tdf >= 4.1) minTests = 8;
      else if (tdf >= 3.1) minTests = 5;
      else if (tdf >= 2.1) minTests = 3;

      updateFields.push(`test_depth_factor = $${valueIndex}`);
      values.push(tdf);
      valueIndex++;

      updateFields.push(`min_test_cases = $${valueIndex}`);
      values.push(minTests);
      valueIndex++;
    }

    values.push(id);

    await db.transaction(async (client) => {
      // Update requirement
      await client.query(`
        UPDATE requirements 
        SET ${updateFields.join(', ')}
        WHERE id = $${valueIndex}
      `, values);

      // Update versions if provided
      if (updates.versions) {
        // Delete old version mappings
        await client.query('DELETE FROM requirement_versions WHERE requirement_id = $1', [id]);
        
        // Insert new version mappings
        for (const versionId of updates.versions) {
          await client.query(`
            INSERT INTO requirement_versions (requirement_id, version_id)
            VALUES ($1, $2)
            ON CONFLICT DO NOTHING
          `, [id, versionId]);
        }
      }

      // Audit log
      await client.query(`
        INSERT INTO audit_logs (workspace_id, user_id, action, entity_type, entity_id, old_value, new_value)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [oldValue.workspace_id, userId, 'update', 'requirement', id, 
          JSON.stringify(oldValue), JSON.stringify(updates)]);
    });

    res.json({
      success: true,
      message: 'Requirement updated successfully'
    });
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
    const userId = req.user?.id || DEFAULT_USER_ID;

    // Get requirement for audit
    const result = await db.query('SELECT * FROM requirements WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Requirement not found'
      });
    }

    const requirement = result.rows[0];

    await db.transaction(async (client) => {
      // Delete requirement (cascades to versions and mappings)
      await client.query('DELETE FROM requirements WHERE id = $1', [id]);

      // Audit log
      await client.query(`
        INSERT INTO audit_logs (workspace_id, user_id, action, entity_type, entity_id, old_value)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [requirement.workspace_id, userId, 'delete', 'requirement', id, JSON.stringify(requirement)]);
    });

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
