# Panduan Develop & Deploy App Presensi

Panduan ini ditulis untuk yang belum terbiasa dengan server. Ikuti berurutan.
Ganti semua tulisan `<...>` dengan milikmu.

- Domain: `absen.mts-musidomulyo.cloud`
- Folder backend di VPS: `/var/www/backend`
- Folder frontend di VPS: `/var/www/frontend` (hasil build; sumber di `/var/www/frontend-src`)
- OS: Ubuntu 24.04
- Node.js: 22 LTS
- Web server: Nginx
- Process manager backend: PM2
- Database: MySQL

> Jika VPS-mu memakai panel (aaPanel, CyberPanel, cPanel), lewati langkah
> instal Nginx/MySQL yang sudah ada di panel. Sisanya tetap sama.

---

## 0. Informasi yang perlu disiapkan

Isi ini dulu supaya tidak bingung di tengah jalan:

| Data | Nilai |
|---|---|
| IP VPS | `202.155.16.173` |
| Domain | `absen.mts-musidomulyo.cloud` |
| OS VPS | Ubuntu 24.04 |
| Folder backend | `/var/www/backend` |
| Folder frontend | `/var/www/frontend` (web root, isi hasil build) |
| Folder sumber frontend | `/var/www/frontend-src` |
| Nama proses PM2 | `api` |
| Cara deploy | `bash deploy/deploy.sh` di `/var/www/backend` |
| Web server | Nginx |
| Backend dijalankan dengan | PM2 |
| Database | MySQL di VPS yang sama |

Jangan pernah mengirim password server lewat chat. Untuk akses SSH, cukup
tambahkan **public key** (bukan private key) ke VPS.

---

## 1. Menjalankan di komputer sendiri (development)

Prasyarat: Node.js 22 dan MySQL sudah terpasang.

```bash
# Backend
cd app-presensi/backend
cp .env.example .env
# edit .env: isi DB_PASSWORD dan JWT_SECRET
# buat JWT_SECRET:  openssl rand -hex 32
npm ci
npm start

# Terminal lain: frontend
cd app-presensi/frontend
cp .env.example .env
npm ci
npm run dev
```

Buka alamat yang dicetak Vite (biasanya `http://localhost:5173`).

Membuat akun admin pertama:

```bash
cd backend
node scripts/buat-admin.js
```

Database dan tabel dibuat otomatis saat backend pertama kali jalan.

---

## 2. Alur kerja Git yang aman

Repo terpisah:

- `app-presensi-backend` → GitHub `kancilciliq/app-presensi-backend`
- `app-presensi-frontend` → GitHub `kancilciliq/app-presensi-frontend`

Aturan sederhana:

1. `main` = kode yang dipakai di VPS. Jangan push langsung ke `main` untuk perubahan besar.
2. Buat branch: `git checkout -b fitur/nama-fitur`.
3. Commit kecil dan jelas: `git commit -m "tambah filter kelas di rekap"`.
4. Push branch, buka Pull Request. CI akan build otomatis.
5. Setelah CI hijau dan sudah dicoba lokal, merge ke `main`.
6. Di VPS jalankan `deploy.sh` (bagian 4).

Sebelum mulai mengubah kode, selalu:

```bash
git pull
git status
```

Jangan pernah commit `.env`. File itu sudah masuk `.gitignore`.

---

## 3. Deploy pertama ke VPS (sekali saja)

> **VPS kamu sudah berjalan.** Bagian ini hanya referensi. Jangan ulangi
> `git clone`, `certbot`, atau menimpa konfigurasi Nginx yang sudah ada.
> Untuk update rutin, langsung ke bagian 4.

### 3.1 Masuk ke VPS dan update sistem

```bash
ssh deploy@202.155.16.173
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl
```

### 3.2 Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw enable
sudo ufw status
```

### 3.3 Install Node.js 22 dan PM2

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
node -v     # harus v22.x
npm -v
sudo npm install -g pm2
```

### 3.4 Install MySQL dan buat database

```bash
sudo apt install -y mysql-server
sudo systemctl enable --now mysql
sudo mysql
```

Di dalam prompt MySQL:

```sql
CREATE DATABASE absensi CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'absensi_user'@'localhost' IDENTIFIED BY 'PASSWORD_DATABASE_KUAT';
CREATE USER 'absensi_user'@'127.0.0.1' IDENTIFIED BY 'PASSWORD_DATABASE_KUAT';
GRANT ALL PRIVILEGES ON absensi.* TO 'absensi_user'@'localhost';
GRANT ALL PRIVILEGES ON absensi.* TO 'absensi_user'@'127.0.0.1';
FLUSH PRIVILEGES;
EXIT;
```

Dua user dibuat karena koneksi aplikasi lewat `127.0.0.1` (TCP), bukan socket.

