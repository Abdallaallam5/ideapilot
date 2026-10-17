'use strict';

const express = require('express');
const pageController = require('../controllers/pageController');

const router = express.Router();
router.get('/', pageController.landing);
router.get('/guide', pageController.guide);

module.exports = router;
