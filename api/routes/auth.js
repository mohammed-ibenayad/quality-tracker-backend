const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// POST /api/auth/login - Authenticate user
router.post('/login', authController.login);

// POST /api/auth/logout - Logout user (optional, mainly client-side)
router.post('/logout', authController.logout);

// GET /api/auth/me - Get current user info (requires auth token)
router.get('/me', authController.getCurrentUser);

module.exports = router;