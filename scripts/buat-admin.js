// Membuat akun admin pertama (atau mereset password admin yang lupa password).
// Jalankan dari folder backend:  node scripts/buat-admin.js
const readline = require('readline');
const { Writable } = require('stream');
const bcrypt = require('bcryptjs');
const db = require('../config/db');

const adaTTY = !!process.stdin.isTTY;

// Output "penyaring": bisa dimatikan sementara agar password tidak tampil di layar
let sembunyi = false;
const output = new Writable({
  write(chunk, enc, cb) {
    if (!sembunyi) process.stdout.write(chunk, enc);
    cb();
  },
});

// Satu interface readline untuk semua pertanyaan
const rl = readline.createInterface({
  input: process.stdin,
  output,
  terminal: adaTTY,
});

const tanya = (pertanyaan, rahasia = false) => new Promise((resolve) => {
  rl.question(pertanyaan, (jawab) => {
    if (sembunyi) process.stdout.write('\n');
    sembunyi = false;
    resolve(jawab);
  });
  // Prompt sudah tercetak, baru sembunyikan ketikan user
  if (rahasia && adaTTY) sembunyi = true;
});

(async () => {
  let kode = 0;
  try {
    if (!adaTTY) {
      console.log('(Peringatan: terminal tidak interaktif, password akan terlihat saat diketik.)');
      console.log('(Di Git Bash Windows coba: winpty node scripts/buat-admin.js)\n');
    }

    // 1. Tanya semua input dulu supaya tampilan langsung muncul
    const username = ((await tanya('Username [admin]: ')) || 'admin').trim().toLowerCase();
    if (!/^[a-z0-9._-]{3,30}$/.test(username)) {
      throw new Error('Username 3-30 karakter: huruf kecil, angka, titik, strip, atau garis bawah');
    }

    // 2. Baru hubungkan ke database
    console.log('Menghubungkan ke database...');
    if (db.siap) await db.siap; // tunggu tabel users dibuat oleh db.js

    const [ada] = await db.query('SELECT id, role FROM users WHERE username = ?', [username]);
    if (ada.length) {
      const y = (await tanya(`Username '${username}' sudah ada. Reset password dan aktifkan akun ini? (y/n): `)).trim().toLowerCase();
      if (y !== 'y') throw new Error('Dibatalkan');
    }

    const nama = ada.length ? null : ((await tanya('Nama lengkap [Administrator]: ')) || 'Administrator').trim();
    const pw = await tanya('Password (minimal 8 karakter): ', true);
    const pw2 = await tanya('Ulangi password: ', true);
    if (pw.length < 8 || pw.length > 100) throw new Error('Password harus 8-100 karakter');
    if (pw !== pw2) throw new Error('Kedua password tidak sama');

    const hash = await bcrypt.hash(pw, 10);
    if (ada.length) {
      await db.query("UPDATE users SET password_hash = ?, aktif = 1, role = 'admin', kelas = NULL WHERE id = ?", [hash, ada[0].id]);
      console.log(`Password '${username}' berhasil direset dan akun diaktifkan sebagai admin.`);
    } else {
      await db.query("INSERT INTO users (username, password_hash, nama, role) VALUES (?, ?, ?, 'admin')", [username, hash, nama]);
      console.log(`Admin '${username}' berhasil dibuat.`);
    }
  } catch (err) {
    console.error('Gagal:', err.message);
    kode = 1;
  } finally {
    rl.close();
    process.exit(kode);
  }
})();