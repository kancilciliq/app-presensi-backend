const mysql = require('mysql2/promise');
require('dotenv').config();

const DB_USER = process.env.DB_USER || 'root';
const DB_PASSWORD = process.env.DB_PASSWORD || '';
const DB_NAME = process.env.DB_NAME || 'db_sekolah';

// Konfigurasi koneksi utama
const dbConfig = {
  user: DB_USER,
  password: DB_PASSWORD,
  database: DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

// Deteksi otomatis: Gunakan socketPath jika ada di .env (misal Mac XAMPP),
// jika tidak terisi, gunakan port TCP standar (127.0.0.1:3306).
if (process.env.DB_SOCKET_PATH) {
  dbConfig.socketPath = process.env.DB_SOCKET_PATH;
} else {
  dbConfig.host = process.env.DB_HOST || '127.0.0.1';
  dbConfig.port = 3306;
}

const pool = mysql.createPool(dbConfig);

// Inisialisasi Database & Tabel Otomatis
const initDb = async () => {
  try {
    // Konfigurasi koneksi sementara untuk membuat database
    const tempConfig = {
      user: DB_USER,
      password: DB_PASSWORD
    };

    if (process.env.DB_SOCKET_PATH) {
      tempConfig.socketPath = process.env.DB_SOCKET_PATH;
    } else {
      tempConfig.host = process.env.DB_HOST || '127.0.0.1';
      tempConfig.port = 3306;
    }

    const tempConn = await mysql.createConnection(tempConfig);

    // 1. Buat Database jika belum ada
    await tempConn.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\`;`);
    await tempConn.end();

    // 2. Buat Tabel Siswa
    await pool.query(`
      CREATE TABLE IF NOT EXISTS siswa (
        nis VARCHAR(20) PRIMARY KEY,
        nama VARCHAR(100) NOT NULL,
        kelas VARCHAR(20) NOT NULL,
        no_wa_ortu VARCHAR(20) NOT NULL
      );
    `);

    // 3. Buat Tabel Presensi
    await pool.query(`
      CREATE TABLE IF NOT EXISTS presensi (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nis VARCHAR(20) NOT NULL,
        waktu_masuk DATETIME DEFAULT CURRENT_TIMESTAMP,
        status ENUM('Tepat Waktu', 'Terlambat') NOT NULL,
        status_wa ENUM('Pending', 'Terkirim', 'Gagal') DEFAULT 'Pending',
        FOREIGN KEY (nis) REFERENCES siswa(nis) ON DELETE CASCADE
      );
    `);

    console.log(`✅ Database '${DB_NAME}' dan tabel berhasil disiapkan.`);
  } catch (err) {
    console.error('❌ Gagal inisialisasi database:', err);
  }
};

initDb();

module.exports = pool;