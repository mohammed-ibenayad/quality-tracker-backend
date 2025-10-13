const express = require('express');
const router = express.Router();
const testCasesController = require('../controllers/testCasesController');

// GET /api/test-cases - Get all test cases
router.get('/', testCasesController.getAllTestCases);

// GET /api/test-cases/:id - Get single test case
router.get('/:id', testCasesController.getTestCaseById);

// POST /api/test-cases - Create new test case
router.post('/', testCasesController.createTestCase);

// PUT /api/test-cases/:id - Update test case
router.put('/:id', testCasesController.updateTestCase);

// DELETE /api/test-cases/:id - Delete test case
router.delete('/:id', testCasesController.deleteTestCase);

module.exports = router;
