const express = require('express');
const router = express.Router();
const importController = require('../controllers/importController');
const { authenticateToken, canWrite } = require('../middleware/auth');

// All routes require authentication
router.use(authenticateToken);

// POST /api/import - Import requirements, test cases, versions, and mappings
// Only owner, admin, editor can import data
router.post('/', canWrite, importController.importData);

module.exports = router;