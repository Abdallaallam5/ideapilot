'use strict';

const express = require('express');
const pageController = require('../controllers/pageController');

const router = express.Router();
router.get('/', pageController.landing);

module.exports = router;
