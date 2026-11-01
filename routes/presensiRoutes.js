const express = require('express');
const router = express.Router();
const presensiController = require('../controllers/presensiController');
const pengaturanController = require('../controllers/pengaturanController');
const { requireRole } = require('../middleware/auth');

// Login (auth) sudah dipasang di server.js. Di sini hanya pembatasan per peran.
router.post('/scan', requireRole('admin', 'guru', 'wali_kelas'), presensiController.scanBarcode);
router.get('/hari-ini', requireRole('admin', 'guru', 'wali_kelas'), presensiController.getPresensiHariIni);
router.get('/rekap', requireRole('admin', 'guru', 'wali_kelas'), presensiController.getRekapPresensi);

// Pengaturan jam masuk & pulang: hanya admin
router.get('/pengaturan', requireRole('admin'), pengaturanController.getPengaturan);
router.put('/pengaturan', requireRole('admin'), pengaturanController.updatePengaturan);

module.exports = router;
