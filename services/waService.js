const axios = require('axios');
const db = require('../config/db');
const { getIo } = require('./socketService');
const { formatJam, formatTanggal, labelZona } = require('./waktuService');

const FONNTE_URL = 'https://api.fonnte.com/send';

const DELAY_MIN = Number(process.env.WA_DELAY_MIN_MS) || 6000;
const DELAY_MAX = Math.max(Number(process.env.WA_DELAY_MAX_MS) || 15000, DELAY_MIN);
const MAX_ATTEMPTS = Number(process.env.WA_MAX_ATTEMPTS) || 5;
const MAX_AGE_HOURS = Number(process.env.WA_MAX_AGE_HOURS) || 12;
const PAUSE_MS = Number(process.env.WA_PAUSE_MS) || 10 * 60 * 1000;
const POLL_MS = 5000; // cek antrean saat kosong

const POLA_PERANGKAT = /disconnect|not connect|device|token|expired|quota|insufficient|limit/i;

const pilih = (arr) => arr[Math.floor(Math.random() * arr.length)];
const acak = (min, max) => Math.floor(min + Math.random() * (max - min + 1));

/* ------------------------- 1. MEMASUKKAN KE ANTREAN ------------------------- */

const buatPesan = (nama, waktu, status, jenis) => {
  const jam = formatJam(waktu);
  const tanggal = formatTanggal(waktu);
  const isPulang = jenis === 'pulang';

  const aksi = isPulang
    ? 'telah dicatat *PULANG* dari sekolah pada'
    : 'telah dicatat *HADIR* pada';

  // Sedikit variasi kalimat pembuka/penutup agar pesan tidak identik semua.
  const pembuka = pilih([
    `Yth. Bapak/Ibu Orang Tua dari *${nama}*,`,
    `Kepada Yth. Bapak/Ibu Orang Tua/Wali dari *${nama}*,`,
    `Yth. Orang Tua/Wali dari *${nama}*,`
  ]);
  const penutup = pilih([
    '_Pesan ini dikirim otomatis oleh Sistem Presensi MTs. Miftahul Ulum Sidomulyo._',
    '_Notifikasi otomatis dari Sistem Presensi Sekolah._'
  ]);

  let pesan = `*PRESENSI SEKOLAH*\n\n${pembuka}\n\nPutra/Putri Anda ${aksi}:\n📅 *Tanggal:* ${tanggal}\n🕒 *Waktu:* ${jam} ${labelZona}`;
  if (!isPulang) pesan += `\n📌 *Status:* ${status}`;
  pesan += `\n\n${penutup}`;
  return pesan;
};

const kirimNotifikasiWA = async (noWa, nama, waktu, status, jenis = 'masuk') => {
  try {
    const target = String(noWa ?? '').replace(/[\s-]/g, '');
    if (!target) {
      console.warn(`[WA] Nomor WA orang tua ${nama} kosong, notifikasi dilewati`);
      return;
    }
    const pesan = buatPesan(nama, waktu, status, jenis);
    await db.query('INSERT INTO wa_queue (target, pesan, jenis) VALUES (?, ?, ?)', [target, pesan, jenis]);
    console.log(`[WA QUEUE] ${jenis} untuk ${nama} masuk antrean`);
  } catch (err) {
    console.error('[WA ERROR] Gagal memasukkan pesan ke antrean:', err.message);
  }
};

/* ------------------------------ 2. WORKER ------------------------------ */

let timer = null;
let jalan = false;
let pauseSampai = 0;
let terputus = false;
let housekeepingTerakhir = 0;

const emitStatus = (payload) => {
  try { getIo().emit('wa_status', payload); } catch (_) { /* socket belum siap */ }
};

const kirimKeFonnte = async (item) => {
  try {
    const res = await axios.post(
      FONNTE_URL,
      { target: item.target, message: item.pesan },
      { headers: { Authorization: process.env.FONNTE_TOKEN }, timeout: 20000 }
    );
    const data = res.data || {};
    if (data.status === true) return { ok: true };
    return { ok: false, reason: String(data.reason || data.detail || 'respons Fonnte tidak dikenali') };
  } catch (err) {
    const data = err.response?.data;
    return { ok: false, reason: String(data?.reason || data?.detail || err.message) };
  }
};

