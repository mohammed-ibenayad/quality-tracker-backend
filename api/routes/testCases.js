const express = require('express');
const router = express.Router();
const testCasesController = require('../controllers/testCasesController');
const { authenticateToken, canRead, canWrite, isAdminOrOwner } = require('../middleware/auth');

// All routes require authentication
router.use(authenticateToken);

// GET /api/test-cases - Get all test cases (ALL roles can read)
router.get('/', canRead, testCasesController.getAllTestCases);

// GET /api/test-cases/:id - Get single test case (ALL roles can read)
router.get('/:id', canRead, testCasesController.getTestCaseById);

// POST /api/test-cases - Create new test case (owner, admin, editor only)
router.post('/', canWrite, testCasesController.createTestCase);

// PUT /api/test-cases/:id - Update test case (owner, admin, editor only)
router.put('/:id', canWrite, testCasesController.updateTestCase);

// DELETE /api/test-cases/:id - Delete test case (owner, admin only)
router.delete('/:id', isAdminOrOwner, testCasesController.deleteTestCase);

module.exports = router;