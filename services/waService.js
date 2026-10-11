const axios = require('axios');
// [BARU] Format waktu memakai zona sekolah (bukan zona server)
const { formatJam, formatTanggal, labelZona } = require('./waktuService');

// [DIUBAH] Ditambah parameter `jenis` ('masuk' | 'pulang'). Default 'masuk'
// sehingga pemanggilan lama (4 parameter) tetap berfungsi.
const kirimNotifikasiWA = async (noWa, nama, waktu, status, jenis = 'masuk') => {
  try {
    // [DIUBAH] Sebelumnya: toLocaleTimeString() tanpa timeZone + teks "WIB" ditulis
    // manual -> jam mengikuti zona server (mis. UTC) tetapi tetap berlabel WIB.
    // Sekarang jam, tanggal, dan label zona berasal dari satu sumber yang sama.
    const jam = formatJam(waktu);
    const tanggal = formatTanggal(waktu);
    const isPulang = jenis === 'pulang';

    const aksi = isPulang
      ? 'telah dicatat *PULANG* dari sekolah pada'
      : 'telah dicatat *HADIR* pada';

    let pesan = `*PRESENSI SEKOLAH*\n\nYth. Bapak/Ibu Orang Tua dari *${nama}*,\n\nPutra/Putri Anda ${aksi}:\n📅 *Tanggal:* ${tanggal}\n🕒 *Waktu:* ${jam} ${labelZona}`;
    if (!isPulang) pesan += `\n📌 *Status:* ${status}`; // status terlambat hanya relevan untuk masuk
    pesan += '\n\n_Pesan ini dikirim otomatis oleh Sistem Presensi Sekolah._';

    await axios.post('https://api.fonnte.com/send', {
      target: noWa,
      message: pesan
    }, {
      headers: { Authorization: process.env.FONNTE_TOKEN }
    });
    console.log(`[WA LOG] Notifikasi ${jenis} berhasil terkirim ke ${noWa}`);
  } catch (err) {
    console.error('[WA ERROR] Gagal mengirim pesan WA:', err.message);
  }
};

module.exports = { kirimNotifikasiWA };
