const express = require('express');
const router = express.Router();
const siswaController = require('../controllers/siswaController');

router.get('/', siswaController.getAllSiswa);
router.post('/', siswaController.addSiswa);
router.post('/import', siswaController.bulkImportSiswa);
router.put('/:nis', siswaController.updateSiswa);
router.delete('/:nis', siswaController.deleteSiswa);

module.exports = router;