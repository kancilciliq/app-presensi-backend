const axios = require('axios');
const db = require('../config/db');
const { getIo } = require('./socketService');
const { formatJam, formatTanggal, labelZona } = require('./waktuService');

const FONNTE_URL = 'https://api.fonnte.com/send';

// Semua batas di bawah berlaku PER NOMOR PENGIRIM.
const DELAY_MIN = Number(process.env.WA_DELAY_MIN_MS) || 25000;
const DELAY_MAX = Math.max(Number(process.env.WA_DELAY_MAX_MS) || 50000, DELAY_MIN);
const BATCH_MIN = Number(process.env.WA_BATCH_MIN) || 12;
const BATCH_MAX = Math.max(Number(process.env.WA_BATCH_MAX) || 20, BATCH_MIN);
const REST_MIN = Number(process.env.WA_REST_MIN_MS) || 3 * 60 * 1000;
const REST_MAX = Math.max(Number(process.env.WA_REST_MAX_MS) || 6 * 60 * 1000, REST_MIN);
const MAX_PER_HOUR = Number(process.env.WA_MAX_PER_HOUR) || 60;
const MAX_PER_DAY = Number(process.env.WA_MAX_PER_DAY) || 150;
const MAX_ATTEMPTS = Number(process.env.WA_MAX_ATTEMPTS) || 5;
const MAX_AGE_HOURS = Number(process.env.WA_MAX_AGE_HOURS) || 12;           // pesan pulang
const MAX_AGE_MASUK_HOURS = Number(process.env.WA_MAX_AGE_MASUK_HOURS) || 6; // masuk & tidak_scan cepat basi
const PAUSE_MS = Number(process.env.WA_PAUSE_MS) || 60 * 60 * 1000;
const PAUSE_MAX_MS = Number(process.env.WA_PAUSE_MAX_MS) || 8 * 60 * 60 * 1000;
const POLL_MS = 5000; // cek antrean saat kosong

const POLA_PERANGKAT = /disconnect|not connect|device|token|expired|quota|insufficient|limit/i;

const pilih = (arr) => arr[Math.floor(Math.random() * arr.length)];
const acak = (min, max) => Math.floor(min + Math.random() * (max - min + 1));

/* ------------------------- 0. DAFTAR NOMOR PENGIRIM ------------------------- */

// Satu baris wa_pengirim = satu nomor wali kelas yang memegang satu kelas (cocok dengan siswa.kelas).
let cachePengirim = new Map(); // kode -> pengirim (untuk worker)
let cacheKelas = new Map();    // kelas (dinormalkan) -> pengirim (untuk memilih nomor pengirim)
let cacheAt = 0;

const normKelas = (k) => String(k ?? '').trim().toUpperCase().replace(/\s+/g, '');

const muatPengirim = async (paksa = false) => {
  if (!paksa && cachePengirim.size && Date.now() - cacheAt < 60000) return cachePengirim;
  let rows = [];
  try {
    [rows] = await db.query('SELECT kode, nama, kelas, token FROM wa_pengirim WHERE aktif=1');
  } catch (err) {
    console.error('[WA] Gagal membaca tabel wa_pengirim:', err.message);
  }
  cachePengirim = new Map(rows.map((r) => [r.kode, r]));
  cacheKelas = new Map(rows.map((r) => [normKelas(r.kelas), r]));
  cacheAt = Date.now();
  return cachePengirim;
};

// Mengembalikan nomor wali kelas untuk kelas tsb, atau null jika kelas belum terhubung.
// Sengaja tanpa nomor cadangan: pesan hanya boleh keluar dari nomor wali kelas siswa itu.
const tentukanPengirim = async (kelas) => {
  await muatPengirim();
  return cacheKelas.get(normKelas(kelas)) || null;
};

/* ------------------------- 1. MEMASUKKAN KE ANTREAN ------------------------- */

