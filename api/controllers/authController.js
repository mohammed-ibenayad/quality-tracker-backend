const db = require('../../database/connection');
const jwt = require('jsonwebtoken');

// JWT secret - in production, use environment variable
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const JWT_EXPIRES_IN = '24h';

const authController = {
  /**
   * Login user with email and password
   * POST /api/auth/login
   */
  login: async (req, res) => {
    try {
      const { email, password } = req.body;

      // Validate input
      if (!email || !password) {
        return res.status(400).json({
          success: false,
          error: 'Email and password are required'
        });
      }

      console.log('🔐 Login attempt for:', email);

      // Query user from database
      const result = await db.query(
        `SELECT id, email, full_name, password_hash, is_active, email_verified
         FROM users 
         WHERE email = $1`,
        [email]
      );

      if (result.rows.length === 0) {
        console.log('❌ User not found:', email);
        return res.status(401).json({
          success: false,
          error: 'Invalid email or password'
        });
      }

      const user = result.rows[0];

      // Check if user is active
      if (!user.is_active) {
        console.log('❌ User account is inactive:', email);
        return res.status(401).json({
          success: false,
          error: 'Account is inactive. Please contact support.'
        });
      }

      // Check if password_hash exists
      if (!user.password_hash) {
        console.log('❌ No password set for user:', email);
        return res.status(401).json({
          success: false,
          error: 'No password set for this account. Please contact support.'
        });
      }

      // Verify password using PostgreSQL's crypt function
      const passwordCheck = await db.query(
        `SELECT (password_hash = crypt($1, password_hash)) AS password_match
         FROM users 
         WHERE email = $2`,
        [password, email]
      );

      if (!passwordCheck.rows[0].password_match) {
        console.log('❌ Invalid password for:', email);
        return res.status(401).json({
          success: false,
          error: 'Invalid email or password'
        });
      }

      console.log('✅ Password verified for:', email);

      // Get user's workspaces and roles
      const workspaces = await db.query(
        `SELECT w.id, w.name, w.slug, wm.role
         FROM workspaces w
         JOIN workspace_members wm ON w.id = wm.workspace_id
         WHERE wm.user_id = $1 AND w.is_active = true
         ORDER BY wm.joined_at DESC`,
        [user.id]
      );

      // Update last login
      await db.query(
        'UPDATE users SET last_login = NOW() WHERE id = $1',
        [user.id]
      );

      // Create JWT token
      const token = jwt.sign(
        {
          userId: user.id,
          email: user.email,
          name: user.full_name
        },
        JWT_SECRET,
        { expiresIn: JWT_EXPIRES_IN }
      );

      console.log('✅ Login successful for:', email);

      // Return user data and token
      res.json({
        success: true,
        token,
        user: {
          id: user.id,
          email: user.email,
          name: user.full_name,
          emailVerified: user.email_verified,
          workspaces: workspaces.rows
        }
      });

    } catch (error) {
      console.error('❌ Login error:', error);
      res.status(500).json({
        success: false,
        error: 'Login failed',
        message: error.message
      });
    }
  },

  /**
   * Logout user (mainly client-side, but can be used to invalidate tokens)
   * POST /api/auth/logout
   */
  logout: async (req, res) => {
    try {
      // In a real app with token blacklist, you would add the token to blacklist here
      res.json({
        success: true,
        message: 'Logged out successfully'
      });
    } catch (error) {
      console.error('Logout error:', error);
      res.status(500).json({
        success: false,
        error: 'Logout failed',
        message: error.message
      });
    }
  },

  /**
   * Get current user info from JWT token
   * GET /api/auth/me
   */
  getCurrentUser: async (req, res) => {
    try {
      const authHeader = req.headers.authorization;

      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
          success: false,
          error: 'No token provided'
        });
      }

      const token = authHeader.substring(7);

      // Verify JWT token
      const decoded = jwt.verify(token, JWT_SECRET);

      // Get fresh user data from database
      const result = await db.query(
        `SELECT id, email, full_name, is_active, email_verified
         FROM users 
         WHERE id = $1`,
        [decoded.userId]
      );

      if (result.rows.length === 0) {
        return res.status(401).json({
          success: false,
          error: 'User not found'
        });
      }

      const user = result.rows[0];

      if (!user.is_active) {
        return res.status(401).json({
          success: false,
          error: 'Account is inactive'
        });
      }

      // Get user's workspaces
      const workspaces = await db.query(
        `SELECT w.id, w.name, w.slug, wm.role
         FROM workspaces w
         JOIN workspace_members wm ON w.id = wm.workspace_id
         WHERE wm.user_id = $1 AND w.is_active = true
         ORDER BY wm.joined_at DESC`,
        [user.id]
      );

      res.json({
        success: true,
        user: {
          id: user.id,
          email: user.email,
          name: user.full_name,
          emailVerified: user.email_verified,
          workspaces: workspaces.rows
        }
      });

    } catch (error) {
      if (error.name === 'JsonWebTokenError') {
        return res.status(401).json({
          success: false,
          error: 'Invalid token'
        });
      }
      if (error.name === 'TokenExpiredError') {
        return res.status(401).json({
          success: false,
          error: 'Token expired'
        });
      }

      console.error('Get current user error:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get user info',
        message: error.message
      });
    }
  }
};

module.exports = authController;