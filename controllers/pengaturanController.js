// =====================================================================
// [BARU] controllers/pengaturanController.js
// GET /api/presensi/pengaturan  -> ambil pengaturan jam
// PUT /api/presensi/pengaturan  -> simpan pengaturan jam
// =====================================================================
const { ambilPengaturan, simpanPengaturan, KUNCI } = require('../services/pengaturanService');
const { isJamValid, jamKeMenit, labelZona } = require('../services/waktuService');

exports.getPengaturan = async (req, res) => {
  try {
    const data = await ambilPengaturan();
    res.json({ ...data, zona_waktu: labelZona });
  } catch (err) {
    res.status(500).json({ error: err.message, message: 'Gagal mengambil pengaturan' });
  }
};

exports.updatePengaturan = async (req, res) => {
  const data = {};
  for (const k of KUNCI) {
    const nilai = String(req.body?.[k] ?? '').trim();
    if (!isJamValid(nilai)) {
      return res.status(400).json({ message: `Format jam tidak valid untuk "${k}". Gunakan HH:MM (contoh 07:30).` });
    }
    data[k] = nilai;
  }

  // Urutan harus masuk akal: dibuka -> batas terlambat -> mulai pulang
  const { jam_masuk_mulai: mulai, jam_masuk_batas: batas, jam_pulang_mulai: pulang } = data;
  if (!(jamKeMenit(mulai) < jamKeMenit(batas))) {
    return res.status(400).json({ message: 'Jam masuk dibuka harus lebih awal dari batas tepat waktu.' });
  }
  if (!(jamKeMenit(batas) < jamKeMenit(pulang))) {
    return res.status(400).json({ message: 'Jam pulang harus lebih akhir dari batas tepat waktu.' });
  }

  try {
    await simpanPengaturan(data);
    res.json({ success: true, message: 'Pengaturan jam berhasil disimpan', data: { ...data, zona_waktu: labelZona } });
  } catch (err) {
    res.status(500).json({ error: err.message, message: 'Gagal menyimpan pengaturan' });
  }
};
