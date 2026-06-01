const express = require('express');
const router = express.Router();
const { optionalAuth } = require('../../middleware/auth');

router.get('/', optionalAuth, (req, res) => {
  res.render('members/members', { user: req.user || null });
});



module.exports = router;