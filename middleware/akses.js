const { requireRole } = require('./auth');

// Aturan untuk /api/siswa tanpa mengubah siswaController:
//  - GET (baca)  : admin, wali_kelas, guru
//  - selain GET  : hanya admin (tambah, ubah, hapus, import, hapus semua)
//  - wali_kelas  : hasil GET otomatis disaring, hanya siswa kelasnya sendiri
const aksesSiswa = (req, res, next) => {
  const baca = req.method === 'GET' || req.method === 'HEAD';
  if (!baca) return requireRole('admin')(req, res, next);

  const { role, kelas } = req.user;
  if (!['admin', 'wali_kelas', 'guru'].includes(role)) {
    return res.status(403).json({ message: 'Anda tidak memiliki akses ke fitur ini' });
  }

  if (role === 'wali_kelas') {
    if (!kelas) {
      return res.status(403).json({ message: 'Akun wali kelas belum dihubungkan ke kelas. Hubungi admin.' });
    }
    const kirimAsli = res.json.bind(res);
    res.json = (body) => {
      if (Array.isArray(body)) return kirimAsli(body.filter((s) => s && s.kelas === kelas));
      if (body && typeof body === 'object' && 'kelas' in body && body.kelas !== kelas) {
        return res.status(404).json({ message: 'Data tidak ditemukan' });
      }
      return kirimAsli(body);
    };
  }
  next();
};

module.exports = { aksesSiswa };