const buatPenutup = (namaPengirim) => pilih([
  `_Pesan ini dikirim otomatis oleh Sistem Presensi MTs. Miftahul Ulum Sidomulyo (${namaPengirim})._`,
  `_Notifikasi otomatis dari Sistem Presensi Sekolah (${namaPengirim})._`,
  `_Terima kasih. Sistem Presensi MTs. Miftahul Ulum Sidomulyo._`
]);

const buatPesan = (nama, waktu, status, jenis, namaPengirim) => {
  const jam = formatJam(waktu);
  const tanggal = formatTanggal(waktu);
  const isPulang = jenis === 'pulang';

  const aksi = isPulang
    ? 'telah dicatat *PULANG* dari sekolah pada'
    : 'telah dicatat *HADIR* pada';

  const pembuka = pilih([
    `Yth. Bapak/Ibu Orang Tua dari *${nama}*,`,
    `Kepada Yth. Bapak/Ibu Orang Tua/Wali dari *${nama}*,`,
    `Yth. Orang Tua/Wali dari *${nama}*,`
  ]);

  let pesan = `*PRESENSI SEKOLAH*\n\n${pembuka}\n\n${pilih(['Putra/Putri Anda', 'Ananda'])} ${aksi}:\n📅 *Tanggal:* ${tanggal}\n🕒 *Waktu:* ${jam} ${labelZona}`;
  if (!isPulang) pesan += `\n📌 *Status:* ${status}`;
  pesan += `\n\n${buatPenutup(namaPengirim)}`;
  return pesan;
};

const buatPesanTidakScan = (nama, waktu, namaPengirim) => {
  const tanggal = formatTanggal(waktu);
  const pembuka = pilih([
    `Yth. Bapak/Ibu Orang Tua dari *${nama}*,`,
    `Kepada Yth. Bapak/Ibu Orang Tua/Wali dari *${nama}*,`
  ]);
  return `*INFORMASI PRESENSI*\n\n${pembuka}\n\n${pilih(['Putra/Putri Anda', 'Ananda'])} belum tercatat melakukan presensi datang pada:\n📅 *Tanggal:* ${tanggal}\n\nJika ananda sakit atau berhalangan hadir, mohon *balas pesan ini* dengan keterangan (sakit/izin). Jika ananda sudah berada di sekolah namun belum scan, mohon informasikan kepada kami.\n\n${buatPenutup(namaPengirim)}`;
};

const simpanAntrean = async (target, pesan, jenis, kodePengirim) => {
  await db.query(
    'INSERT INTO wa_queue (target, pesan, jenis, pengirim) VALUES (?, ?, ?, ?)',
    [target, pesan, jenis, kodePengirim]
  );
};

const bersihkanNomor = (noWa) => String(noWa ?? '').replace(/[\s-]/g, '');

// Notifikasi presensi datang/pulang. Nomor pengirim dipilih otomatis dari kelas siswa (siswa.kelas).
const kirimNotifikasiWA = async (noWa, nama, waktu, status, jenis, kelas) => {
  try {
    const target = bersihkanNomor(noWa);
    if (!target) {
      console.warn(`[WA] Nomor WA orang tua ${nama} kosong, notifikasi dilewati`);
      return;
    }
    const pengirim = await tentukanPengirim(kelas);
    if (!pengirim) {
      console.error(`[WA ERROR] Kelas '${kelas}' (${nama}) belum punya nomor wali kelas aktif di wa_pengirim, notifikasi dilewati`);
      return;
    }
    const pesan = buatPesan(nama, waktu, status, jenis, pengirim.nama);
    await simpanAntrean(target, pesan, jenis, pengirim.kode);
    console.log(`[WA QUEUE] ${jenis} untuk ${nama} masuk antrean (${pengirim.kode})`);
  } catch (err) {
    console.error('[WA ERROR] Gagal memasukkan pesan ke antrean:', err.message);
  }
};

