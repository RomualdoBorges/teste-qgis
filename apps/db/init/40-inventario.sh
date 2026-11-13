#!/bin/bash
# Cria o schema "inventario" (funções da API de inventário) após o restore.
# Aplicar à mão num banco já existente: pnpm db:inventario
set -u
DB="${PERF_DB:-geomonitora}"
psql -U "$POSTGRES_USER" -lqt | cut -d'|' -f1 | grep -qw "$DB" || { echo "[inventario] banco $DB não existe, pulando"; exit 0; }
echo "[inventario] criando schema inventario em $DB ..."
psql -U "$POSTGRES_USER" -d "$DB" -v ON_ERROR_STOP=1 -q \
  -f /docker-entrypoint-sql/inventario.sql && echo "[inventario] concluído."
