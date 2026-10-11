const db = require('../config/db');
const { getIo } = require('../services/socketService');
const { kirimNotifikasiWA } = require('../services/waService');
// [BARU] pengaturan jam (dari database) + fungsi waktu berzona sekolah
const { ambilPengaturan } = require('../services/pengaturanService');
const { jamKeMenit, menitDalamHari } = require('../services/waktuService');

// Daftar NIS yang sedang diproses. Jika kamera mengirim QR yang sama 2x dalam
// hitungan milidetik, request kedua ditolak sehingga tidak tercatat ganda.
const sedangDiproses = new Set();

/* =====================================================================
   [DIUBAH] scanBarcode - sekarang menangani scan MASUK dan scan PULANG
   dengan satu QR yang sama. Jenis scan ditentukan otomatis oleh jam
   (pengaturan di menu "Pengaturan Jam"):

     sebelum jam_masuk_mulai          -> ditolak (presensi belum dibuka)
     jam_masuk_mulai .. < jam_pulang_mulai
                                      -> scan MASUK (1x per hari)
                                         lewat jam_masuk_batas = Terlambat
     >= jam_pulang_mulai              -> scan PULANG (1x per hari)
                                         wajib sudah scan masuk
   ===================================================================== */
exports.scanBarcode = async (req, res) => {
  const nis = String(req.body?.nis ?? '').trim();
  if (!nis) {
    return res.status(400).json({ message: 'NIS tidak boleh kosong' });
  }

  if (sedangDiproses.has(nis)) {
    return res.status(409).json({ sudah_scan: true, title: 'Mohon Tunggu', message: 'Scan sedang diproses, mohon tunggu sebentar' });
  }
  sedangDiproses.add(nis);

  try {
    // 1. Cari data siswa
    const [siswaRows] = await db.query('SELECT * FROM siswa WHERE nis = ?', [nis]);
    if (siswaRows.length === 0) {
      return res.status(404).json({ title: 'Siswa Tidak Ditemukan', message: 'Siswa tidak ditemukan' });
    }
    const siswa = siswaRows[0];

    // 2. [BARU] Ambil pengaturan jam dari database & tentukan fase sekarang
    const pengaturan = await ambilPengaturan();
    const sekarang = new Date();
    const menitSekarang = menitDalamHari(sekarang); // dihitung di zona waktu sekolah
    const fasePulang = menitSekarang >= jamKeMenit(pengaturan.jam_pulang_mulai);

    // 3. Presensi siswa ini hari ini (jika ada)
    const [rows] = await db.query(
      'SELECT id, waktu_masuk, waktu_pulang, status FROM presensi WHERE nis = ? AND DATE(waktu_masuk) = CURDATE() ORDER BY id DESC LIMIT 1',
      [nis]
    );
    const presensi = rows[0];

    const infoSiswa = { nis: siswa.nis, nama: siswa.nama, kelas: siswa.kelas };

    // 3a. Sudah scan pulang -> tidak boleh lagi
    if (presensi?.waktu_pulang) {
      return res.status(409).json({
        sudah_scan: true,
        kode: 'SUDAH_PULANG',
        title: 'Sudah Scan Pulang',
        message: 'Siswa ini sudah melakukan presensi pulang hari ini.',
        data: { ...infoSiswa, waktu: presensi.waktu_pulang, status: 'Pulang' }
      });
    }

    // ================== FASE PULANG ==================
    if (fasePulang) {
      if (!presensi) {
        return res.status(403).json({
          kode: 'BELUM_SCAN_MASUK',
          title: 'Belum Scan Masuk',
          message: `${siswa.nama} belum melakukan presensi masuk hari ini, sehingga presensi pulang tidak dapat dicatat.`
        });
      }

      // Hanya update jika waktu_pulang masih kosong (aman terhadap scan ganda)
      const [upd] = await db.query(
        'UPDATE presensi SET waktu_pulang = ? WHERE id = ? AND waktu_pulang IS NULL',
        [sekarang, presensi.id]
      );
      if (upd.affectedRows === 0) {
        return res.status(409).json({ sudah_scan: true, kode: 'SUDAH_PULANG', title: 'Sudah Scan Pulang', message: 'Siswa ini sudah melakukan presensi pulang hari ini.' });
      }

      const dataPulang = {
        id: presensi.id,
        jenis: 'pulang',
        ...infoSiswa,
        waktu_masuk: presensi.waktu_masuk,
        waktu_pulang: sekarang,
        status: presensi.status
      };

      getIo().emit('absen_pulang', dataPulang); // [BARU] event realtime untuk scan pulang
      kirimNotifikasiWA(siswa.no_wa_ortu, siswa.nama, sekarang, presensi.status, 'pulang');

      return res.json({ success: true, message: 'Presensi pulang berhasil', data: dataPulang });
    }

    // ================== FASE MASUK ==================
    if (presensi) {
      // Sudah scan masuk, tapi belum waktunya pulang
      return res.status(409).json({
        sudah_scan: true,
        kode: 'SUDAH_MASUK',
        title: 'Sudah Scan Masuk',
        message: `Siswa ini sudah presensi masuk. Scan pulang dibuka mulai pukul ${pengaturan.jam_pulang_mulai}.`,
        data: { ...infoSiswa, waktu: presensi.waktu_masuk, status: presensi.status }
      });
    }

    if (menitSekarang < jamKeMenit(pengaturan.jam_masuk_mulai)) {
      return res.status(403).json({
        kode: 'BELUM_DIBUKA',
        title: 'Presensi Belum Dibuka',
        message: `Presensi masuk baru dibuka pukul ${pengaturan.jam_masuk_mulai}.`
      });
    }

    // Terlambat jika lewat jam_masuk_batas (sama seperti aturan lama, tapi jamnya dari database)
    const status = menitSekarang > jamKeMenit(pengaturan.jam_masuk_batas) ? 'Terlambat' : 'Tepat Waktu';

    const [result] = await db.query(
      'INSERT INTO presensi (nis, waktu_masuk, status) VALUES (?, ?, ?)',
      [nis, sekarang, status]
    );

    const dataAbsen = {
      id: result.insertId,
      jenis: 'masuk',
      ...infoSiswa,
      waktu_masuk: sekarang,
      waktu_pulang: null,
      status
    };

    getIo().emit('absen_baru', dataAbsen);
    kirimNotifikasiWA(siswa.no_wa_ortu, siswa.nama, sekarang, status, 'masuk');

    res.json({ success: true, message: 'Presensi masuk berhasil', data: dataAbsen });
  } catch (err) {
    // Dipakai bila kamu menambah UNIQUE INDEX (nis, tanggal) di database
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ sudah_scan: true, kode: 'SUDAH_MASUK', title: 'Sudah Scan Masuk', message: 'Siswa ini sudah melakukan presensi hari ini.' });
    }
    res.status(500).json({ error: err.message });
  } finally {
    sedangDiproses.delete(nis); // selalu lepas kunci, sukses maupun gagal
  }
};

exports.getPresensiHariIni = async (req, res) => {
  try {
    const sql = `
      SELECT p.id, p.nis, s.nama, s.kelas, p.waktu_masuk, p.waktu_pulang, p.status 
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
      SELECT p.id, p.nis, s.nama, s.kelas, p.waktu_masuk, p.waktu_pulang, p.status 
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