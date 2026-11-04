/* =====================================================================
   Presensi per mata pelajaran (status H/I/S/A, jam pelajaran 1-4)
   - Admin     : kelola mapel & penugasan guru, lihat rekap semua kelas
   - Guru      : mengisi presensi untuk mapel/kelas yang ditugaskan kepadanya
   - Wali kelas: melihat rekap kelasnya (dan boleh mengajar jika diberi penugasan)
   ===================================================================== */
const db = require('../config/db');
const { susunRekapBulanan, BULAN_RE } = require('../services/rekapBulananService');

const STATUS = ['H', 'I', 'S', 'A'];
const JAM = [1, 2, 3, 4];
const MAX_MUNDUR = Number(process.env.PRESENSI_MAPEL_MAX_HARI_MUNDUR) || 7; // guru boleh mengisi s.d. N hari ke belakang
const MAX_RENTANG_HARI = 366;
const TGL_RE = /^\d{4}-\d{2}-\d{2}$/;
const PENGAJAR = ['guru', 'wali_kelas'];

const galat = (res, err) => {
  console.error('[MAPEL ERROR]', err.message);
  res.status(500).json({ message: 'Terjadi kesalahan pada server' });
};
const bad = (res, message, code = 400) => res.status(code).json({ message });

// Selisih hari antara hari ini (zona waktu database/sekolah) dan tanggal; null jika tanggal tidak valid
const selisihHari = async (tanggal) => {
  if (!TGL_RE.test(String(tanggal ?? ''))) return null;
  const [r] = await db.query("SELECT DATEDIFF(CURDATE(), STR_TO_DATE(?, '%Y-%m-%d')) AS selisih", [tanggal]);
  const n = r[0]?.selisih;
  return n === null || n === undefined ? null : Number(n);
};

const penugasanMilikku = async (user, id) => {
  const [r] = await db.query(
    `SELECT me.id, me.guru_id, me.mapel_id, me.kelas, m.nama AS mapel
     FROM mengajar me JOIN mapel m ON m.id = me.mapel_id
     WHERE me.id = ? AND me.guru_id = ? AND m.aktif = 1`,
    [id, user.id]
  );
  return r[0] || null;
};

/* ------------------------- ADMIN: master mata pelajaran ------------------------- */

exports.daftarMapelAktif = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT id, nama FROM mapel WHERE aktif = 1 ORDER BY nama');
    res.json(rows);
  } catch (err) { galat(res, err); }
};

exports.daftarMapel = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT m.id, m.nama, m.aktif,
         (SELECT COUNT(*) FROM mengajar me WHERE me.mapel_id = m.id) AS jumlah_penugasan,
         (SELECT COUNT(*) FROM presensi_mapel pm WHERE pm.mapel_id = m.id) AS jumlah_presensi
       FROM mapel m ORDER BY m.nama`
    );
    res.json(rows);
  } catch (err) { galat(res, err); }
};

exports.tambahMapel = async (req, res) => {
  const nama = String(req.body?.nama ?? '').trim();
  if (!nama || nama.length > 100) return bad(res, 'Nama mata pelajaran wajib diisi (maks. 100 karakter)');
  try {
    const [r] = await db.query('INSERT INTO mapel (nama) VALUES (?)', [nama]);
    res.status(201).json({ message: 'Mata pelajaran ditambahkan', id: r.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return bad(res, 'Mata pelajaran dengan nama itu sudah ada', 409);
    galat(res, err);
  }
};

exports.ubahMapel = async (req, res) => {
  const id = Number(req.params.id);
  try {
    const [rows] = await db.query('SELECT id, nama, aktif FROM mapel WHERE id = ?', [id]);
    const t = rows[0];
    if (!t) return bad(res, 'Mata pelajaran tidak ditemukan', 404);
    const nama = String(req.body?.nama ?? t.nama).trim();
    const aktif = req.body?.aktif === undefined ? t.aktif : (req.body.aktif ? 1 : 0);
    if (!nama || nama.length > 100) return bad(res, 'Nama mata pelajaran wajib diisi');
    await db.query('UPDATE mapel SET nama = ?, aktif = ? WHERE id = ?', [nama, aktif, id]);
    res.json({ message: 'Mata pelajaran diperbarui' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return bad(res, 'Mata pelajaran dengan nama itu sudah ada', 409);
    galat(res, err);
  }
};

exports.hapusMapel = async (req, res) => {
  const id = Number(req.params.id);
  try {
    const [rows] = await db.query(
      `SELECT m.id,
         (SELECT COUNT(*) FROM mengajar me WHERE me.mapel_id = m.id) AS jumlah_penugasan,
         (SELECT COUNT(*) FROM presensi_mapel pm WHERE pm.mapel_id = m.id) AS jumlah_presensi
       FROM mapel m WHERE m.id = ?`, [id]);
    const t = rows[0];
    if (!t) return bad(res, 'Mata pelajaran tidak ditemukan', 404);
    if (Number(t.jumlah_penugasan) > 0 || Number(t.jumlah_presensi) > 0) {
      return bad(res, 'Mata pelajaran ini sudah dipakai (penugasan atau riwayat presensi). Nonaktifkan saja.', 409);
    }
    await db.query('DELETE FROM mapel WHERE id = ?', [id]);
    res.json({ message: 'Mata pelajaran dihapus' });
  } catch (err) { galat(res, err); }
};

/* ------------------------- ADMIN: penugasan guru ------------------------- */

exports.daftarPenugasan = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT me.id, me.guru_id, u.nama AS guru, u.role, me.mapel_id, m.nama AS mapel, me.kelas
       FROM mengajar me
       JOIN users u ON u.id = me.guru_id
       JOIN mapel m ON m.id = me.mapel_id
       ORDER BY u.nama, m.nama, me.kelas`
    );
    res.json(rows);
  } catch (err) { galat(res, err); }
};

