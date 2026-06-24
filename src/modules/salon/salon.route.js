const express = require('express');
const SalonController = require('./salon.controller');

const router = express.Router();

router.get('/nearby', SalonController.nearby);
router.get('/:id', SalonController.getById);

module.exports = router;