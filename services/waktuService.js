// =====================================================================
// [BARU] services/waktuService.js
// Fungsi bantu waktu. SEMUA perhitungan jam & format pesan memakai zona
// waktu sekolah (config/timezone.js), bukan zona bawaan server.
// =====================================================================
const { ZONA_WAKTU } = require('../config/timezone');

const NAMA_ZONA = { 'Asia/Jakarta': 'WIB', 'Asia/Makassar': 'WITA', 'Asia/Jayapura': 'WIT' };
const labelZona = NAMA_ZONA[ZONA_WAKTU] || ZONA_WAKTU;

// Format jam yang valid: 00:00 - 23:59
const isJamValid = (jam) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(jam));

// '07:30' -> 450 (menit sejak tengah malam)
const jamKeMenit = (jam) => {
  const [h, m] = String(jam).split(':').map(Number);
  return h * 60 + m;
};

// Menit sejak tengah malam untuk sebuah waktu, di zona sekolah
const menitDalamHari = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: ZONA_WAKTU, hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(date);
  const h = Number(parts.find((p) => p.type === 'hour').value);
  const m = Number(parts.find((p) => p.type === 'minute').value);
  return h * 60 + m;
};

// '07:30:15' (dengan detik, sama seperti tampilan di layar scan)
const formatJam = (date) =>
  new Intl.DateTimeFormat('id-ID', {
    timeZone: ZONA_WAKTU, hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).format(new Date(date)).replace(/\./g, ':');

// 'Senin, 12 Oktober 2026'
const formatTanggal = (date) =>
  new Intl.DateTimeFormat('id-ID', {
    timeZone: ZONA_WAKTU, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  }).format(new Date(date));

module.exports = { ZONA_WAKTU, labelZona, isJamValid, jamKeMenit, menitDalamHari, formatJam, formatTanggal };
