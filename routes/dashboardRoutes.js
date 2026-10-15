'use strict';

const express = require('express');
const dashboard = require('../controllers/dashboardController');
const { requireAuth } = require('../middleware/requireAuth');

const router = express.Router();
router.get('/dashboard', requireAuth, dashboard.show);

module.exports = router;
