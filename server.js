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

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🚀 Backend Server berjalan di http://localhost:${PORT}`);
});