// Notifikasi siswa yang belum/tidak scan datang. Dikirim lewat nomor wali kelas siswa tsb.
const kirimNotifikasiTidakScan = async (noWa, nama, kelas, waktu = new Date()) => {
  try {
    const target = bersihkanNomor(noWa);
    if (!target) {
      console.warn(`[WA] Nomor WA orang tua ${nama} kosong, notifikasi tidak scan dilewati`);
      return;
    }
    // Cegah pesan ganda jika pemeriksaan dijalankan lebih dari sekali dalam sehari
    const [ada] = await db.query(
      "SELECT id FROM wa_queue WHERE target=? AND jenis='tidak_scan' AND created_at >= CURDATE() LIMIT 1",
      [target]
    );
    if (ada.length > 0) return;

    const pengirim = await tentukanPengirim(kelas);
    if (!pengirim) {
      console.error(`[WA ERROR] Kelas '${kelas}' (${nama}) belum punya nomor wali kelas aktif di wa_pengirim, notifikasi tidak scan dilewati`);
      return;
    }
    const pesan = buatPesanTidakScan(nama, waktu, pengirim.nama);
    await simpanAntrean(target, pesan, 'tidak_scan', pengirim.kode);
    console.log(`[WA QUEUE] tidak_scan untuk ${nama} masuk antrean (${pengirim.kode})`);
  } catch (err) {
    console.error('[WA ERROR] Gagal memasukkan pesan tidak scan ke antrean:', err.message);
  }
};

/* ------------------------------ 2. WORKER (satu loop per nomor) ------------------------------ */

let jalan = false;
let pemindaiTimer = null;
let housekeepingTimer = null;
const state = new Map(); // kode -> { timer, pauseSampai, pauseLevel, terputus, sisaBatch }

const getState = (kode) => {
  if (!state.has(kode)) {
    state.set(kode, { timer: null, pauseSampai: 0, pauseLevel: 0, terputus: false, sisaBatch: acak(BATCH_MIN, BATCH_MAX) });
  }
  return state.get(kode);
};

const emitStatus = (payload) => {
  try { getIo().emit('wa_status', payload); } catch (_) { /* socket belum siap */ }
};

const kirimKeFonnte = async (item, token) => {
  try {
    const res = await axios.post(
      FONNTE_URL,
      { target: item.target, message: item.pesan, typing: true },
      { headers: { Authorization: token }, timeout: 20000 }
    );
    const data = res.data || {};
    if (data.status === true) return { ok: true };
    return { ok: false, reason: String(data.reason || data.detail || 'respons Fonnte tidak dikenali') };
  } catch (err) {
    const data = err.response?.data;
    return { ok: false, reason: String(data?.reason || data?.detail || err.message) };
  }
};

const tanganiHasil = async (item, hasil, pengirim, st) => {
  if (hasil.ok) {
    await db.query(
      "UPDATE wa_queue SET status='sent', sent_at=NOW(), attempts=attempts+1, last_error=NULL WHERE id=?",
      [item.id]
    );
    st.pauseLevel = 0;
    if (st.terputus) {
      st.terputus = false;
      emitStatus({ pengirim: pengirim.kode, nama: pengirim.nama, connected: true });
      console.log(`[WA ${pengirim.kode}] Pengiriman pulih kembali`);
    }
    return;
  }

  const alasan = hasil.reason.slice(0, 250);

  // Masalah perangkat/akun: jangan hitung sebagai kegagalan pesan, jeda nomor ini saja
  if (POLA_PERANGKAT.test(hasil.reason)) {
    await db.query("UPDATE wa_queue SET status='pending', last_error=? WHERE id=?", [alasan, item.id]);
    const jeda = Math.min(PAUSE_MS * 2 ** st.pauseLevel, PAUSE_MAX_MS);
    st.pauseLevel += 1;
    st.pauseSampai = Date.now() + jeda;
    if (!st.terputus) {
      st.terputus = true;
      emitStatus({ pengirim: pengirim.kode, nama: pengirim.nama, connected: false, reason: alasan });
    }
    console.error(`[WA ERROR ${pengirim.kode}] Perangkat bermasalah (${alasan}). Nomor ini dijeda ${Math.round(jeda / 60000)} menit.`);
    return;
  }

  // Kegagalan biasa: ulangi dengan jeda bertahap (2, 4, 8, 16 menit ...)
  const percobaan = item.attempts + 1;
  if (percobaan >= MAX_ATTEMPTS) {
    await db.query("UPDATE wa_queue SET status='failed', attempts=?, last_error=? WHERE id=?", [percobaan, alasan, item.id]);
    console.error(`[WA ERROR ${pengirim.kode}] Pesan #${item.id} gagal permanen: ${alasan}`);
  } else {
    const tunda = Math.min(60 * 2 ** percobaan, 1800);
    await db.query(
      "UPDATE wa_queue SET status='pending', attempts=?, last_error=?, next_attempt_at = NOW() + INTERVAL ? SECOND WHERE id=?",
      [percobaan, alasan, tunda, item.id]
    );
    console.error(`[WA ERROR ${pengirim.kode}] Pesan #${item.id} gagal (${alasan}), diulang ${tunda} detik lagi`);
  }
};

