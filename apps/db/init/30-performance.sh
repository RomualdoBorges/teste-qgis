#!/bin/bash
# Ajustes de desempenho aplicados após o restore (roda só na primeira subida).
# Idempotente: pode ser executado de novo à mão com
#   docker exec postgis bash /docker-entrypoint-initdb.d/30-performance.sh
set -u
DB="${PERF_DB:-geomonitora}"
psql -U "$POSTGRES_USER" -lqt | cut -d'|' -f1 | grep -qw "$DB" || { echo "[perf] banco $DB não existe, pulando"; exit 0; }
echo "[perf] criando índices espaciais que faltam em $DB ..."
psql -U "$POSTGRES_USER" -d "$DB" <<'SQL'
CREATE INDEX IF NOT EXISTS cart_edificacoes_geometria_gist ON cartografia.cart_edificacoes USING gist (geometria);
CREATE INDEX IF NOT EXISTS ses_sub_bacia_geometria_gist   ON esgoto.ses_sub_bacia        USING gist (geometria);
ANALYZE cartografia.cart_edificacoes;
ANALYZE esgoto.ses_sub_bacia;
SQL
echo "[perf] ANALYZE geral ..."
psql -U "$POSTGRES_USER" -d "$DB" -qc "ANALYZE;" 2>&1 | grep -v WARNING || true
echo "[perf] concluído."
