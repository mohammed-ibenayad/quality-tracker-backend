const express = require('express');
const router = express.Router();
const requirementsController = require('../controllers/requirementsController');
const { authenticateToken, canRead, canWrite, isAdminOrOwner } = require('../middleware/auth');

// All routes require authentication
router.use(authenticateToken);

// GET /api/requirements - Get all requirements (ALL roles can read)
router.get('/', canRead, requirementsController.getAllRequirements);

// GET /api/requirements/:id - Get single requirement (ALL roles can read)
router.get('/:id', canRead, requirementsController.getRequirementById);

// POST /api/requirements - Create new requirement (owner, admin, editor only)
router.post('/', canWrite, requirementsController.createRequirement);

// PUT /api/requirements/:id - Update requirement (owner, admin, editor only)
router.put('/:id', canWrite, requirementsController.updateRequirement);

// DELETE /api/requirements/:id - Delete requirement (owner, admin only)
router.delete('/:id', isAdminOrOwner, requirementsController.deleteRequirement);

module.exports = router;