const housekeeping = async () => {
  try {
    // pesan yang terjebak di 'sending' (mis. server restart) dikembalikan
    await db.query("UPDATE wa_queue SET status='pending' WHERE status='sending' AND diklaim_at < NOW() - INTERVAL 5 MINUTE");
    // pesan terlalu lama menunggu tidak relevan lagi
    await db.query(
      "UPDATE wa_queue SET status='expired' WHERE status='pending' AND ((jenis IN ('masuk','tidak_scan') AND created_at <= NOW() - INTERVAL ? HOUR) OR (jenis NOT IN ('masuk','tidak_scan') AND created_at <= NOW() - INTERVAL ? HOUR))",
      [MAX_AGE_MASUK_HOURS, MAX_AGE_HOURS]
    );
    // bersihkan riwayat lama
    await db.query("DELETE FROM wa_queue WHERE status IN ('sent','failed','expired') AND created_at < NOW() - INTERVAL 30 DAY");
  } catch (err) {
    console.error('[WA HOUSEKEEPING ERROR]', err.message);
  }
};

const jadwalkan = (kode, ms) => {
  if (jalan) getState(kode).timer = setTimeout(() => tick(kode), ms);
};

const tick = async (kode) => {
  const st = getState(kode);
  let berikutnya = POLL_MS;
  try {
    if (process.env.WA_PAUSED === 'true') { berikutnya = 30000; return; }
    if (Date.now() < st.pauseSampai) { berikutnya = Math.min(st.pauseSampai - Date.now(), 60000); return; }

    const pengirim = (await muatPengirim()).get(kode);
    if (!pengirim || !pengirim.token) { berikutnya = 60000; return; } // dinonaktifkan / token kosong

    // Batas kirim per nomor (rolling 1 jam dan 24 jam)
    const [[stat]] = await db.query(
      "SELECT COUNT(*) AS hari, COALESCE(SUM(sent_at >= NOW() - INTERVAL 1 HOUR), 0) AS jam FROM wa_queue WHERE pengirim=? AND status='sent' AND sent_at >= NOW() - INTERVAL 1 DAY",
      [kode]
    );
    if (Number(stat.jam) >= MAX_PER_HOUR) { berikutnya = 60000; return; }
    if (Number(stat.hari) >= MAX_PER_DAY) { berikutnya = 5 * 60000; return; }

    const [rows] = await db.query(
      "SELECT id, target, pesan, attempts FROM wa_queue WHERE pengirim=? AND status='pending' AND next_attempt_at <= NOW() ORDER BY id LIMIT 1",
      [kode]
    );
    if (rows.length === 0) return;

    const item = rows[0];
    const [klaim] = await db.query(
      "UPDATE wa_queue SET status='sending', diklaim_at=NOW() WHERE id=? AND status='pending'",
      [item.id]
    );
    if (klaim.affectedRows === 0) return;

    const hasil = await kirimKeFonnte(item, pengirim.token);
    await tanganiHasil(item, hasil, pengirim, st);

    berikutnya = acak(DELAY_MIN, DELAY_MAX); // jeda acak antar pesan
    st.sisaBatch -= 1;
    if (st.sisaBatch <= 0) { // istirahat panjang setelah satu batch
      berikutnya = acak(REST_MIN, REST_MAX);
      st.sisaBatch = acak(BATCH_MIN, BATCH_MAX);
    }
  } catch (err) {
    console.error(`[WA WORKER ERROR ${kode}]`, err.message);
    berikutnya = 15000;
  } finally {
    jadwalkan(kode, berikutnya);
  }
};

