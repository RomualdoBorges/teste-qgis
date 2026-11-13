#!/bin/bash
# Roda apenas na PRIMEIRA subida (volume pgdata vazio).
# Para cada /dumps/<nome>.dump (SQL texto ou formato custom) cria o banco <nome> e restaura.
set -u
shopt -s nullglob

psql -U "$POSTGRES_USER" -d postgres -tc "SELECT 1 FROM pg_roles WHERE rolname='docker'" | grep -q 1 \
  || psql -U "$POSTGRES_USER" -d postgres -c "CREATE ROLE docker LOGIN SUPERUSER PASSWORD '${POSTGRES_PASSWORD}';"

for f in /dumps/*.dump /dumps/*.backup /dumps/*.sql; do
  db=$(basename "${f%.*}")
  echo "[restore] Criando banco '$db' e restaurando $f ..."
  psql -U "$POSTGRES_USER" -d postgres -c "CREATE DATABASE \"$db\" OWNER docker TEMPLATE template0 ENCODING 'UTF8';"

  # cria as roles referenciadas no dump (OWNER TO / GRANT ... TO), sem login
  if head -c 5 "$f" | grep -q '^PGDMP'; then src=(pg_restore -f - "$f"); else src=(cat "$f"); fi
  "${src[@]}" | grep -oE '(OWNER TO|^(GRANT|REVOKE) .* (TO|FROM)) "?[a-z_][a-z0-9_]*"?;' \
    | grep -oE '[a-z_][a-z0-9_]*"?;$' | tr -d '";' | sort -u \
    | grep -vxE 'public|docker|postgres|pg_.*' | while read -r role; do
      echo "[restore] criando role '$role'"
      psql -U "$POSTGRES_USER" -d postgres -c "CREATE ROLE \"$role\" NOLOGIN;" >/dev/null 2>&1 || true
    done

  if head -c 5 "$f" | grep -q '^PGDMP'; then
    pg_restore -U "$POSTGRES_USER" -d "$db" --no-privileges "$f" \
      || echo "[restore] pg_restore terminou com avisos em $f"
  else
    # remove \restrict/\unrestrict (psql >= 16.10) para compatibilidade
    grep -vE '^\\(un)?restrict ' "$f" | psql -q -U "$POSTGRES_USER" -d "$db" \
      || echo "[restore] psql terminou com avisos em $f"
  fi
  echo "[restore] '$db' concluído."
done