Catat password itu untuk `DB_PASSWORD` di `.env`.

### 3.5 Ambil kode aplikasi

```bash
sudo mkdir -p /var/www/backend /var/www/frontend-src
sudo chown -R "$USER":"$USER" /var/www/backend /var/www/frontend-src

git clone https://github.com/kancilciliq/app-presensi-backend.git /var/www/backend
git clone https://github.com/kancilciliq/app-presensi-frontend.git /var/www/frontend-src
```

`/var/www/frontend` adalah folder web root yang dilihat Nginx (hanya berisi hasil
build), bukan repo.

Jika repo private, buat deploy key read-only di VPS:

```bash
ssh-keygen -t ed25519 -C "vps-presensi" -f ~/.ssh/github_presensi -N ""
cat ~/.ssh/github_presensi.pub
```

Salin isi public key ke GitHub → repo → **Settings → Deploy keys → Add deploy key**
(centang read-only, satu key per repo). Lalu:

```bash
cat >> ~/.ssh/config <<'EOF'
Host github.com
  IdentityFile ~/.ssh/github_presensi
EOF
chmod 600 ~/.ssh/config
```

### 3.6 Isi konfigurasi backend

```bash
cd /var/www/backend
cp .env.example .env
nano .env
chmod 600 .env
```

Yang wajib diubah:

```dotenv
DB_USER=absensi_user
DB_PASSWORD=PASSWORD_DATABASE_KUAT
DB_NAME=absensi
JWT_SECRET=hasil_openssl_rand_hex_32
TZ_SEKOLAH=Asia/Jakarta
WA_PAUSED=false
```

Buat `JWT_SECRET`:

```bash
openssl rand -hex 32
```

Untuk frontend, `.env.production` sudah berisi `VITE_API_URL=/api` (satu domain
lewat Nginx). Tidak perlu diubah.

### 3.7 Install dependency dan build frontend

```bash
cd /var/www/backend
npm ci --omit=dev

cd /var/www/frontend-src
npm ci
npm run build
rsync -a --delete --chmod=D755,F644 dist/ /var/www/frontend/
```

Hasil build disalin ke `/var/www/frontend`, sesuai `root` di Nginx.

### 3.8 Jalankan backend dengan PM2

```bash
cd /var/www/backend
pm2 start deploy/ecosystem.config.cjs
pm2 save
pm2 startup
```

> **Di VPS ini prosesnya sudah ada dan bernama `api`.** Untuk update cukup
> `pm2 restart api --update-env`. Jangan membuat proses baru di port 3000.

`pm2 startup` akan mencetak satu perintah `sudo ...`. Jalankan perintah itu agar
aplikasi otomatis hidup setelah VPS reboot.

Cek:

```bash
pm2 status
pm2 logs api --lines 50
curl http://127.0.0.1:3000/api/health
# harus: {"status":"ok",...}
```

### 3.9 Pasang Nginx

```bash
sudo apt install -y nginx
sudo cp /var/www/backend/deploy/nginx.conf.example /etc/nginx/sites-available/presensi
sudo nano /etc/nginx/sites-available/presensi
```

Nilai `server_name` dan `root` di contoh sudah disesuaikan dengan domain dan
folder kamu. Bandingkan dulu dengan konfigurasi yang sedang aktif:

```bash
sudo nginx -T | less
```

Lalu, hanya jika membuat site baru:

```bash
sudo ln -s /etc/nginx/sites-available/presensi /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx
```

Buka `http://absen.mts-musidomulyo.cloud`. Login harus sudah tampil.

### 3.10 Pasang HTTPS gratis

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d absen.mts-musidomulyo.cloud
```

Pilih redirect HTTP → HTTPS. Certbot memperbarui sertifikat otomatis.

---

## 4. Alur update rutin (setiap kali ada perubahan)

Di komputer:

```bash
git add .
git commit -m "jelaskan perubahannya"
git push
```

Di VPS:

```bash
cd /var/www/backend
bash deploy/deploy.sh
```

Skrip itu melakukan:

1. `git pull` backend (`/var/www/backend`) dan sumber frontend (`/var/www/frontend-src`)
2. `npm ci` backend + frontend
3. `npm run build` frontend, lalu `rsync` hasilnya ke `/var/www/frontend`
4. restart PM2 `api`
5. cek `/api/health`; gagal berarti deploy dianggap gagal

Jika ingin manual:

```bash
cd /var/www/backend
git pull
npm ci --omit=dev

cd /var/www/frontend-src
git pull
npm ci
npm run build
rsync -a --delete --chmod=D755,F644 dist/ /var/www/frontend/