// Menyalakan loop untuk setiap nomor aktif yang belum punya loop (juga menangkap nomor baru di tabel).
const sinkronPengirim = async () => {
  if (!jalan) return;
  const daftar = await muatPengirim(true);
  for (const kode of daftar.keys()) {
    const st = getState(kode);
    if (!st.timer) {
      console.log(`[WA WORKER] Loop dimulai untuk nomor '${kode}'`);
      jadwalkan(kode, 1000);
    }
  }
};

const mulaiWorkerWA = async () => {
  if (jalan) return;
  jalan = true;
  try {
    await db.query("UPDATE wa_queue SET status='pending' WHERE status='sending'");
  } catch (err) {
    console.error('[WA WORKER] Gagal membaca tabel wa_queue. Sudah menjalankan wa_multi_pengirim.sql?', err.message);
  }
  await sinkronPengirim();
  pemindaiTimer = setInterval(() => sinkronPengirim().catch(() => {}), 60000);
  housekeepingTimer = setInterval(housekeeping, 10 * 60 * 1000);
  tidakScanTimer = setInterval(() => cekJadwalTidakScan().catch(() => {}), 60000);
  console.log(`[WA WORKER] Aktif. ${cachePengirim.size} nomor. Per nomor: jeda ${DELAY_MIN}-${DELAY_MAX} ms, batas ${MAX_PER_HOUR}/jam & ${MAX_PER_DAY}/hari, maks ${MAX_ATTEMPTS} percobaan.`);
};

const hentikanWorkerWA = () => {
  jalan = false;
  clearInterval(pemindaiTimer);
  clearInterval(housekeepingTimer);
  clearInterval(tidakScanTimer);
  for (const st of state.values()) { clearTimeout(st.timer); st.timer = null; }
};

/* -------------------- 3. PEMERIKSAAN SISWA BELUM SCAN -------------------- */

const JAM_TIDAK_SCAN = (process.env.WA_JAM_TIDAK_SCAN || '08:30').trim();       // jam pemeriksaan harian
const HARI_AKTIF = (process.env.WA_HARI_AKTIF || '1,2,3,4,5,6')                 // 0=Minggu ... 6=Sabtu
  .split(',').map((x) => Number(x.trim())).filter((n) => !Number.isNaN(n));
const MIN_HADIR_PERSEN = Number(process.env.WA_MIN_HADIR_PERSEN) || 20;         // di bawah ini dianggap libur/alat rusak
const JENDELA_MENIT = 240;                                                       // lewat 4 jam dari jadwal, hari itu dilewati

let tidakScanTimer = null;
let tidakScanTerakhir = '';

