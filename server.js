const express = require('express');
const http = require('http');
const cors = require('cors');
require('dotenv').config();

const socketService = require('./services/socketService');
const { auth, requireRole, muatUserDariToken } = require('./middleware/auth');   // [BARU]
const { aksesSiswa } = require('./middleware/akses');                           // [BARU]
const authRoutes = require('./routes/authRoutes');                              // [BARU]
const penggunaRoutes = require('./routes/penggunaRoutes');                      // [BARU]
const mapelRoutes = require('./routes/mapelRoutes');                            // [BARU]
const siswaRoutes = require('./routes/siswaRoutes');
const presensiRoutes = require('./routes/presensiRoutes');

const app = express();
const server = http.createServer(app);

// [BARU] Di belakang Nginx: pakai IP asli pengunjung (untuk pembatas percobaan login)
app.set('trust proxy', 1);

// Inisialisasi Socket.io
socketService.init(server);

// [BARU] Socket.io hanya untuk pengguna yang login dan berhak scan (admin & guru)
socketService.getIo().use(async (socket, next) => {
  try {
    const user = await muatUserDariToken(socket.handshake.auth?.token);
    if (!user || !['admin', 'guru'].includes(user.role)) return next(new Error('unauthorized'));
    socket.data.user = user;
    next();
  } catch (err) {
    next(new Error('unauthorized'));
  }
});

// Middleware
app.use(cors());
app.use(express.json());

// Routes  [DIUBAH] semua route di bawah /api wajib login, kecuali /api/auth/login
app.use('/api/auth', authRoutes);
app.use('/api/pengguna', auth, requireRole('admin'), penggunaRoutes);
app.use('/api/siswa', auth, aksesSiswa, siswaRoutes);
app.use('/api/presensi', auth, presensiRoutes);
app.use('/api/mapel', auth, mapelRoutes); // [BARU] presensi per mata pelajaran

const PORT = Number(process.env.PORT) || 3000;

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} sudah digunakan. Tutup proses lama atau ganti PORT.`);
    process.exit(1);
  }

  console.error('Server error:', err);
  process.exit(1);
});

server.listen(PORT, () => {
  const { mulaiWorkerWA } = require('./services/waService');
  mulaiWorkerWA();
  console.log(`Backend Server berjalan di http://localhost:${PORT}`);
});