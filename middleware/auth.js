require('dotenv').config();
const jwt = require('jsonwebtoken');
const db = require('../config/db');

const SECRET = process.env.JWT_SECRET || '';
if (SECRET.length < 32) {
  throw new Error('JWT_SECRET belum diatur atau kurang dari 32 karakter. Isi di file .env (lihat panduan).');
}
const EXPIRES = process.env.JWT_EXPIRES || '12h';
const ROLES = ['admin', 'wali_kelas', 'guru'];

// Token hanya berisi id pengguna (sub). Peran & kelas SELALU dibaca dari database,
// sehingga perubahan peran atau penonaktifan akun langsung berlaku tanpa menunggu token habis.
const buatToken = (id) =>
  jwt.sign({}, SECRET, { algorithm: 'HS256', subject: String(id), expiresIn: EXPIRES });

const muatUserDariToken = async (token) => {
  if (!token) return null;
  let payload;
  try {
    payload = jwt.verify(token, SECRET, { algorithms: ['HS256'] });
  } catch {
    return null; // token salah / kedaluwarsa
  }
  const [rows] = await db.query(
    'SELECT id, username, nama, role, kelas, aktif FROM users WHERE id = ?',
    [payload.sub]
  );
  const u = rows[0];
  return u && u.aktif ? u : null;
};

const auth = async (req, res, next) => {
  if (req.method === 'OPTIONS') return next();
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
    const user = await muatUserDariToken(token);
    if (!user) return res.status(401).json({ message: 'Sesi berakhir, silakan login kembali' });
    req.user = user;
    next();
  } catch (err) {
    console.error('[AUTH ERROR]', err.message);
    res.status(500).json({ message: 'Gagal memeriksa sesi login' });
  }
};

const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user?.role)
    ? next()
    : res.status(403).json({ message: 'Anda tidak memiliki akses ke fitur ini' });

module.exports = { ROLES, buatToken, muatUserDariToken, auth, requireRole };
