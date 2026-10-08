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

// Tambah 1 Data Siswa Manual (BARU)
exports.addSiswa = async (req, res) => {
  const { nis, nama, kelas, no_wa_ortu } = req.body;

  // Validasi field kosong
  if (!nis || !nama || !kelas || !no_wa_ortu) {
    return res.status(400).json({ message: 'Semua kolom wajib diisi!' });
  }

  try {
    // 1. Cek apakah NIS sudah ada di database
    const [existing] = await db.query('SELECT nis FROM siswa WHERE nis = ?', [nis]);
    if (existing.length > 0) {
      return res.status(400).json({ message: 'NIS sudah terdaftar!' });
    }

    // 2. Simpan data siswa baru
    const sql = 'INSERT INTO siswa (nis, nama, kelas, no_wa_ortu) VALUES (?, ?, ?, ?)';
    await db.query(sql, [nis, nama, kelas, no_wa_ortu]);

    res.status(201).json({ success: true, message: 'Data siswa berhasil ditambahkan' });
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