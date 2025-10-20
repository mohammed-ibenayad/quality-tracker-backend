const db = require('../../database/connection');

const DEFAULT_USER_ID = '00000000-0000-0000-0000-000000000001';

/**
 * Get all members for a workspace
 */
const getWorkspaceMembers = async (req, res) => {
  try {
    const { workspace_id } = req.params;
    
    const result = await db.query(`
      SELECT 
        wm.id, wm.workspace_id, wm.user_id, wm.role, 
        wm.invited_by, wm.joined_at, wm.last_active,
        u.email, u.full_name, u.avatar_url
      FROM workspace_members wm
      JOIN users u ON wm.user_id = u.id
      WHERE wm.workspace_id = $1
      ORDER BY 
        CASE wm.role 
          WHEN 'owner' THEN 1 
          WHEN 'admin' THEN 2 
          WHEN 'editor' THEN 3 
          WHEN 'test_executor' THEN 4 
          WHEN 'viewer' THEN 5 
        END,
        wm.joined_at DESC
    `, [workspace_id]);

    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows
    });
  } catch (error) {
    console.error('Error fetching workspace members:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch workspace members',
      message: error.message
    });
  }
};

/**
 * Add member to workspace
 */
const addWorkspaceMember = async (req, res) => {
  try {
    const { workspace_id } = req.params;
    const { user_id, email, role = 'viewer' } = req.body;
    const inviter_id = req.user?.id || DEFAULT_USER_ID;

    let targetUserId = user_id;

    // If email is provided instead of user_id, look up user by email
    if (!targetUserId && email) {
      const userResult = await db.query('SELECT id FROM users WHERE email = $1', [email]);
      if (userResult.rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'User not found with the provided email'
        });
      }
      targetUserId = userResult.rows[0].id;
    }

    if (!targetUserId) {
      return res.status(400).json({
        success: false,
        error: 'Either user_id or email is required'
      });
    }

    // Check if user already in workspace
    const existingMember = await db.query(
      'SELECT id FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
      [workspace_id, targetUserId]
    );

    if (existingMember.rows.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'User is already a member of this workspace'
      });
    }

    // Add user to workspace
    const result = await db.query(`
      INSERT INTO workspace_members (
        workspace_id, user_id, role, invited_by, joined_at
      ) VALUES ($1, $2, $3, $4, NOW())
      RETURNING *
    `, [workspace_id, targetUserId, role, inviter_id]);

    // Get user details for response
    const userInfo = await db.query('SELECT email, full_name FROM users WHERE id = $1', [targetUserId]);

    res.status(201).json({
      success: true,
      message: 'Member added to workspace successfully',
      data: {
        ...result.rows[0],
        email: userInfo.rows[0]?.email,
        full_name: userInfo.rows[0]?.full_name
      }
    });
  } catch (error) {
    console.error('Error adding workspace member:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to add workspace member',
      message: error.message
    });
  }
};

/**
 * Update workspace member role
 */
const updateWorkspaceMember = async (req, res) => {
  try {
    const { workspace_id, member_id } = req.params;
    const { role } = req.body;

    if (!role) {
      return res.status(400).json({
        success: false,
        error: 'Role is required'
      });
    }

    // Check valid role
    const validRoles = ['owner', 'admin', 'editor', 'test_executor', 'viewer'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({
        success: false,
        error: `Invalid role. Must be one of: ${validRoles.join(', ')}`
      });
    }

    // Check if trying to update the last owner
    if (role !== 'owner') {
      const ownerCount = await db.query(`
        SELECT COUNT(*) FROM workspace_members 
        WHERE workspace_id = $1 AND role = 'owner'
      `, [workspace_id]);
      
      const memberRole = await db.query(`
        SELECT role FROM workspace_members 
        WHERE id = $1 AND workspace_id = $2
      `, [member_id, workspace_id]);
      
      if (ownerCount.rows[0].count <= 1 && memberRole.rows[0]?.role === 'owner') {
        return res.status(400).json({
          success: false,
          error: 'Cannot change role of the last workspace owner'
        });
      }
    }

    const result = await db.query(`
      UPDATE workspace_members
      SET role = $1, last_active = NOW()
      WHERE id = $2 AND workspace_id = $3
      RETURNING *
    `, [role, member_id, workspace_id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Workspace member not found'
      });
    }

    // Get user details for response
    const userInfo = await db.query('SELECT email, full_name FROM users WHERE id = $1', [result.rows[0].user_id]);

    res.json({
      success: true,
      message: 'Workspace member role updated successfully',
      data: {
        ...result.rows[0],
        email: userInfo.rows[0]?.email,
        full_name: userInfo.rows[0]?.full_name
      }
    });
  } catch (error) {
    console.error('Error updating workspace member:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update workspace member',
      message: error.message
    });
  }
};

/**
 * Remove member from workspace
 */
const removeWorkspaceMember = async (req, res) => {
  try {
    const { workspace_id, member_id } = req.params;

    // Get member details
    const memberInfo = await db.query(`
      SELECT wm.role, wm.user_id, w.owner_id 
      FROM workspace_members wm
      JOIN workspaces w ON wm.workspace_id = w.id
      WHERE wm.id = $1 AND wm.workspace_id = $2
    `, [member_id, workspace_id]);

    if (memberInfo.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Workspace member not found'
      });
    }

    // Check if trying to remove workspace owner
    if (memberInfo.rows[0].role === 'owner') {
      // Count owners
      const ownerCount = await db.query(`
        SELECT COUNT(*) FROM workspace_members 
        WHERE workspace_id = $1 AND role = 'owner'
      `, [workspace_id]);
      
      if (ownerCount.rows[0].count <= 1) {
        return res.status(400).json({
          success: false,
          error: 'Cannot remove the last workspace owner. Transfer ownership first or delete workspace'
        });
      }
    }

    const result = await db.query(
      'DELETE FROM workspace_members WHERE id = $1 AND workspace_id = $2 RETURNING id, user_id',
      [member_id, workspace_id]
    );

    res.json({
      success: true,
      message: 'Member removed from workspace successfully',
      data: result.rows[0]
    });
  } catch (error) {
    console.error('Error removing workspace member:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to remove workspace member',
      message: error.message
    });
  }
};

module.exports = {
  getWorkspaceMembers,
  addWorkspaceMember,
  updateWorkspaceMember,
  removeWorkspaceMember
};