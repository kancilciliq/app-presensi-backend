// [BARU] Zona waktu harus diatur SEBELUM koneksi database dibuat
require('./timezone');
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

// [BARU] Samakan zona waktu sesi MySQL dengan Node.js. Tanpa ini, CURDATE() /
// NOW() di MySQL bisa berbeda hari/jam dengan waktu yang dicatat aplikasi.
const offsetMenit = -new Date().getTimezoneOffset();
const abs = Math.abs(offsetMenit);
const OFFSET_DB = `${offsetMenit >= 0 ? '+' : '-'}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
pool.pool.on('connection', (conn) => conn.query(`SET time_zone = '${OFFSET_DB}'`));

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

    // [BARU] 4. Tabel pengaturan jam (key-value). Jika kosong, aplikasi memakai
    //    nilai bawaan (jam batas masuk diambil dari JAM_MASUK_BATAS di .env).
    await pool.query(`
      CREATE TABLE IF NOT EXISTS pengaturan (
        kunci VARCHAR(50) PRIMARY KEY,
        nilai VARCHAR(100) NOT NULL
      );
    `);

    // [BARU] 5. Kolom waktu_pulang di tabel presensi (untuk database lama).
    //    MySQL tidak punya "ADD COLUMN IF NOT EXISTS", jadi dicek manual.
    const [kolom] = await pool.query(
      `SELECT COUNT(*) AS jml FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'presensi' AND COLUMN_NAME = 'waktu_pulang'`,
      [DB_NAME]
    );
    if (kolom[0].jml === 0) {
      await pool.query('ALTER TABLE presensi ADD COLUMN waktu_pulang DATETIME NULL DEFAULT NULL AFTER waktu_masuk');
    }

    // [BARU] 6. Antrean WhatsApp + daftar nomor wali kelas (1 nomor per kelas).
    await pool.query(`
      CREATE TABLE IF NOT EXISTS wa_queue (
        id INT AUTO_INCREMENT PRIMARY KEY,
        target VARCHAR(30) NOT NULL,
        pesan TEXT NOT NULL,
        jenis VARCHAR(20) NOT NULL DEFAULT 'masuk',
        pengirim VARCHAR(30) NOT NULL DEFAULT '',
        status ENUM('pending','sending','sent','failed','expired') NOT NULL DEFAULT 'pending',
        attempts INT NOT NULL DEFAULT 0,
        last_error VARCHAR(255) NULL,
        next_attempt_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        diklaim_at DATETIME NULL,
        sent_at DATETIME NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_wa_queue_status (status, next_attempt_at),
        INDEX idx_wa_queue_pengirim (pengirim, status, next_attempt_at)
      );
    `);
    // Untuk wa_queue lama: tambah kolom pengirim, dan pastikan kolom jenis bisa memuat 'tidak_scan'.
    const [kolomPengirim] = await pool.query(
      `SELECT COUNT(*) AS jml FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'wa_queue' AND COLUMN_NAME = 'pengirim'`,
      [DB_NAME]
    );
    if (kolomPengirim[0].jml === 0) {
      await pool.query(`ALTER TABLE wa_queue
        MODIFY COLUMN jenis VARCHAR(20) NOT NULL DEFAULT 'masuk',
        ADD COLUMN pengirim VARCHAR(30) NOT NULL DEFAULT '' AFTER jenis,
        ADD INDEX idx_wa_queue_pengirim (pengirim, status, next_attempt_at)`);
    }
    await pool.query(`
      CREATE TABLE IF NOT EXISTS wa_pengirim (
        kode VARCHAR(30) PRIMARY KEY,
        nama VARCHAR(100) NOT NULL,
        kelas VARCHAR(20) NOT NULL,
        token VARCHAR(100) NOT NULL,
        aktif TINYINT(1) NOT NULL DEFAULT 1,
        UNIQUE KEY uq_wa_pengirim_kelas (kelas)
      );
    `);

    console.log(`Database '${DB_NAME}' dan tabel berhasil disiapkan.`);
  } catch (err) {
    console.error('Gagal inisialisasi database:', err);
  }
};

initDb();

module.exports = pool;