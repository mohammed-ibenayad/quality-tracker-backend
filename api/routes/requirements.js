const express = require('express');
const router = express.Router();
const requirementsController = require('../controllers/requirementsController');

// GET /api/requirements - Get all requirements
router.get('/', requirementsController.getAllRequirements);

// GET /api/requirements/:id - Get single requirement
router.get('/:id', requirementsController.getRequirementById);

// POST /api/requirements - Create new requirement
router.post('/', requirementsController.createRequirement);

// PUT /api/requirements/:id - Update requirement
router.put('/:id', requirementsController.updateRequirement);

// DELETE /api/requirements/:id - Delete requirement
router.delete('/:id', requirementsController.deleteRequirement);

module.exports = router;
