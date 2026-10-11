// =====================================================================
// [BARU] services/pengaturanService.js
// Membaca/menyimpan pengaturan jam dari tabel `pengaturan` (bukan .env lagi).
// =====================================================================
const db = require('../config/db');

// Nilai bawaan dipakai selama admin belum pernah menyimpan pengaturan.
// jam_masuk_batas masih membaca JAM_MASUK_BATAS di .env agar data lama tetap jalan.
const bawaan = () => ({
  jam_masuk_mulai: '00:00',  // scan masuk mulai dibuka
  jam_masuk_batas: (process.env.JAM_MASUK_BATAS || '07:30').trim(), // lewat jam ini = Terlambat
  jam_pulang_mulai: '13:00'  // scan pulang mulai dibuka (scan masuk ditutup)
});

const KUNCI = Object.keys(bawaan());

const ambilPengaturan = async () => {
  const [rows] = await db.query('SELECT kunci, nilai FROM pengaturan');
  const hasil = bawaan();
  rows.forEach((r) => {
    if (KUNCI.includes(r.kunci)) hasil[r.kunci] = r.nilai;
  });
  return hasil;
};

const simpanPengaturan = async (data) => {
  const values = KUNCI.map((k) => [k, data[k]]);
  await db.query(
    'INSERT INTO pengaturan (kunci, nilai) VALUES ? ON DUPLICATE KEY UPDATE nilai = VALUES(nilai)',
    [values]
  );
};

module.exports = { ambilPengaturan, simpanPengaturan, KUNCI };
