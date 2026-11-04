const express = require('express');
const router = express.Router();
const c = require('../controllers/mapelController');
const { requireRole } = require('../middleware/auth');

// Login (auth) sudah dipasang di server.js. Di sini pembatasan per peran.

// Admin: kelola mata pelajaran & penugasan guru
router.get('/master', requireRole('admin'), c.daftarMapel);
router.post('/master', requireRole('admin'), c.tambahMapel);
router.put('/master/:id', requireRole('admin'), c.ubahMapel);
router.delete('/master/:id', requireRole('admin'), c.hapusMapel);
router.get('/penugasan', requireRole('admin'), c.daftarPenugasan);
router.post('/penugasan', requireRole('admin'), c.tambahPenugasan);
router.delete('/penugasan/:id', requireRole('admin'), c.hapusPenugasan);

// Guru (dan wali kelas yang diberi penugasan mengajar): mengisi presensi
router.get('/saya', requireRole('guru', 'wali_kelas'), c.saya);
router.get('/sesi/:id', requireRole('guru', 'wali_kelas'), c.sesi);
router.post('/sesi/:id', requireRole('guru', 'wali_kelas'), c.simpanSesi);

// Rekap: admin (semua kelas) & wali kelas (kelasnya sendiri)
router.get('/daftar', requireRole('admin', 'wali_kelas'), c.daftarMapelAktif);
router.get('/rekap', requireRole('admin', 'wali_kelas'), c.rekap);
router.get('/rekap/sesi', requireRole('admin', 'wali_kelas'), c.rekapSesi);
router.get('/rekap/bulanan', requireRole('admin', 'wali_kelas'), c.rekapBulanan);
router.delete('/rekap/sesi', requireRole('admin'), c.hapusSesi);

module.exports = router;