const tanggalLokal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Kirim pesan "belum scan" ke orang tua siswa yang belum punya presensi datang hari ini,
// lewat nomor wali kelas masing-masing. Aman dipanggil berulang (pesan ganda dicegah).
const jalankanPemeriksaanTidakScan = async () => {
  const [[tot]] = await db.query('SELECT COUNT(*) AS total FROM siswa');
  const [[had]] = await db.query(
    'SELECT COUNT(DISTINCT nis) AS hadir FROM presensi WHERE waktu_masuk >= CURDATE() AND waktu_masuk < CURDATE() + INTERVAL 1 DAY'
  );
  const total = Number(tot.total);
  const hadir = Number(had.hadir);
  if (!total) return { dilewati: 'tidak ada data siswa' };
  const persen = (hadir / total) * 100;
  if (persen < MIN_HADIR_PERSEN) {
    console.warn(`[WA TIDAK SCAN] Dilewati: baru ${hadir}/${total} siswa scan hari ini (<${MIN_HADIR_PERSEN}%), dianggap libur atau alat bermasalah`);
    return { dilewati: 'kehadiran terlalu rendah', hadir, total };
  }
  const [rows] = await db.query(
    `SELECT s.nama, s.kelas, s.no_wa_ortu FROM siswa s
     WHERE NOT EXISTS (
       SELECT 1 FROM presensi p
       WHERE p.nis = s.nis AND p.waktu_masuk >= CURDATE() AND p.waktu_masuk < CURDATE() + INTERVAL 1 DAY
     ) ORDER BY s.kelas, s.nama`
  );
  for (const r of rows) await kirimNotifikasiTidakScan(r.no_wa_ortu, r.nama, r.kelas);
  console.log(`[WA TIDAK SCAN] ${rows.length} siswa belum scan (hadir ${hadir}/${total}), pesan dimasukkan ke antrean`);
  return { belum_scan: rows.length, hadir, total };
};

const cekJadwalTidakScan = async () => {
  if (!jalan || process.env.WA_TIDAK_SCAN === 'false') return;
  const now = new Date();
  const hari = tanggalLokal(now);
  if (tidakScanTerakhir === hari || !HARI_AKTIF.includes(now.getDay())) return;
  const [jj, mm] = JAM_TIDAK_SCAN.split(':').map(Number);
  const target = jj * 60 + mm;
  const sekarang = now.getHours() * 60 + now.getMinutes();
  if (sekarang < target) return;
  tidakScanTerakhir = hari; // tandai agar hanya sekali per hari
  if (sekarang > target + JENDELA_MENIT) return; // server baru nyala terlalu siang
  try {
    await jalankanPemeriksaanTidakScan();
  } catch (err) {
    console.error('[WA TIDAK SCAN ERROR]', err.message);
    tidakScanTerakhir = ''; // boleh dicoba lagi pada menit berikutnya
  }
};

// Untuk endpoint admin, mis. GET /api/wa/status (pasang di belakang login)
const statusAntreanWA = async () => {
  const [rows] = await db.query(
    'SELECT pengirim, status, COUNT(*) AS jumlah FROM wa_queue WHERE created_at >= CURDATE() GROUP BY pengirim, status'
  );
  const daftar = await muatPengirim();
  const perPengirim = {};
  const total = {};
  for (const [kode, p] of daftar) {
    const st = getState(kode);
    perPengirim[kode] = {
      nama: p.nama,
      terputus: st.terputus,
      level_jeda: st.pauseLevel,
      lanjut_pukul: Date.now() < st.pauseSampai ? new Date(st.pauseSampai).toISOString() : null,
      hari_ini: {}
    };
  }
  rows.forEach((r) => {
    const jml = Number(r.jumlah);
    total[r.status] = (total[r.status] || 0) + jml;
    if (perPengirim[r.pengirim]) perPengirim[r.pengirim].hari_ini[r.status] = jml;
  });
  const semua = Object.values(perPengirim);
  const lanjut = semua.map((p) => p.lanjut_pukul).filter(Boolean).sort();
  return {
    terputus: semua.some((p) => p.terputus), // kompatibel dengan format lama
    dijeda_manual: process.env.WA_PAUSED === 'true',
    lanjut_pukul: lanjut[0] || null,
    hari_ini: total,
    per_pengirim: perPengirim
  };
};

module.exports = { kirimNotifikasiWA, kirimNotifikasiTidakScan, jalankanPemeriksaanTidakScan, mulaiWorkerWA, hentikanWorkerWA, statusAntreanWA };