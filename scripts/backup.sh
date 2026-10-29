#!/usr/bin/env bash
# Copia de seguridad de la base indicada en DATABASE_URL (formato custom de pg_dump).
# Restaurar: pg_restore --clean --no-owner -d "$DATABASE_URL" backups/<archivo>.dump
set -euo pipefail
cd "$(dirname "$0")/.."
set -a; [ -f .env ] && source .env; set +a
mkdir -p backups
file="backups/lobby-$(date +%Y%m%d-%H%M%S).dump"
pg_dump --format=custom --no-owner "$DATABASE_URL" -f "$file"
echo "Copia creada: $file"
# Conservar las últimas 30 copias
ls -1t backups/*.dump | tail -n +31 | xargs -r rm --
