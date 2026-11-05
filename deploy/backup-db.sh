#!/usr/bin/env bash
# Backup database harian. Membaca kredensial dari ~/.my.cnf (chmod 600).
#
# Pemakaian:
#   bash deploy/backup-db.sh
#   DB_NAME=absensi BACKUP_DIR=/home/deploy/backups/presensi KEEP_DAYS=14 bash deploy/backup-db.sh
#
# Contoh cron (setiap hari 02:00):
#   0 2 * * * /var/www/backend/deploy/backup-db.sh >> /var/log/presensi-backup.log 2>&1
set -euo pipefail

DB_NAME="${DB_NAME:-absensi}"
BACKUP_DIR="${BACKUP_DIR:-/home/deploy/backups/presensi}"
KEEP_DAYS="${KEEP_DAYS:-14}"

mkdir -p "$BACKUP_DIR"
FILE="$BACKUP_DIR/${DB_NAME}-$(date +%Y%m%d-%H%M%S).sql.gz"

mysqldump \
  --defaults-extra-file="$HOME/.my.cnf" \
  --single-transaction \
  --quick \
  --routines \
  --no-tablespaces \
  "$DB_NAME" | gzip > "$FILE"

find "$BACKUP_DIR" -type f -name "${DB_NAME}-*.sql.gz" -mtime +"$KEEP_DAYS" -delete

echo "Backup selesai: $FILE"
