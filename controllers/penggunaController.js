const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { ROLES } = require('../middleware/auth');

const USERNAME_RE = /^[a-z0-9._-]{3,30}$/;
const KOLOM = 'id, username, nama, role, kelas, aktif, last_login, created_at';
const passwordValid = (p) => typeof p === 'string' && p.length >= 8 && p.length <= 100;
const galat = (res, err) => {
  console.error('[PENGGUNA ERROR]', err.message);
  res.status(500).json({ message: 'Terjadi kesalahan pada server' });
};
const adminAktifLain = async (idKecuali) => {
  const [r] = await db.query("SELECT COUNT(*) AS n FROM users WHERE role='admin' AND aktif=1 AND id <> ?", [idKecuali]);
  return Number(r[0].n);
};

exports.daftar = async (req, res) => {
  try {
    const [rows] = await db.query(`SELECT ${KOLOM} FROM users ORDER BY FIELD(role,'admin','wali_kelas','guru'), nama`);
    res.json(rows);
  } catch (err) { galat(res, err); }
};

// Daftar kelas yang ada di data siswa (untuk pilihan kelas wali kelas)
exports.daftarKelas = async (req, res) => {
  try {
    const [rows] = await db.query('SELECT DISTINCT kelas FROM siswa ORDER BY kelas');
    res.json(rows.map((r) => r.kelas));
  } catch (err) { galat(res, err); }
};

exports.tambah = async (req, res) => {
  const b = req.body || {};
  const username = String(b.username ?? '').trim().toLowerCase();
  const nama = String(b.nama ?? '').trim();
  const role = b.role;
  const kelas = role === 'wali_kelas' ? String(b.kelas ?? '').trim() : null;

  if (!USERNAME_RE.test(username)) return res.status(400).json({ message: 'Username 3-30 karakter: huruf kecil, angka, titik, strip, atau garis bawah' });
  if (!nama || nama.length > 100) return res.status(400).json({ message: 'Nama wajib diisi (maks. 100 karakter)' });
  if (!ROLES.includes(role)) return res.status(400).json({ message: 'Peran tidak valid' });
  if (role === 'wali_kelas' && !kelas) return res.status(400).json({ message: 'Wali kelas wajib memilih kelas' });
  if (!passwordValid(b.password)) return res.status(400).json({ message: 'Password minimal 8 karakter' });

  try {
    const hash = await bcrypt.hash(b.password, 10);
    const [r] = await db.query(
      'INSERT INTO users (username, password_hash, nama, role, kelas) VALUES (?, ?, ?, ?, ?)',
      [username, hash, nama, role, kelas]
    );
    res.status(201).json({ message: 'Pengguna berhasil ditambahkan', id: r.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ message: 'Username sudah dipakai' });
    galat(res, err);
  }
};

exports.ubah = async (req, res) => {
  const id = Number(req.params.id);
  const b = req.body || {};
  try {
    const [rows] = await db.query('SELECT * FROM users WHERE id = ?', [id]);
    const t = rows[0];
    if (!t) return res.status(404).json({ message: 'Pengguna tidak ditemukan' });

    const nama = String(b.nama ?? t.nama).trim();
    const role = b.role ?? t.role;
    const aktif = b.aktif === undefined ? t.aktif : (b.aktif ? 1 : 0);
    const kelas = role === 'wali_kelas' ? String(b.kelas ?? t.kelas ?? '').trim() : null;

    if (!nama || nama.length > 100) return res.status(400).json({ message: 'Nama wajib diisi' });
    if (!ROLES.includes(role)) return res.status(400).json({ message: 'Peran tidak valid' });
    if (role === 'wali_kelas' && !kelas) return res.status(400).json({ message: 'Wali kelas wajib memilih kelas' });

    if (t.id === req.user.id && (role !== 'admin' || !aktif)) {
      return res.status(400).json({ message: 'Anda tidak dapat mengubah peran atau menonaktifkan akun sendiri' });
    }
    if (t.role === 'admin' && t.aktif && (role !== 'admin' || !aktif) && (await adminAktifLain(t.id)) === 0) {
      return res.status(400).json({ message: 'Harus tersisa minimal satu admin aktif' });
    }

    await db.query('UPDATE users SET nama = ?, role = ?, kelas = ?, aktif = ? WHERE id = ?', [nama, role, kelas, aktif, id]);
    res.json({ message: 'Data pengguna diperbarui' });
  } catch (err) { galat(res, err); }
};

exports.resetPassword = async (req, res) => {
  const id = Number(req.params.id);
  if (!passwordValid(req.body?.password)) return res.status(400).json({ message: 'Password minimal 8 karakter' });
  try {
    const hash = await bcrypt.hash(req.body.password, 10);
    const [r] = await db.query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, id]);
    if (r.affectedRows === 0) return res.status(404).json({ message: 'Pengguna tidak ditemukan' });
    res.json({ message: 'Password berhasil direset' });
  } catch (err) { galat(res, err); }
};

exports.hapus = async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ message: 'Anda tidak dapat menghapus akun sendiri' });
  try {
    const [rows] = await db.query('SELECT role, aktif FROM users WHERE id = ?', [id]);
    const t = rows[0];
    if (!t) return res.status(404).json({ message: 'Pengguna tidak ditemukan' });
    if (t.role === 'admin' && t.aktif && (await adminAktifLain(id)) === 0) {
      return res.status(400).json({ message: 'Harus tersisa minimal satu admin aktif' });
    }
    await db.query('DELETE FROM users WHERE id = ?', [id]);
    res.json({ message: 'Pengguna dihapus' });
  } catch (err) { galat(res, err); }
};
