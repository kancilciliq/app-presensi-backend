const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const { auth } = require('../middleware/auth');
const authController = require('../controllers/authController');

// Batasi percobaan login GAGAL: 20 per 15 menit per alamat IP (login berhasil tidak dihitung).
const batasLogin = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { message: 'Terlalu banyak percobaan login. Coba lagi dalam 15 menit.' }
});

router.post('/login', batasLogin, authController.login);
router.get('/me', auth, authController.me);
router.post('/ganti-password', auth, authController.gantiPassword);

module.exports = router;
