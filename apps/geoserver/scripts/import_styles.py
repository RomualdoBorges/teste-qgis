#!/usr/bin/env python3
"""
Importa os estilos do GeoServer antigo (data_dir) para o GeoServer deste projeto.

Para cada camada do data_dir antigo:
  1. descobre a tabela de origem (schema do datastore + nativeName)
  2. acha a camada correspondente aqui: geomonitora:<schema>_<tabela>
  3. envia o SLD do estilo padrão (e os estilos alternativos) para o workspace geomonitora
  4. define o estilo padrão da camada

Ícones: os SLDs antigos usam caminhos absolutos (file:///opt/geoserver_data/svg/...).
O GeoServer 2.27 só carrega gráficos de dentro da pasta de estilos (bloqueia caminhos
absolutos e "../"), então a pasta svg/ é copiada para workspaces/<ws>/styles/svg/ e as
referências são reescritas para o caminho relativo "svg/...".

Idempotente: estilos existentes são atualizados.

Uso:
  python3 apps/geoserver/scripts/import_styles.py [--old-data-dir ~/.workdir/geoserver/geoserver_data] [--dry-run]
"""
import argparse
import base64
import glob
import json
import os
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

env = os.environ.get
BASE = env("GEOSERVER_URL", "http://localhost:8080/geoserver").rstrip("/") + "/rest"
WS = env("WORKSPACE", "geomonitora")
CONTAINER = env("GEOSERVER_CONTAINER", "geoserver")
AUTH = base64.b64encode(
    f"{env('GEOSERVER_ADMIN_USER', 'admin')}:{env('GEOSERVER_ADMIN_PASSWORD', 'geoserver')}".encode()
).decode()
BUILTIN = {"point", "line", "polygon", "generic", "raster"}  # já existem aqui


