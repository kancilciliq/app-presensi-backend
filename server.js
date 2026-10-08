const express = require('express');
const http = require('http');
const cors = require('cors');
require('dotenv').config();

const socketService = require('./services/socketService');
const siswaRoutes = require('./routes/siswaRoutes');
const presensiRoutes = require('./routes/presensiRoutes');

const app = express();
const server = http.createServer(app);

// Inisialisasi Socket.io
socketService.init(server);

// Middleware
app.use(cors());
app.use(express.json());

// Routes
app.use('/api/siswa', siswaRoutes);
app.use('/api/presensi', presensiRoutes);

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
  console.log(`🚀 Backend Server berjalan di http://localhost:${PORT}`);
});