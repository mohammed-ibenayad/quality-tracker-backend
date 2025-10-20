const db = require('../../database/connection');

/**
 * Get all requirements for a workspace
 * ✅ FIXED: workspace_id is now REQUIRED
 */
const getAllRequirements = async (req, res) => {
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
              'status', rtm.status
            )
          ) FILTER (WHERE rtm.test_case_id IS NOT NULL),
          '[]'
        ) as test_cases
      FROM requirements r
      LEFT JOIN requirement_versions rv ON r.id = rv.requirement_id
      LEFT JOIN requirement_test_mappings rtm ON r.id = rtm.requirement_id
      WHERE r.id = $1 AND r.workspace_id = $2
      GROUP BY r.id
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
      name,
      description = '',
      type = 'Functional',      // ✅ FIXED: Capitalized
      priority = 'Medium',       // ✅ FIXED: Capitalized
      status = 'Active',         // ✅ FIXED: Capitalized (changed from 'Draft')
      tags = [],
      custom_fields = {}
    } = req.body;

    if (!name) {
      return res.status(400).json({
        success: false,
        error: 'Requirement name is required'
      });
    }

    const result = await db.query(`
      INSERT INTO requirements (
        workspace_id, name, description, type, priority, status, tags, custom_fields, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [workspaceId, name, description, type, priority, status, JSON.stringify(tags), JSON.stringify(custom_fields), req.user.id]);

    res.status(201).json({
      success: true,
      message: 'Requirement created successfully',
      data: result.rows[0]
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

    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No valid fields to update'
      });
    }

    values.push(id);
    values.push(workspaceId);

    await db.query(`
      UPDATE requirements
      SET ${updates.join(', ')}, updated_at = NOW()
      WHERE id = $${paramCounter} AND workspace_id = $${paramCounter + 1}
    `, values);

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