def rest(method, path, body=None, ctype="application/json"):
    data = body.encode("utf-8") if isinstance(body, str) else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(
        BASE + path, method=method, data=data,
        headers={"Authorization": f"Basic {AUTH}", "Content-Type": ctype, "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


def load_old(dd):
    """Lê estilos e camadas do data_dir antigo."""
    styles = {}
    for f in glob.glob(f"{dd}/styles/*.xml") + glob.glob(f"{dd}/workspaces/*/styles/*.xml"):
        try:
            r = ET.parse(f).getroot()
        except ET.ParseError:
            continue
        if r.tag != "style" or not r.findtext("filename"):
            continue
        ws = f.split("/workspaces/")[1].split("/")[0] if "/workspaces/" in f else None
        styles[r.findtext("id")] = {
            "old": f"{ws}:{r.findtext('name')}" if ws else r.findtext("name"),
            "name": r.findtext("name"),
            "ws": ws,
            "file": os.path.join(os.path.dirname(f), r.findtext("filename")),
        }

    schemas = {}
    for f in glob.glob(f"{dd}/workspaces/*/*/datastore.xml"):
        m = re.search(r'<entry key="schema">([^<]*)<', open(f, encoding="utf-8").read())
        schemas[os.path.dirname(f)] = m.group(1) if m else ""

    layers = []
    for lf in glob.glob(f"{dd}/workspaces/*/*/*/layer.xml"):
        d = os.path.dirname(lf)
        ftf = os.path.join(d, "featuretype.xml")
        if not os.path.exists(ftf):
            continue
        lr, ft = ET.parse(lf).getroot(), ET.parse(ftf).getroot()
        is_sql_view = any(e.get("key") == "JDBC_VIRTUAL_TABLE" for e in ft.iter("entry"))
        layers.append({
            "old": f"{lf.split('/workspaces/')[1].split('/')[0]}:{lr.findtext('name')}",
            "schema": schemas.get(os.path.dirname(d), ""),
            "native": ft.findtext("nativeName"),
            "sql_view": is_sql_view,
            "default": styles.get(lr.findtext("defaultStyle/id")),
            "alts": [styles[s.findtext("id")] for s in lr.findall("styles/style") if s.findtext("id") in styles],
        })
    return layers


def new_style_name(st):
    """Nome do estilo aqui: workspace antigo como prefixo para não colidir (drenagem:boca_de_lobo → drenagem_boca_de_lobo)."""
    base = f"{st['ws']}_{st['name']}" if st["ws"] else st["name"]
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", base)


SVG_HREF = re.compile(r'(xlink:href=")file:/*opt/geoserver_data/svg/([^"?]+)')
SVG_TYPOS = {"DREANGEM/": "DRENAGEM/"}
missing_icons = set()


def rewrite_icons(sld, svg_root):
    """file:///opt/geoserver_data/svg/X/Y.svg → svg/X/Y.svg (relativo à pasta de estilos)."""
    def fix(m):
        path = m.group(2)
        for wrong, right in SVG_TYPOS.items():
            path = path.replace(wrong, right)
        if svg_root and not os.path.exists(os.path.join(svg_root, path)):
            missing_icons.add(path)
        return f"{m.group(1)}svg/{path}"
    return SVG_HREF.sub(fix, sld)


def upload_style(st, dry, svg_root=None):
    if st["name"] in BUILTIN and not st["ws"]:
        return st["name"], None  # usa o estilo padrão equivalente daqui
    name = new_style_name(st)
    sld = rewrite_icons(open(st["file"], encoding="utf-8", errors="replace").read(), svg_root)
    version = re.search(r'StyledLayerDescriptor[^>]*version="([^"]+)"', sld)
    ctype = "application/vnd.ogc.se+xml" if version and version.group(1) == "1.1.0" else "application/vnd.ogc.sld+xml"
    if dry:
        return f"{WS}:{name}", None
    exists = rest("GET", f"/workspaces/{WS}/styles/{urllib.parse.quote(name)}.json")[0] == 200
    if exists:
        code, msg = rest("PUT", f"/workspaces/{WS}/styles/{urllib.parse.quote(name)}?raw=true", sld, ctype)
    else:
        code, msg = rest("POST", f"/workspaces/{WS}/styles?name={urllib.parse.quote(name)}&raw=true", sld, ctype)
    if code not in (200, 201):
        return None, f"{code} {msg.strip()[:200]}"
    return f"{WS}:{name}", None


def copy_svg(dd, dry):
    src = os.path.join(dd, "svg")
    if not os.path.isdir(src):
        print("aviso: pasta svg/ não encontrada no data_dir antigo")
        return
    if dry:
        print(f"(dry-run) copiaria {src} → {CONTAINER}:/opt/geoserver_data/svg")
        return
    dest = f"/opt/geoserver_data/workspaces/{WS}/styles"
    subprocess.run(["docker", "exec", CONTAINER, "mkdir", "-p", dest], check=True)
    subprocess.run(["docker", "cp", src, f"{CONTAINER}:{dest}/"], check=True)
    print(f"ícones copiados: {sum(len(f) for _, _, f in os.walk(src))} arquivos → {dest}/svg")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--old-data-dir", default=os.path.expanduser("~/.workdir/geoserver/geoserver_data"))
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    dd = os.path.abspath(os.path.expanduser(a.old_data_dir))
    if not os.path.isdir(f"{dd}/workspaces"):
        sys.exit(f"data_dir antigo não encontrado em {dd}")

    copy_svg(dd, a.dry_run)
    layers = load_old(dd)
    uploaded, report = {}, {"ok": [], "sem_camada": [], "erro": []}

    for L in sorted(layers, key=lambda l: l["old"]):
        target = f"{L['schema']}_{L['native']}"
        if rest("GET", f"/layers/{WS}:{urllib.parse.quote(target)}.json")[0] != 200:
            report["sem_camada"].append(f"{L['old']} (→ {L['schema']}.{L['native']}{' — SQL view' if L['sql_view'] else ''})")
            continue
        if not L["default"]:
            continue
        names = []
        for st in [L["default"], *L["alts"]]:
            if st["old"] not in uploaded:
                uploaded[st["old"]] = upload_style(st, a.dry_run, os.path.join(dd, "svg"))
            name, err = uploaded[st["old"]]
            if err:
                report["erro"].append(f"estilo {st['old']}: {err}")
            elif name not in names:
                names.append(name)
        if not names:
            continue
        default, alts = names[0], names[1:]
        ws_of = lambda n: ({"name": n.split(":")[1], "workspace": WS} if ":" in n else {"name": n})
        body = {"layer": {"defaultStyle": ws_of(default)}}
        if alts:
            body["layer"]["styles"] = {"style": [ws_of(n) for n in alts]}
        if not a.dry_run:
            code, msg = rest("PUT", f"/layers/{WS}:{urllib.parse.quote(target)}.json", body)
            if code != 200:
                report["erro"].append(f"camada {target}: {code} {msg[:150]}")
                continue
        report["ok"].append(f"{L['old']:58s} → {WS}:{target}  [{default}{' +' + str(len(alts)) if alts else ''}]")

    print(f"\n{len(report['ok'])} camadas com estilo aplicado:")
    print("\n".join("  " + r for r in report["ok"]))
    if report["sem_camada"]:
        print(f"\n{len(report['sem_camada'])} camadas antigas sem correspondente publicado aqui:")
        print("\n".join("  " + r for r in report["sem_camada"]))
    if missing_icons:
        print(f"\n{len(missing_icons)} ícones referenciados que não existem no data_dir antigo:")
        print("\n".join("  " + m for m in sorted(missing_icons)))
    if report["erro"]:
        print(f"\n{len(report['erro'])} erros:")
        print("\n".join("  " + r for r in report["erro"]))


if __name__ == "__main__":
    main()