exports.tambahPenugasan = async (req, res) => {
  const guruId = Number(req.body?.guru_id);
  const mapelId = Number(req.body?.mapel_id);
  const kelas = String(req.body?.kelas ?? '').trim();
  if (!guruId || !mapelId || !kelas) return bad(res, 'Guru, mata pelajaran, dan kelas wajib dipilih');
  try {
    const [g] = await db.query('SELECT id, role, aktif FROM users WHERE id = ?', [guruId]);
    if (!g[0] || !g[0].aktif || !PENGAJAR.includes(g[0].role)) return bad(res, 'Pengguna harus berperan Guru atau Wali Kelas dan berstatus aktif');
    const [m] = await db.query('SELECT id FROM mapel WHERE id = ? AND aktif = 1', [mapelId]);
    if (!m[0]) return bad(res, 'Mata pelajaran tidak ditemukan atau nonaktif');
    const [k] = await db.query('SELECT 1 AS ada FROM siswa WHERE kelas = ? LIMIT 1', [kelas]);
    if (!k[0]) return bad(res, 'Kelas tidak ditemukan di data siswa');
    const [r] = await db.query('INSERT INTO mengajar (guru_id, mapel_id, kelas) VALUES (?, ?, ?)', [guruId, mapelId, kelas]);
    res.status(201).json({ message: 'Penugasan ditambahkan', id: r.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return bad(res, 'Penugasan yang sama sudah ada', 409);
    galat(res, err);
  }
};

exports.hapusPenugasan = async (req, res) => {
  try {
    const [r] = await db.query('DELETE FROM mengajar WHERE id = ?', [Number(req.params.id)]);
    if (!r.affectedRows) return bad(res, 'Penugasan tidak ditemukan', 404);
    res.json({ message: 'Penugasan dihapus (riwayat presensi tetap tersimpan)' });
  } catch (err) { galat(res, err); }
};

/* ------------------------- GURU: mengisi presensi ------------------------- */

// Daftar mapel dan kelas yang saya ajar
exports.saya = async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT me.id AS mengajar_id, me.kelas, m.id AS mapel_id, m.nama AS mapel,
         (SELECT COUNT(*) FROM siswa s WHERE s.kelas = me.kelas) AS jumlah_siswa
       FROM mengajar me JOIN mapel m ON m.id = me.mapel_id
       WHERE me.guru_id = ? AND m.aktif = 1
       ORDER BY m.nama, me.kelas`,
      [req.user.id]
    );
    const peta = new Map();
    for (const r of rows) {
      if (!peta.has(r.mapel_id)) peta.set(r.mapel_id, { mapel_id: r.mapel_id, mapel: r.mapel, kelas: [] });
      peta.get(r.mapel_id).kelas.push({ mengajar_id: r.mengajar_id, kelas: r.kelas, jumlah_siswa: Number(r.jumlah_siswa) });
    }
    res.json([...peta.values()]);
  } catch (err) { galat(res, err); }
};

// Daftar siswa kelas + status yang sudah tersimpan untuk tanggal & jam tertentu
exports.sesi = async (req, res) => {
  try {
    const tugas = await penugasanMilikku(req.user, Number(req.params.id));
    if (!tugas) return bad(res, 'Penugasan tidak ditemukan', 404);
    const tanggal = String(req.query.tanggal ?? '');
    const jam = Number(req.query.jam);
    if (!JAM.includes(jam)) return bad(res, 'Jam pelajaran harus 1 sampai 4');
    if ((await selisihHari(tanggal)) === null) return bad(res, 'Tanggal tidak valid');

    const [siswa] = await db.query(
      `SELECT s.nis, s.nama, pm.status, pm.mapel_id AS pm_mapel, pm.guru_id AS pm_guru,
         EXISTS(SELECT 1 FROM presensi p WHERE p.nis = s.nis
                AND p.waktu_masuk >= ? AND p.waktu_masuk < DATE_ADD(?, INTERVAL 1 DAY)) AS hadir_pagi
       FROM siswa s
       LEFT JOIN presensi_mapel pm ON pm.nis = s.nis AND pm.tanggal = ? AND pm.jam = ?
       WHERE s.kelas = ?
       ORDER BY s.nama`,
      [tanggal, tanggal, tanggal, jam, tugas.kelas]
    );

    // Jam ini sudah diisi oleh guru/mapel lain untuk kelas yang sama?
    const lain = siswa.find((s) => s.status && (s.pm_mapel !== tugas.mapel_id || s.pm_guru !== tugas.guru_id));
    let bentrok = null;
    if (lain) {
      const [b] = await db.query(
        'SELECT m.nama AS mapel, u.nama AS guru FROM mapel m, users u WHERE m.id = ? AND u.id = ?',
        [lain.pm_mapel, lain.pm_guru]
      );
      bentrok = { mapel: b[0]?.mapel || '-', guru: b[0]?.guru || '-' };
    }

    res.json({
      penugasan: { id: tugas.id, mapel: tugas.mapel, kelas: tugas.kelas },
      tanggal, jam, bentrok,
      siswa: siswa.map((s) => ({
        nis: s.nis,
        nama: s.nama,
        status: bentrok ? null : (s.status || null),
        hadir_pagi: !!Number(s.hadir_pagi)
      }))
    });
  } catch (err) { galat(res, err); }
};

// Simpan presensi untuk satu atau beberapa jam sekaligus (status siswa sama untuk semua jam yang dipilih)
exports.simpanSesi = async (req, res) => {
  let conn;
  try {
    const tugas = await penugasanMilikku(req.user, Number(req.params.id));
    if (!tugas) return bad(res, 'Penugasan tidak ditemukan', 404);

    const { tanggal, jam, data } = req.body || {};
    const jamList = [...new Set((Array.isArray(jam) ? jam : [jam]).map(Number))].sort();
    if (!jamList.length || jamList.some((j) => !JAM.includes(j))) return bad(res, 'Jam pelajaran harus berupa angka 1 sampai 4');
    if (!Array.isArray(data) || !data.length) return bad(res, 'Data presensi kosong');

    const selisih = await selisihHari(tanggal);
    if (selisih === null) return bad(res, 'Tanggal tidak valid');
    if (selisih < 0) return bad(res, 'Tidak dapat mengisi presensi untuk tanggal yang belum tiba');
    if (selisih > MAX_MUNDUR) return bad(res, `Presensi hanya dapat diisi sampai ${MAX_MUNDUR} hari ke belakang. Hubungi admin.`);

    const peta = new Map();
    for (const it of data) {
      const nis = String(it?.nis ?? '').trim();
      if (!nis || !STATUS.includes(it?.status)) return bad(res, 'Setiap siswa harus punya status H, I, S, atau A');
      peta.set(nis, it.status);
    }
    const [anggota] = await db.query('SELECT nis FROM siswa WHERE kelas = ?', [tugas.kelas]);
    const sah = new Set(anggota.map((s) => s.nis));
    for (const nis of peta.keys()) if (!sah.has(nis)) return bad(res, `Siswa ${nis} bukan anggota kelas ${tugas.kelas}`);

    // Satu kelas hanya boleh punya satu mapel/guru pada tanggal & jam yang sama
    const [bentrok] = await db.query(
      `SELECT DISTINCT pm.jam, m.nama AS mapel, u.nama AS guru
       FROM presensi_mapel pm
       LEFT JOIN mapel m ON m.id = pm.mapel_id
       LEFT JOIN users u ON u.id = pm.guru_id
       WHERE pm.tanggal = ? AND pm.kelas = ? AND pm.jam IN (?) AND (pm.mapel_id <> ? OR pm.guru_id <> ?)`,
      [tanggal, tugas.kelas, jamList, tugas.mapel_id, tugas.guru_id]
    );
    if (bentrok.length) {
      const b = bentrok[0];
      return bad(res, `Jam ke-${b.jam} kelas ${tugas.kelas} pada tanggal itu sudah diisi oleh ${b.guru || '-'} (${b.mapel || '-'}). Hubungi admin jika perlu diubah.`, 409);
    }

    const baris = [];
    for (const j of jamList) for (const [nis, status] of peta) baris.push([tanggal, j, tugas.kelas, tugas.mapel_id, tugas.guru_id, nis, status]);

    conn = await db.getConnection();
    await conn.beginTransaction();
    await conn.query(
      `INSERT INTO presensi_mapel (tanggal, jam, kelas, mapel_id, guru_id, nis, status) VALUES ?
       ON DUPLICATE KEY UPDATE status = VALUES(status), mapel_id = VALUES(mapel_id), guru_id = VALUES(guru_id), kelas = VALUES(kelas)`,
      [baris]
    );
    await conn.commit();
    res.json({ message: `Presensi ${tugas.mapel} kelas ${tugas.kelas} jam ke-${jamList.join(', ')} tersimpan`, jumlah: peta.size });
  } catch (err) {
    if (conn) { try { await conn.rollback(); } catch { /* abaikan */ } }
    galat(res, err);
  } finally {
    if (conn) conn.release();
  }
};

/* ------------------------- REKAP (admin & wali kelas) ------------------------- */

// Membaca & memvalidasi filter. Wali kelas selalu dipaksa ke kelasnya sendiri.
const filterRekap = (req) => {
  const { mulai, akhir, kelas, mapel_id: mapelId } = req.query;
  if (!TGL_RE.test(String(mulai ?? '')) || !TGL_RE.test(String(akhir ?? ''))) return { error: 'Tanggal mulai dan akhir wajib diisi (YYYY-MM-DD)' };
  if (mulai > akhir) return { error: 'Tanggal mulai tidak boleh setelah tanggal akhir' };
  if ((Date.parse(akhir) - Date.parse(mulai)) / 86400000 > MAX_RENTANG_HARI) return { error: `Rentang tanggal maksimal ${MAX_RENTANG_HARI} hari` };
  let kelasFilter = null;
  if (req.user.role === 'wali_kelas') {
    if (!req.user.kelas) return { kosong: true };
    kelasFilter = req.user.kelas;
  } else if (kelas && kelas !== 'Semua') {
    kelasFilter = String(kelas);
  }
  return { mulai, akhir, kelasFilter, mapelId: Number(mapelId) || null };
};

// Ringkasan per siswa: jumlah H, I, S, A
exports.rekap = async (req, res) => {
  try {
    const f = filterRekap(req);
    if (f.error) return bad(res, f.error);
    if (f.kosong) return res.json([]);
    const jOn = ['pm.nis = s.nis', 'pm.tanggal BETWEEN ? AND ?'];
    const params = [f.mulai, f.akhir];
    if (f.mapelId) { jOn.push('pm.mapel_id = ?'); params.push(f.mapelId); }
    let sql = `SELECT s.nis, s.nama, s.kelas,
        COALESCE(SUM(pm.status = 'H'), 0) AS h, COALESCE(SUM(pm.status = 'I'), 0) AS i,
        COALESCE(SUM(pm.status = 'S'), 0) AS s, COALESCE(SUM(pm.status = 'A'), 0) AS a,
        COUNT(pm.id) AS total
      FROM siswa s LEFT JOIN presensi_mapel pm ON ${jOn.join(' AND ')}`;
    if (f.kelasFilter) { sql += ' WHERE s.kelas = ?'; params.push(f.kelasFilter); }
    sql += ' GROUP BY s.nis, s.nama, s.kelas ORDER BY s.kelas, s.nama';
    const [rows] = await db.query(sql, params);
    res.json(rows.map((r) => ({ ...r, h: Number(r.h), i: Number(r.i), s: Number(r.s), a: Number(r.a), total: Number(r.total) })));
  } catch (err) { galat(res, err); }
};

// Rincian per sesi (tanggal, jam, kelas, mapel, guru)
exports.rekapSesi = async (req, res) => {
  try {
    const f = filterRekap(req);
    if (f.error) return bad(res, f.error);
    if (f.kosong) return res.json([]);
    const where = ['pm.tanggal BETWEEN ? AND ?'];
    const params = [f.mulai, f.akhir];
    if (f.kelasFilter) { where.push('pm.kelas = ?'); params.push(f.kelasFilter); }
    if (f.mapelId) { where.push('pm.mapel_id = ?'); params.push(f.mapelId); }
    const [rows] = await db.query(
      `SELECT DATE_FORMAT(pm.tanggal, '%Y-%m-%d') AS tanggal, pm.jam, pm.kelas, pm.mapel_id, pm.guru_id,
         m.nama AS mapel, u.nama AS guru,
         SUM(pm.status = 'H') AS h, SUM(pm.status = 'I') AS i, SUM(pm.status = 'S') AS s, SUM(pm.status = 'A') AS a,
         COUNT(*) AS total
       FROM presensi_mapel pm
       LEFT JOIN mapel m ON m.id = pm.mapel_id
       LEFT JOIN users u ON u.id = pm.guru_id
       WHERE ${where.join(' AND ')}
       GROUP BY pm.tanggal, pm.jam, pm.kelas, pm.mapel_id, pm.guru_id, m.nama, u.nama
       ORDER BY pm.tanggal DESC, pm.kelas, pm.jam
       LIMIT 1000`,
      params
    );
    res.json(rows.map((r) => ({ ...r, h: Number(r.h), i: Number(r.i), s: Number(r.s), a: Number(r.a), total: Number(r.total) })));
  } catch (err) { galat(res, err); }
};

// Rekap bulanan per siswa (gabungan scan datang, scan pulang, dan presensi mapel).
// Aturan status ada di services/rekapBulananService.js
exports.rekapBulanan = async (req, res) => {
  try {
    const bulan = String(req.query.bulan ?? '');
    if (!BULAN_RE.test(bulan)) return bad(res, 'Bulan wajib diisi dengan format YYYY-MM');
    let kelas = null;
    if (req.user.role === 'wali_kelas') {
      if (!req.user.kelas) return res.json({ bulan, hari: [], siswa: [] });
      kelas = req.user.kelas; // wali kelas selalu dipaksa ke kelasnya sendiri
    } else if (req.query.kelas && req.query.kelas !== 'Semua') {
      kelas = String(req.query.kelas);
    }
    res.json(await susunRekapBulanan({ bulan, kelas }));
  } catch (err) { galat(res, err); }
};

// Admin: hapus satu sesi (mis. salah isi atau bentrok antar guru)
exports.hapusSesi = async (req, res) => {
  const { tanggal, jam, kelas } = req.query;
  const mapelId = Number(req.query.mapel_id);
  const guruId = Number(req.query.guru_id);
  if (!TGL_RE.test(String(tanggal ?? '')) || !JAM.includes(Number(jam)) || !kelas || !mapelId || !guruId) {
    return bad(res, 'Parameter sesi tidak lengkap');
  }
  try {
    const [r] = await db.query(
      'DELETE FROM presensi_mapel WHERE tanggal = ? AND jam = ? AND kelas = ? AND mapel_id = ? AND guru_id = ?',
      [tanggal, Number(jam), String(kelas), mapelId, guruId]
    );
    if (!r.affectedRows) return bad(res, 'Sesi tidak ditemukan', 404);
    res.json({ message: 'Sesi presensi dihapus', jumlah: r.affectedRows });
  } catch (err) { galat(res, err); }
};
