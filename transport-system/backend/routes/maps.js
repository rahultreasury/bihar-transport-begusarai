const express = require('express');
const router = express.Router();

const { calculatePriceHandler } = require('../controllers/mapsController');

// POST /api/calculate-price
router.post('/calculate-price', calculatePriceHandler);

module.exports = router;

