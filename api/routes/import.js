const express = require('express');
const router = express.Router();
const importController = require('../controllers/importController');

// POST /api/import - Import requirements, test cases, versions, and mappings
router.post('/', importController.importData);

module.exports = router;