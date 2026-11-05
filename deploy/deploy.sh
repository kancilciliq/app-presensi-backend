#!/usr/bin/env bash
# Deploy/update App Presensi di VPS ini.
#
# Kondisi VPS:
#   backend     : /var/www/backend        (repo git, PM2 name "api")
#   frontend    : /var/www/frontend       (hasil build statis, bukan repo)
#   sumber front: /var/www/frontend-src   (dibuat otomatis saat deploy pertama)
#
# Pemakaian:
#   bash deploy/deploy.sh
#   PM2_NAME=api BRANCH=main bash deploy/deploy.sh
set -euo pipefail

BACKEND_DIR="${BACKEND_DIR:-/var/www/backend}"
FRONTEND_SRC="${FRONTEND_SRC:-/var/www/frontend-src}"
FRONTEND_WEB="${FRONTEND_WEB:-/var/www/frontend}"
FRONTEND_REPO="${FRONTEND_REPO:-https://github.com/kancilciliq/app-presensi-frontend.git}"
BRANCH="${BRANCH:-main}"
PM2_NAME="${PM2_NAME:-api}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/health}"

echo "==> Backend   : $BACKEND_DIR"
echo "==> Frontend  : $FRONTEND_SRC -> $FRONTEND_WEB"
echo "==> PM2       : $PM2_NAME"
echo "==> Branch    : $BRANCH"

# 0. Pastikan proses PM2 ada, agar tidak membuat proses kedua di port 3000.
if ! pm2 describe "$PM2_NAME" >/dev/null 2>&1; then
  echo "!! Proses PM2 '$PM2_NAME' tidak ditemukan."
  pm2 list
  exit 1
fi

# 1. Backend
cd "$BACKEND_DIR"
echo "==> Update backend"
git pull --ff-only origin "$BRANCH"
npm ci --omit=dev

# 2. Frontend (clone sekali, lalu build, lalu salin ke web root)
if [ ! -d "$FRONTEND_SRC/.git" ]; then
  echo "==> Clone frontend ke $FRONTEND_SRC (sekali saja)"
  git clone --branch "$BRANCH" "$FRONTEND_REPO" "$FRONTEND_SRC"
fi

cd "$FRONTEND_SRC"
echo "==> Update frontend"
git pull --ff-only origin "$BRANCH"
npm ci
npm run build

# Simpan hasil build lama sekali saja, untuk jaga-jaga.
if [ ! -d /var/www/frontend-backup-lama ]; then
  cp -a "$FRONTEND_WEB" /var/www/frontend-backup-lama
fi

echo "==> Salin hasil build ke $FRONTEND_WEB"
rsync -a --delete --chmod=D755,F644 "$FRONTEND_SRC/dist/" "$FRONTEND_WEB/"

# 3. Restart backend
echo "==> Restart PM2: $PM2_NAME"
pm2 restart "$PM2_NAME" --update-env
pm2 save

# 4. Tunggu backend siap (maksimal 30 detik)
echo "==> Menunggu backend siap..."
for _ in $(seq 1 15); do
  if curl -fsS "$HEALTH_URL" >/dev/null 2>&1; then
    echo "==> Selesai. Backend sehat: $HEALTH_URL"
    exit 0
  fi
  sleep 2
done

echo "!! Health check gagal: $HEALTH_URL"
echo "   Cek log: pm2 logs $PM2_NAME --lines 50"
exit 1
