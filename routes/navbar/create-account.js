const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  res.render('registration/registration', { error: null });
});

module.exports = router;