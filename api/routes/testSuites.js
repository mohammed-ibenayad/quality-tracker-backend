const express = require('express');
const router = express.Router();
const testSuitesController = require('../controllers/testSuitesController');
const { authenticateToken, canRead, canWrite, isAdminOrOwner } = require('../middleware/auth');

// All routes require authentication
router.use(authenticateToken);

// GET /api/test-suites - Get all test suites (ALL roles can read)
router.get('/', canRead, testSuitesController.getAllTestSuites);

// GET /api/test-suites/:id - Get single test suite (ALL roles can read)
router.get('/:id', canRead, testSuitesController.getTestSuiteById);

// GET /api/test-suites/:id/members - Get test suite members/test cases (ALL roles can read)
router.get('/:id/members', canRead, testSuitesController.getTestSuiteMembers);

// POST /api/test-suites - Create new test suite (owner, admin, editor only)
router.post('/', canWrite, testSuitesController.createTestSuite);

// PUT /api/test-suites/:id - Update test suite (owner, admin, editor only)
router.put('/:id', canWrite, testSuitesController.updateTestSuite);

// POST /api/test-suites/:id/members - Add test cases to suite (owner, admin, editor only)
router.post('/:id/members', canWrite, testSuitesController.addTestCasesToSuite);

// DELETE /api/test-suites/:id/members/:testCaseId - Remove test case from suite (owner, admin, editor only)
router.delete('/:id/members/:testCaseId', canWrite, testSuitesController.removeTestCaseFromSuite);

// DELETE /api/test-suites/:id - Delete test suite (owner, admin only)
router.delete('/:id', isAdminOrOwner, testSuitesController.deleteTestSuite);

module.exports = router;