pm2 restart api --update-env
```

> Proses PM2 di VPS ini bernama `api`. Kalau nanti namanya berubah, jalankan
> skrip deploy dengan `PM2_NAME=nama-baru bash deploy/deploy.sh` dan ganti
> perintah `pm2 restart` di atas sesuai nama tersebut.

---

## 5. Backup database

Backup adalah hal pertama yang harus ada sebelum mengembangkan fitur.

### 5.1 Siapkan kredensial

Di VPS ini `~/.my.cnf` sudah ada dengan user `absensi_user`. Kalau belum ada:

```bash
nano ~/.my.cnf
```

Isi:

```ini
[client]
user=absensi_user
password=PASSWORD_DATABASE_KUAT
host=127.0.0.1
```

```bash
chmod 600 ~/.my.cnf
```

### 5.2 Coba backup manual

```bash
cd /var/www/backend
bash deploy/backup-db.sh
ls -lh /home/deploy/backups/presensi
```

### 5.3 Jadwalkan harian

```bash
crontab -e
```

Tambahkan:

```cron
0 2 * * * /var/www/backend/deploy/backup-db.sh >> /home/deploy/backups/presensi-backup.log 2>&1
```

Simpan salinan backup juga di luar VPS (Google Drive, komputer sendiri, atau
object storage). Backup yang hanya ada di VPS yang sama bukan backup.

### 5.4 Cara restore

```bash
# PERINGATAN: menimpa data saat ini.
gunzip -c /home/deploy/backups/presensi/absensi-YYYYmmdd-HHMMSS.sql.gz \
  | mysql --defaults-extra-file="$HOME/.my.cnf" absensi
```

---

## 6. Rollback kalau update bermasalah

```bash
cd /var/www/backend
git log --oneline -5

git checkout <commit-yang-masih-bagus>
npm ci --omit=dev
pm2 restart api
```

Frontend:

```bash
cd /var/www/frontend-src
git checkout <commit-yang-masih-bagus>
npm ci
npm run build
rsync -a --delete --chmod=D755,F644 dist/ /var/www/frontend/
```

Jika perubahan menyentuh struktur database, rollback kode saja tidak cukup:
restore backup database (bagian 5.4). Karena itu, **backup dulu sebelum update**
yang mengubah tabel.

---

## 7. Troubleshooting

| Gejala | Yang dicek |
|---|---|
| Halaman 502 Bad Gateway | `pm2 status`, `pm2 logs api --lines 50`, pastikan port 3000 hidup |
| Halaman putih | `sudo tail -100 /var/log/nginx/error.log`, build ulang frontend |
| Login selalu 401 | `JWT_SECRET` berubah? Hapus token lama di browser (localStorage) lalu login ulang |
| Scan jamnya salah | samakan `TZ_SEKOLAH` dan zona waktu MySQL; restart backend |
| Import Excel gagal 413 | `client_max_body_size` di Nginx dan `express.json({ limit })` di backend |
| WA tidak terkirim | `WA_PAUSED=false`, token Fonnte di tabel `wa_pengirim`, cek `pm2 logs` |
| Database connection refused | `sudo systemctl status mysql`, cek `DB_*` di `.env` |
| Port 3000 sudah dipakai | `sudo ss -lptn 'sport = :3000'` lalu hentikan proses lama |
| Perubahan tidak terlihat | hard refresh (Cmd/Ctrl+Shift+R), pastikan `npm run build` sukses |

Log penting:

```bash
pm2 logs api
sudo tail -f /var/log/nginx/access.log
sudo tail -f /var/log/nginx/error.log
```

---

## 8. Checklist keamanan VPS

- [ ] Login SSH pakai key, bukan password
- [ ] `PasswordAuthentication no` dan `PermitRootLogin no` di `/etc/ssh/sshd_config`
- [ ] Firewall hanya membuka 22, 80, 443
- [ ] MySQL hanya listen di `127.0.0.1`
- [ ] `.env` permission `600`, tidak pernah masuk Git
- [ ] HTTPS aktif dan auto-renew
- [ ] Backup harian + salinan di luar VPS
- [ ] `pm2 startup` sudah dijalankan (aplikasi hidup setelah reboot)

---

## 9. Yang belum ada (rencana pengembangan)

Urutan yang saya sarankan:

1. **Test otomatis** untuk endpoint penting (login, scan, rekap) — mencegah bug masuk produksi.
2. **Rapikan lint frontend** (8 error `react-hooks/set-state-in-effect`).
3. **Code splitting** frontend: bundle 2,1 MB karena `xlsx` ikut ter-load di awal.
4. **Auto-deploy** dari GitHub Actions ke VPS setelah CI hijau (opsional, setelah alur manual stabil).
5. **Hapus dependency aneh** `install` dan `npm` dari `backend/package.json`.
6. **Batasi CORS** ke domain sendiri dan tambah `helmet`.
7. **Migrasi database** berversi, jangan hanya `CREATE TABLE IF NOT EXISTS` saat start.
