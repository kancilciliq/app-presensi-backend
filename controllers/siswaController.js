const db = require('../config/db');

// Ambil Semua Data Siswa
exports.getAllSiswa = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM siswa ORDER BY nama ASC');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Import Massal Data Siswa dari Excel
exports.bulkImportSiswa = async (req, res) => {
  const { dataSiswa } = req.body; // Array dari frontend: [[nis, nama, kelas, no_wa_ortu], ...]
  if (!dataSiswa || !Array.isArray(dataSiswa)) {
    return res.status(400).json({ message: 'Format data tidak valid' });
  }

  try {
    const sql = `
      INSERT INTO siswa (nis, nama, kelas, no_wa_ortu) 
      VALUES ? 
      ON DUPLICATE KEY UPDATE 
        nama = VALUES(nama), 
        kelas = VALUES(kelas), 
        no_wa_ortu = VALUES(no_wa_ortu)
    `;
    await db.query(sql, [dataSiswa]);
    res.json({ success: true, message: 'Data siswa berhasil di-import/diperbarui' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Edit Data Siswa
exports.updateSiswa = async (req, res) => {
  const { nis } = req.params;
  const { nama, kelas, no_wa_ortu } = req.body;

  try {
    await db.query(
      'UPDATE siswa SET nama = ?, kelas = ?, no_wa_ortu = ? WHERE nis = ?',
      [nama, kelas, no_wa_ortu, nis]
    );
    res.json({ success: true, message: 'Data siswa berhasil diperbarui' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Hapus Siswa
exports.deleteSiswa = async (req, res) => {
  const { nis } = req.params;
  try {
    await db.query('DELETE FROM siswa WHERE nis = ?', [nis]);
    res.json({ success: true, message: 'Data siswa berhasil dihapus' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};