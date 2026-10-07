const express = require('express');
const router = express.Router();
const presensiController = require('../controllers/presensiController');

router.post('/scan', presensiController.scanBarcode);
router.get('/hari-ini', presensiController.getPresensiHariIni);
router.get('/rekap', presensiController.getRekapPresensi);

module.exports = router;