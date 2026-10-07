const axios = require('axios');

const kirimNotifikasiWA = async (noWa, nama, waktu, status) => {
  try {
    const jamStr = new Date(waktu).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
    const pesan = `*PRESENSI SEKOLAH*\n\nYth. Bapak/Ibu Orang Tua dari *${nama}*,\n\nPutra/Putri Anda telah dicatat hadir pada:\n🕒 *Waktu:* ${jamStr} WIB\n📌 *Status:* ${status}\n\n_Pesan ini dikirim otomatis oleh Sistem Absensi Sekolah._`;

    await axios.post('https://api.fonnte.com/send', {
      target: noWa,
      message: pesan
    }, {
      headers: { Authorization: process.env.FONNTE_TOKEN }
    });
    console.log(`[WA LOG] Notifikasi berhasil terkirim ke ${noWa}`);
  } catch (err) {
    console.error('[WA ERROR] Gagal mengirim pesan WA:', err.message);
  }
};

module.exports = { kirimNotifikasiWA };