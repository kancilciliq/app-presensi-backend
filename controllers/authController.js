const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { buatToken } = require('../middleware/auth');

// Hash palsu: login dengan username yang tidak ada tetap memakan waktu yang sama,
// sehingga penyerang tidak bisa menebak username yang valid dari kecepatan respons.
const HASH_PALSU = bcrypt.hashSync('password-palsu-untuk-timing', 10);

const publik = (u) => ({ id: u.id, username: u.username, nama: u.nama, role: u.role, kelas: u.kelas });
const passwordValid = (p) => typeof p === 'string' && p.length >= 8 && p.length <= 100;

exports.login = async (req, res) => {
  const username = String(req.body?.username ?? '').trim().toLowerCase();
  const password = String(req.body?.password ?? '');
  if (!username || !password) {
    return res.status(400).json({ message: 'Username dan password wajib diisi' });
  }
  if (username.length > 30 || password.length > 100) {
    return res.status(401).json({ message: 'Username atau password salah' });
  }
  try {
    const [rows] = await db.query('SELECT * FROM users WHERE username = ?', [username]);
    const u = rows[0];
    const cocok = await bcrypt.compare(password, u ? u.password_hash : HASH_PALSU);
    if (!u || !cocok) return res.status(401).json({ message: 'Username atau password salah' });
    if (!u.aktif) return res.status(403).json({ message: 'Akun dinonaktifkan. Hubungi admin.' });

    await db.query('UPDATE users SET last_login = NOW() WHERE id = ?', [u.id]);
    res.json({ token: buatToken(u.id), user: publik(u) });
  } catch (err) {
    console.error('[LOGIN ERROR]', err.message);
    res.status(500).json({ message: 'Terjadi kesalahan pada server' });
  }
};

exports.me = (req, res) => res.json({ user: publik(req.user) });

exports.gantiPassword = async (req, res) => {
  const { passwordLama, passwordBaru } = req.body || {};
  if (!passwordLama || !passwordValid(passwordBaru)) {
    return res.status(400).json({ message: 'Password baru minimal 8 karakter' });
  }
  try {
    const [rows] = await db.query('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
    if (!rows[0] || !(await bcrypt.compare(String(passwordLama), rows[0].password_hash))) {
      return res.status(400).json({ message: 'Password lama salah' });
    }
    const hash = await bcrypt.hash(passwordBaru, 10);
    await db.query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, req.user.id]);
    res.json({ message: 'Password berhasil diganti' });
  } catch (err) {
    console.error('[GANTI PASSWORD ERROR]', err.message);
    res.status(500).json({ message: 'Terjadi kesalahan pada server' });
  }
};
