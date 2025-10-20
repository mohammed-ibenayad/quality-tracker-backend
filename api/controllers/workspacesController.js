const db = require('../../database/connection');

const DEFAULT_USER_ID = '00000000-0000-0000-0000-000000000001';

/**
 * Get all workspaces for a user
 */
const getUserWorkspaces = async (req, res) => {
  try {
    const userId = req.user?.id || DEFAULT_USER_ID;
    
    const result = await db.query(`
      SELECT 
        w.*,
        wm.role as user_role
      FROM workspaces w
      JOIN workspace_members wm ON w.id = wm.workspace_id
      WHERE wm.user_id = $1 AND w.is_active = true
      ORDER BY w.created_at DESC
    `, [userId]);

    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });
  } catch (error) {
    console.error('Error fetching workspaces:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch workspaces',
      message: error.message
    });
  }
};

/**
 * Get single workspace by ID
 */
const getWorkspaceById = async (req, res) => {
  try {
    const { id } = req.params;
    
    const result = await db.query(`
      SELECT * FROM workspaces WHERE id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Workspace not found'
      });
    }

    res.json({
      success: true,
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error fetching workspace:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch workspace',
      message: error.message
    });
  }
};

/**
 * Create new workspace
 */
const createWorkspace = async (req, res) => {
  try {
    const {
      name,
      description = '',
      slug = '',
      settings = {}
    } = req.body;

    // Validate required fields
    if (!name) {
      return res.status(400).json({
        success: false,
        error: 'Name is required'
      });
    }

    const userId = req.user?.id || DEFAULT_USER_ID;
    let workspaceId;

    await db.transaction(async (client) => {
      // Create workspace
      const workspaceResult = await client.query(`
        INSERT INTO workspaces (
          name, description, slug, owner_id, settings
        ) VALUES ($1, $2, $3, $4, $5)
        RETURNING id
      `, [name, description, slug || generateSlug(name), userId, JSON.stringify(settings)]);
      
      workspaceId = workspaceResult.rows[0].id;

      // Add creator as workspace owner
      await client.query(`
        INSERT INTO workspace_members (
          workspace_id, user_id, role, invited_by, joined_at
        ) VALUES ($1, $2, $3, $4, NOW())
      `, [workspaceId, userId, 'owner', userId]);
    });

    res.status(201).json({
      success: true,
      message: 'Workspace created successfully',
      data: { id: workspaceId }
    });
  } catch (error) {
    console.error('Error creating workspace:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create workspace',
      message: error.message
    });
  }
};

/**
 * Update workspace
 */
const updateWorkspace = async (req, res) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const allowedFields = ['name', 'description', 'slug', 'settings', 'is_active'];
    
    const updateFields = [];
    const updateValues = [];
    let paramIndex = 1;

    for (const [key, value] of Object.entries(updates)) {
      if (allowedFields.includes(key)) {
        updateFields.push(`${key.toLowerCase()} = $${paramIndex}`);
        updateValues.push(key === 'settings' ? JSON.stringify(value) : value);
        paramIndex++;
      }
    }

    if (updateFields.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'No valid fields to update'
      });
    }

    // Add updated_at timestamp
    updateFields.push(`updated_at = NOW()`);

    // Add where clause parameter
    updateValues.push(id);

    const query = `
      UPDATE workspaces
      SET ${updateFields.join(', ')}
      WHERE id = $${paramIndex}
      RETURNING *
    `;

    const result = await db.query(query, updateValues);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Workspace not found'
      });
    }

    res.json({
      success: true,
      message: 'Workspace updated successfully',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error updating workspace:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update workspace',
      message: error.message
    });
  }
};

/**
 * Delete workspace
 */
const deleteWorkspace = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.query('DELETE FROM workspaces WHERE id = $1 RETURNING id', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Workspace not found'
      });
    }

    res.json({
      success: true,
      message: 'Workspace deleted successfully',
      data: { id }
    });
  } catch (error) {
    console.error('Error deleting workspace:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete workspace',
      message: error.message
    });
  }
};

/**
 * Helper function to generate a URL-friendly slug
 */
function generateSlug(name) {
  return name
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')  // Remove special characters
    .replace(/\s+/g, '-')      // Replace spaces with hyphens
    .replace(/--+/g, '-')      // Replace multiple hyphens with a single one
    .trim();
}

// Export functions
module.exports = {
  getUserWorkspaces,
  getWorkspaceById,
  createWorkspace,
  updateWorkspace,
  deleteWorkspace
};