#!/usr/bin/env python3
"""
Liga um banco PostGIS ao GeoServer e publica todas as tabelas com geometria.

- Cria o workspace (padrão: nome do banco)
- Cria um datastore PostGIS por schema (o GeoServer só aceita um schema por store)
- Publica cada tabela/view de geometry_columns como camada
  (tabelas com SRID 0/desconhecido recebem o SRS padrão, DEFAULT_SRS)

Idempotente: o que já existe é mantido. Só usa a biblioteca padrão.
Lista as tabelas via `docker exec <container> psql`, então rode na máquina host.

Uso:
  python3 apps/geoserver/scripts/publish_postgis.py            # cria o que falta
  python3 apps/geoserver/scripts/publish_postgis.py --recalc   # + recalcula bbox das existentes

Dica: rode `ANALYZE` no banco antes (logo após um restore), pois o bbox usa estatísticas.
Variáveis de ambiente (com padrões):
  GEOSERVER_URL=http://localhost:8080/geoserver  GEOSERVER_ADMIN_USER=admin
  GEOSERVER_ADMIN_PASSWORD=geoserver  PG_CONTAINER=postgis  PG_HOST=postgis
  PG_PORT=5432  PG_DB=geomonitora  POSTGRES_USER=postgres  POSTGRES_PASSWORD=postgres
  WORKSPACE=<PG_DB>  DEFAULT_SRS=EPSG:31983  EXCLUDE_SCHEMAS=tiger,topology
"""
import base64
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
from collections import defaultdict

env = os.environ.get
GS = env("GEOSERVER_URL", "http://localhost:8080/geoserver").rstrip("/") + "/rest"
AUTH = base64.b64encode(
    f"{env('GEOSERVER_ADMIN_USER', 'admin')}:{env('GEOSERVER_ADMIN_PASSWORD', 'geoserver')}".encode()
).decode()
PG_CONTAINER = env("PG_CONTAINER", "postgis")
PG = {
    "host": env("PG_HOST", "postgis"),
    "port": env("PG_PORT", "5432"),
    "database": env("PG_DB", "geomonitora"),
    "user": env("POSTGRES_USER", "postgres"),
    "passwd": env("POSTGRES_PASSWORD", "postgres"),
}
WORKSPACE = env("WORKSPACE", PG["database"])
DEFAULT_SRS = env("DEFAULT_SRS", "EPSG:31983")
EXCLUDE = set(filter(None, env("EXCLUDE_SCHEMAS", "tiger,topology").split(",")))


def rest(method, path, body=None):
    req = urllib.request.Request(
        GS + path,
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Authorization": f"Basic {AUTH}", "Content-Type": "application/json",
                 "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


def exists(path):
    return rest("GET", path)[0] == 200


def geometry_tables():
    sql = (
        "select f_table_schema, f_table_name, max(srid) from geometry_columns "
        "group by 1, 2 order by 1, 2"
    )
    out = subprocess.run(
        ["docker", "exec", PG_CONTAINER, "psql", "-U", PG["user"], "-d", PG["database"],
         "-tAF", "\t", "-c", sql],
        check=True, capture_output=True, text=True,
    ).stdout
    tables = defaultdict(list)
    for line in out.splitlines():
        schema, table, srid = line.split("\t")
        if schema not in EXCLUDE:
            tables[schema].append((table, int(srid)))
    return tables


def ensure_workspace():
    if not exists(f"/workspaces/{WORKSPACE}"):
        code, msg = rest("POST", "/workspaces", {"workspace": {"name": WORKSPACE}})
        if code != 201:
            sys.exit(f"Falha ao criar workspace: {code} {msg}")
        print(f"workspace '{WORKSPACE}' criado")


def ensure_store(schema):
    if exists(f"/workspaces/{WORKSPACE}/datastores/{schema}"):
        return
    params = {**PG, "dbtype": "postgis", "schema": schema,
              "Expose primary keys": "true", "Estimated extends": "true",
              "Loose bbox": "true", "max connections": "10"}
    body = {"dataStore": {
        "name": schema,
        "connectionParameters": {"entry": [{"@key": k, "$": v} for k, v in params.items()]},
    }}
    code, msg = rest("POST", f"/workspaces/{WORKSPACE}/datastores", body)
    if code != 201:
        raise RuntimeError(f"store {schema}: {code} {msg}")
    print(f"store '{schema}' criado")


def publish(schema, table, srid):
    base = f"/workspaces/{WORKSPACE}/datastores/{schema}/featuretypes"
    name = f"{schema}_{table}"  # evita colisão de nomes entre schemas
    if exists(f"{base}/{name}"):
        if "--recalc" not in sys.argv:
            return "existente"
        code, msg = rest("PUT", f"{base}/{name}?recalculate=nativebbox,latlonbbox",
                         {"featureType": {"name": name}})
        if code != 200:
            raise RuntimeError(f"recalc {code} {msg.strip()[:200]}")
        return "bbox recalculado"
    ft = {"name": name, "nativeName": table, "title": f"{schema}.{table}"}
    if srid in (0, -1) or srid != 31983:
        # SRID ausente ou incomum: força o SRS padrão do projeto
        ft.update({"srs": DEFAULT_SRS, "projectionPolicy": "FORCE_DECLARED"})
    code, msg = rest("POST", base, {"featureType": ft})
    if code != 201:
        raise RuntimeError(f"{code} {msg.strip()[:200]}")
    return "publicada" + (f" (SRID {srid} → {DEFAULT_SRS})" if "srs" in ft else "")


def main():
    ensure_workspace()
    ok, fail = 0, []
    for schema, tables in geometry_tables().items():
        try:
            ensure_store(schema)
        except RuntimeError as e:
            fail.append((schema, "*", str(e)))
            continue
        for table, srid in tables:
            try:
                status = publish(schema, table, srid)
                ok += 1
                print(f"  {schema}.{table}: {status}")
            except RuntimeError as e:
                fail.append((schema, table, str(e)))
                print(f"  {schema}.{table}: ERRO {e}")
    print(f"\n{ok} camadas OK, {len(fail)} falhas")
    for s, t, e in fail:
        print(f"  - {s}.{t}: {e}")


if __name__ == "__main__":
    main()
