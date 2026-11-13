#!/usr/bin/env python3
"""
Gerencia o cache de tiles (GeoWebCache) das camadas estáticas servidas por WMTS.

A lista de camadas vem de CACHED_LAYERS em apps/web/src/config/layers.ts.

Uso:
  python3 apps/geoserver/scripts/cache.py seed     [camada ...] [--zmin 10] [--zmax 18]
  python3 apps/geoserver/scripts/cache.py truncate [camada ...]   # limpa (use quando os dados mudarem)
  python3 apps/geoserver/scripts/cache.py status                  # tarefas em andamento

Sem camadas = todas de CACHED_LAYERS. Camada no formato "schema.tabela" ou nome WMS.
Tiles fora do intervalo de zoom pré-gerado são criados sob demanda e também ficam em cache.
"""
import argparse
import base64
import json
import math
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

env = os.environ.get
BASE = env("GEOSERVER_URL", "http://localhost:8080/geoserver").rstrip("/")
WS = env("WORKSPACE", "geomonitora")
AUTH = base64.b64encode(
    f"{env('GEOSERVER_ADMIN_USER', 'admin')}:{env('GEOSERVER_ADMIN_PASSWORD', 'geoserver')}".encode()
).decode()
CONFIG = Path(__file__).resolve().parents[2] / "web" / "src" / "config" / "layers.ts"


def rest(method, path, body=None):
    req = urllib.request.Request(
        BASE + path,
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Authorization": f"Basic {AUTH}", "Content-Type": "application/json", "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


def to_wms_name(item: str) -> str:
    item = item.strip()
    if ":" in item:
        return item
    return f"{WS}:{item.replace('.', '_', 1)}"


def cached_layers_from_config():
    src = CONFIG.read_text(encoding="utf-8")
    block = re.search(r"CACHED_LAYERS[^=]*=\s*\[(.*?)\];", src, re.S)
    if not block:
        sys.exit(f"CACHED_LAYERS não encontrado em {CONFIG}")
    body = re.sub(r"//.*", "", block.group(1))  # ignora comentários
    return [to_wms_name(m) for m in re.findall(r'"([^"]+)"', body)]


def bounds_3857(layer: str):
    """Extensão da camada em EPSG:3857, a partir do latLonBoundingBox do GeoServer."""
    ws, name = layer.split(":")
    code, txt = rest("GET", f"/rest/workspaces/{ws}/layers/{name}.json")
    if code != 200:
        raise RuntimeError(f"camada não encontrada ({code})")
    href = json.loads(txt)["layer"]["resource"]["href"].replace(BASE, "")
    b = json.loads(rest("GET", href)[1])["featureType"]["latLonBoundingBox"]
    r = 6378137.0
    fx = lambda lon: math.radians(lon) * r
    fy = lambda lat: math.log(math.tan(math.pi / 4 + math.radians(max(-85, min(85, lat))) / 2)) * r
    return [fx(b["minx"]), fy(b["miny"]), fx(b["maxx"]), fy(b["maxy"])]


def gwc_task(layer, kind, zmin=0, zmax=30, bounds=None):
    req = {
        "name": layer,
        "gridSetId": "EPSG:900913",
        "zoomStart": zmin,
        "zoomStop": zmax,
        "format": "image/png",
        "type": kind,
        "threadCount": int(env("SEED_THREADS", "4")),
    }
    if bounds:
        req["bounds"] = {"coords": {"double": bounds}}
    code, txt = rest("POST", f"/gwc/rest/seed/{layer}.json", {"seedRequest": req})
    if code not in (200, 201):
        raise RuntimeError(f"{code} {txt[:200]}")


def running_tasks():
    code, txt = rest("GET", "/gwc/rest/seed.json")
    return json.loads(txt).get("long-array-array", []) if code == 200 else []


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("action", choices=["seed", "truncate", "status"])
    ap.add_argument("layers", nargs="*")
    ap.add_argument("--zmin", type=int, default=10)
    ap.add_argument("--zmax", type=int, default=18)
    ap.add_argument("--wait", action="store_true", help="aguarda o seed terminar")
    a = ap.parse_args()

    if a.action == "status":
        tasks = running_tasks()
        if not tasks:
            print("Nenhuma tarefa em andamento.")
        for t in tasks:  # [processados, total, restante(s), id, status]
            print(f"tarefa {t[3]}: {t[0]}/{t[1]} tiles, ~{t[2]}s restantes")
        return

    layers = [to_wms_name(l) for l in a.layers] if a.layers and a.layers != ["all"] else cached_layers_from_config()
    for layer in layers:
        try:
            if a.action == "seed":
                gwc_task(layer, "seed", a.zmin, a.zmax, bounds_3857(layer))
                print(f"seed z{a.zmin}-{a.zmax} enfileirado: {layer}")
            else:
                gwc_task(layer, "truncate")
                print(f"cache limpo: {layer}")
        except RuntimeError as e:
            print(f"ERRO {layer}: {e}")

    if a.action == "seed" and a.wait:
        while tasks := running_tasks():
            done = sum(t[0] for t in tasks)
            total = sum(max(t[1], 0) for t in tasks)
            print(f"\r  {len(tasks)} tarefas, {done}/{total} tiles", end="", flush=True)
            time.sleep(5)
        print("\nSeed concluído.")


if __name__ == "__main__":
    main()
