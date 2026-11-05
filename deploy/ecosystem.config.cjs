// Konfigurasi PM2 untuk backend App Presensi.
// Jalankan dari folder backend:  pm2 start deploy/ecosystem.config.cjs
//
// PENTING: instances harus tetap 1. Worker WhatsApp dan Socket.io berjalan
// di dalam proses ini; kalau dibuat lebih dari satu, pesan WA bisa terkirim ganda.
const path = require('path');

// Nama proses bisa disesuaikan dengan proses PM2 yang sudah ada:
//   PM2_NAME=backend pm2 start deploy/ecosystem.config.cjs
const PM2_NAME = process.env.PM2_NAME || 'api';

module.exports = {
  apps: [
    {
      name: PM2_NAME,
      cwd: path.resolve(__dirname, '..'),
      script: 'server.js',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      max_memory_restart: '300M',
      time: true,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
