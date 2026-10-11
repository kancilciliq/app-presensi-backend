// =====================================================================
// [BARU] config/timezone.js
// Menyamakan zona waktu SELURUH aplikasi (Node.js, database, pesan WA).
// Penyebab jam scan dan jam di pesan WA bisa berbeda: server (hosting)
// biasanya memakai zona UTC, sedangkan teks pesan memakai label "WIB".
//
// Zona bisa diganti lewat .env:  TZ_SEKOLAH=Asia/Makassar  (WITA)
//                                TZ_SEKOLAH=Asia/Jayapura (WIT)
// Bila tidak diisi, otomatis Asia/Jakarta (WIB).
// =====================================================================
require('dotenv').config();

const ZONA_WAKTU = (process.env.TZ_SEKOLAH || 'Asia/Jakarta').trim();
process.env.TZ = ZONA_WAKTU; // membuat new Date() & mysql2 memakai zona ini

module.exports = { ZONA_WAKTU };
