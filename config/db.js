const mysql = require('mysql2/promise');
require('dotenv').config();

const DB_USER = (process.env.DB_USER || 'root').trim();
const DB_PASSWORD = (process.env.DB_PASSWORD || '').trim();
const DB_NAME = (process.env.DB_NAME || 'db_sekolah').trim();
const DB_HOST = (process.env.DB_HOST || '127.0.0.1').trim();
const DB_PORT = Number(process.env.DB_PORT || 3306);

const dbConfig = {
  host: DB_HOST,
  port: DB_PORT,
  user: DB_USER,
  password: DB_PASSWORD,
  database: DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
};

const pool = mysql.createPool(dbConfig);

const initDb = async () => {
  try {
    const tempConn = await mysql.createConnection({
      host: DB_HOST,
      port: DB_PORT,
      user: DB_USER,
      password: DB_PASSWORD
    });

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

    console.log(`Database '${DB_NAME}' dan tabel berhasil disiapkan.`);
  } catch (err) {
    console.error('Gagal inisialisasi database:', err);
  }
};

initDb();

module.exports = pool;