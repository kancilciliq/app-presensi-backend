const express = require('express');
const router = express.Router();
const presensiController = require('../controllers/presensiController');
const pengaturanController = require('../controllers/pengaturanController'); // [BARU]

router.post('/scan', presensiController.scanBarcode);
router.get('/hari-ini', presensiController.getPresensiHariIni);
router.get('/rekap', presensiController.getRekapPresensi);

// [BARU] Pengaturan jam masuk & pulang
// (dipasang di router ini supaya tidak perlu mengubah file server utama)
router.get('/pengaturan', pengaturanController.getPengaturan);
router.put('/pengaturan', pengaturanController.updatePengaturan);

module.exports = router;