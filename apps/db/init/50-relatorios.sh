#!/bin/bash
# Cria o schema "relatorios" (consumo de 12 meses e índices de busca) após o restore.
# Aplicar à mão num banco já existente: pnpm db:relatorios
set -u
DB="${PERF_DB:-geomonitora}"
psql -U "$POSTGRES_USER" -lqt | cut -d'|' -f1 | grep -qw "$DB" || { echo "[relatorios] banco $DB não existe, pulando"; exit 0; }
echo "[relatorios] criando schema relatorios em $DB ..."
psql -U "$POSTGRES_USER" -d "$DB" -v ON_ERROR_STOP=1 -q \
  -f /docker-entrypoint-sql/relatorios.sql && echo "[relatorios] concluído."