const tanganiHasil = async (item, hasil) => {
  if (hasil.ok) {
    await db.query(
      "UPDATE wa_queue SET status='sent', sent_at=NOW(), attempts=attempts+1, last_error=NULL WHERE id=?",
      [item.id]
    );
    if (terputus) {
      terputus = false;
      emitStatus({ connected: true });
      console.log('[WA] Pengiriman pulih kembali');
    }
    return;
  }

  const alasan = hasil.reason.slice(0, 250);

  // Masalah perangkat/akun: jangan hitung sebagai kegagalan pesan, hentikan worker sementara
  if (POLA_PERANGKAT.test(hasil.reason)) {
    await db.query("UPDATE wa_queue SET status='pending', last_error=? WHERE id=?", [alasan, item.id]);
    pauseSampai = Date.now() + PAUSE_MS;
    if (!terputus) {
      terputus = true;
      emitStatus({ connected: false, reason: alasan });
    }
    console.error(`[WA ERROR] Perangkat bermasalah (${alasan}). Pengiriman dijeda ${Math.round(PAUSE_MS / 60000)} menit.`);
    return;
  }

  // Kegagalan biasa: ulangi dengan jeda bertahap (2, 4, 8, 16 menit ...)
  const percobaan = item.attempts + 1;
  if (percobaan >= MAX_ATTEMPTS) {
    await db.query("UPDATE wa_queue SET status='failed', attempts=?, last_error=? WHERE id=?", [percobaan, alasan, item.id]);
    console.error(`[WA ERROR] Pesan #${item.id} gagal permanen: ${alasan}`);
  } else {
    const tunda = Math.min(60 * 2 ** percobaan, 1800);
    await db.query(
      "UPDATE wa_queue SET status='pending', attempts=?, last_error=?, next_attempt_at = NOW() + INTERVAL ? SECOND WHERE id=?",
      [percobaan, alasan, tunda, item.id]
    );
    console.error(`[WA ERROR] Pesan #${item.id} gagal (${alasan}), diulang ${tunda} detik lagi`);
  }
};

const housekeeping = async () => {
  if (Date.now() - housekeepingTerakhir < 10 * 60 * 1000) return;
  housekeepingTerakhir = Date.now();
  // pesan yang terjebak di 'sending' (mis. server restart) dikembalikan
  await db.query("UPDATE wa_queue SET status='pending' WHERE status='sending' AND diklaim_at < NOW() - INTERVAL 5 MINUTE");
  // pesan terlalu lama menunggu tidak relevan lagi
  await db.query("UPDATE wa_queue SET status='expired' WHERE status='pending' AND created_at <= NOW() - INTERVAL ? HOUR", [MAX_AGE_HOURS]);
  // bersihkan riwayat lama
  await db.query("DELETE FROM wa_queue WHERE status IN ('sent','failed','expired') AND created_at < NOW() - INTERVAL 30 DAY");
};

const jadwalkan = (ms) => {
  if (jalan) timer = setTimeout(tick, ms);
};

const tick = async () => {
  let berikutnya = POLL_MS;
  try {
    await housekeeping();

    if (process.env.WA_PAUSED === 'true') { berikutnya = 30000; return; }
    if (Date.now() < pauseSampai) { berikutnya = Math.min(pauseSampai - Date.now(), 60000); return; }

    const [rows] = await db.query(
      "SELECT id, target, pesan, attempts FROM wa_queue WHERE status='pending' AND next_attempt_at <= NOW() ORDER BY id LIMIT 1"
    );
    if (rows.length === 0) return;

    const item = rows[0];
    const [klaim] = await db.query(
      "UPDATE wa_queue SET status='sending', diklaim_at=NOW() WHERE id=? AND status='pending'",
      [item.id]
    );
    if (klaim.affectedRows === 0) return;

    const hasil = await kirimKeFonnte(item);
    await tanganiHasil(item, hasil);

    berikutnya = acak(DELAY_MIN, DELAY_MAX); // jeda acak antar pesan
  } catch (err) {
    console.error('[WA WORKER ERROR]', err.message);
    berikutnya = 15000;
  } finally {
    jadwalkan(berikutnya);
  }
};

const mulaiWorkerWA = async () => {
  if (jalan) return;
  jalan = true;
  try {
    await db.query("UPDATE wa_queue SET status='pending' WHERE status='sending'");
  } catch (err) {
    console.error('[WA WORKER] Gagal membaca tabel wa_queue. Sudah menjalankan wa_queue.sql?', err.message);
  }
  console.log(`[WA WORKER] Aktif. Jeda ${DELAY_MIN}-${DELAY_MAX} ms, maks ${MAX_ATTEMPTS} percobaan.`);
  jadwalkan(1000);
};

const hentikanWorkerWA = () => {
  jalan = false;
  clearTimeout(timer);
};

// Untuk endpoint admin, mis. GET /api/wa/status (pasang di belakang login)
const statusAntreanWA = async () => {
  const [rows] = await db.query(
    'SELECT status, COUNT(*) AS jumlah FROM wa_queue WHERE created_at >= CURDATE() GROUP BY status'
  );
  const hariIni = {};
  rows.forEach((r) => { hariIni[r.status] = Number(r.jumlah); });
  return {
    terputus,
    dijeda_manual: process.env.WA_PAUSED === 'true',
    lanjut_pukul: Date.now() < pauseSampai ? new Date(pauseSampai).toISOString() : null,
    hari_ini: hariIni
  };
};

module.exports = { kirimNotifikasiWA, mulaiWorkerWA, hentikanWorkerWA, statusAntreanWA };