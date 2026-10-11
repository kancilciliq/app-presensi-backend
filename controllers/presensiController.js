const db = require('../config/db');
const { getIo } = require('../services/socketService');
const { kirimNotifikasiWA } = require('../services/waService');

// [BARU] Daftar NIS yang sedang diproses. Jika kamera mengirim QR yang sama
// 2x dalam hitungan milidetik, request kedua ditolak sehingga tidak
// tercatat ganda (race condition).
const sedangDiproses = new Set();

exports.scanBarcode = async (req, res) => {
  // [DIUBAH] NIS dirapikan (trim) & divalidasi dulu
  const nis = String(req.body?.nis ?? '').trim();
  if (!nis) {
    return res.status(400).json({ message: 'NIS tidak boleh kosong' });
  }

  if (sedangDiproses.has(nis)) {
    return res.status(409).json({ sudah_scan: true, message: 'Scan sedang diproses, mohon tunggu sebentar' });
  }
  sedangDiproses.add(nis);

  try {
    // 1. Cari data siswa berdasarkan NIS
    const [siswaRows] = await db.query('SELECT * FROM siswa WHERE nis = ?', [nis]);
    if (siswaRows.length === 0) {
      return res.status(404).json({ message: 'Siswa tidak ditemukan' });
    }
    const siswa = siswaRows[0];

    // 2. Aturan: SATU kali scan per siswa per hari
    // [DIUBAH] Ambil juga waktu & status scan sebelumnya untuk ditampilkan di popup
    const [existingPresensi] = await db.query(
      'SELECT id, waktu_masuk, status FROM presensi WHERE nis = ? AND DATE(waktu_masuk) = CURDATE()',
      [nis]
    );

    if (existingPresensi.length > 0) {
      // [DIUBAH] Status 400 -> 409 (Conflict) + data siswa agar frontend bisa
      // menampilkan popup "Sudah Scan Hari Ini" yang informatif.
      return res.status(409).json({
        sudah_scan: true,
        message: 'Siswa ini sudah melakukan presensi hari ini.',
        data: {
          nis: siswa.nis,
          nama: siswa.nama,
          kelas: siswa.kelas,
          waktu_masuk: existingPresensi[0].waktu_masuk,
          status: existingPresensi[0].status
        }
      });
    }

    const waktuMasuk = new Date();

    // 3. Hitung keterlambatan berdasarkan jam batas di .env
    const jamBatasEnv = process.env.JAM_MASUK_BATAS;
    const [jamBatas, menitBatas] = jamBatasEnv.split(':').map(Number);
    const jamSekarang = waktuMasuk.getHours();
    const menitSekarang = waktuMasuk.getMinutes();

    const status = (jamSekarang > jamBatas || (jamSekarang === jamBatas && menitSekarang > menitBatas))
      ? 'Terlambat'
      : 'Tepat Waktu';

    // 4. Simpan data presensi
    const [result] = await db.query(
      'INSERT INTO presensi (nis, waktu_masuk, status) VALUES (?, ?, ?)',
      [nis, waktuMasuk, status]
    );

    const dataAbsen = {
      id: result.insertId,
      nis: siswa.nis,
      nama: siswa.nama,
      kelas: siswa.kelas,
      waktu_masuk: waktuMasuk,
      status
    };

    // 5. Pancarkan event via WebSocket
    getIo().emit('absen_baru', dataAbsen);

    // 6. Kirim notifikasi WA
    kirimNotifikasiWA(siswa.no_wa_ortu, siswa.nama, waktuMasuk, status);

    res.json({ success: true, message: 'Absensi berhasil', data: dataAbsen });
  } catch (err) {
    // [BARU] Dipakai bila kamu menambah UNIQUE INDEX (nis, tanggal) di database
    // (lihat CATATAN_PERUBAHAN.md) -> database sendiri menolak data ganda.
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ sudah_scan: true, message: 'Siswa ini sudah melakukan presensi hari ini.' });
    }
    res.status(500).json({ error: err.message });
  } finally {
    sedangDiproses.delete(nis); // [BARU] selalu lepas kunci, sukses maupun gagal
  }
};

exports.getPresensiHariIni = async (req, res) => {
  try {
    const sql = `
      SELECT p.id, p.nis, s.nama, s.kelas, p.waktu_masuk, p.status 
      FROM presensi p
      JOIN siswa s ON p.nis = s.nis
      WHERE DATE(p.waktu_masuk) = CURDATE()
      ORDER BY p.waktu_masuk DESC
    `;
    const [rows] = await db.query(sql);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.getRekapPresensi = async (req, res) => {
  const { startDate, endDate, kelas } = req.query;

  try {
    let sql = `
      SELECT p.id, p.nis, s.nama, s.kelas, p.waktu_masuk, p.status 
      FROM presensi p
      JOIN siswa s ON p.nis = s.nis
      WHERE 1=1
    `;
    const params = [];

    if (startDate && endDate) {
      sql += ' AND DATE(p.waktu_masuk) BETWEEN ? AND ?';
      params.push(startDate, endDate);
    }

    if (kelas && kelas !== 'Semua') {
      sql += ' AND s.kelas = ?';
      params.push(kelas);
    }

    sql += ' ORDER BY p.waktu_masuk DESC';

    const [rows] = await db.query(sql, params);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};