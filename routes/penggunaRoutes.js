const express = require('express');
const router = express.Router();
const c = require('../controllers/penggunaController');

// Semua route di sini sudah dibatasi untuk admin di server.js
router.get('/', c.daftar);
router.get('/kelas', c.daftarKelas);
router.post('/', c.tambah);
router.put('/:id', c.ubah);
router.put('/:id/password', c.resetPassword);
router.delete('/:id', c.hapus);

module.exports = router;
