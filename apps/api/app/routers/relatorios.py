"""
Relatórios (equivalentes ao módulo Relatórios do original: clientes, água, esgoto e drenagem).

Todos aceitam o mesmo escopo ("priorização" no original): município inteiro, DMC/VRP, setor de abastecimento,
bacia de esgotamento, bacia de drenagem ou uma área desenhada. O recorte é espacial: redes são cortadas na
borda (ST_Intersection); ligações/peças contam se estão dentro; clientes contam pela ligação do lote (IPTU).

Diferenças deliberadas em relação ao original:
- extensão de rede = comprimento desenhado (ST_Length da geometria), a mesma medida do inventário de ativos.
  O original usava a extensão informada no cadastro, que diverge muito do desenho em parte dos trechos
  (ex.: 0,3 m desenhados com 2.018 m informados) — ver os relatórios "Trechos com extensão divergente";
- consumo = últimos 12 meses faturados (relatorios.consumo_cliente), não a soma de todo o histórico;
- contagens sem duplicação (o original juntava consumo mês a mês antes de contar clientes/ligações);
- rede sem data de implantação fica em "Não informado" (o original a somava em "> 20 anos").

Resposta: {titulo, colunas: [{id, rotulo, tipo, soma?}], linhas: [...], barra?, nota?, truncado?}
"""
from __future__ import annotations

import json
import re
from datetime import date
from typing import Any, Awaitable, Callable, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from ..db import fetch_all, fetch_one, pool

router = APIRouter(prefix="/relatorios", tags=["relatorios"])

LIMITE_LISTA = 5000

# ------------------------------------------------------------------ escopo
ESCOPOS = {
    "dmc": ("agua.saa_setorabastecimento", "DMC / VRP"),
    "setor": ("agua.saa_setorreservatorios", "Setor de abastecimento"),
    "bacia_esgoto": ("esgoto.ses_sub_bacia", "Bacia de esgotamento"),
    "bacia_drenagem": ("drenagem.sdu_lim_bacias_drenagem", "Bacia de drenagem"),
}


class Escopo(BaseModel):
    tipo: Literal["global", "dmc", "setor", "bacia_esgoto", "bacia_drenagem", "area"] = "global"
    id: int | None = None
    area: dict | None = Field(None, description="GeoJSON (EPSG:4326) quando tipo = area")


class Pedido(BaseModel):
    escopo: Escopo = Escopo()
    params: dict[str, Any] = {}


class Ctx:
    """Recorte espacial de um pedido: CTE `esc(g)` + filtro por alias."""

    def __init__(self, e: Escopo):
        self.global_ = e.tipo == "global"
        self.params: dict[str, Any] = {}
        if e.tipo == "global":
            self.cte = "esc AS (SELECT NULL::geometry AS g)"
        elif e.tipo == "area":
            if not e.area:
                raise HTTPException(400, "Desenhe a área no mapa")
            self.params["area"] = json.dumps(e.area)
            self.cte = ("esc AS (SELECT ST_MakeValid(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(%(area)s), 4326), 31983)) AS g)")
        else:
            if e.id is None:
                raise HTTPException(400, f"Escolha o(a) {ESCOPOS[e.tipo][1]}")
            self.params["esc_id"] = e.id
            self.cte = f"esc AS (SELECT geometria AS g FROM {ESCOPOS[e.tipo][0]} WHERE fid = %(esc_id)s)"

    def dentro(self, a: str) -> str:
        return "TRUE" if self.global_ else f"({a}.geometria && esc.g AND ST_Intersects({a}.geometria, esc.g))"

    def extensao(self, a: str) -> str:
        """Extensão desenhada (m) dentro do escopo — trechos cortados na borda contam só o pedaço de dentro.
        Mesma medida do inventário de ativos (inventario._item)."""
        if self.global_:
            return f"ST_Length({a}.geometria)"
        return f"(CASE WHEN ST_CoveredBy({a}.geometria, esc.g) THEN ST_Length({a}.geometria) ELSE ST_Length(ST_Intersection({a}.geometria, esc.g)) END)"

    def clientes(self) -> str:
        """Clientes do escopo (pela ligação do lote)."""
        if self.global_:
            return "SELECT c.* FROM comercial.com_clientes c"
        return ("SELECT c.* FROM comercial.com_clientes c WHERE EXISTS (SELECT 1 FROM agua.saa_ligacoes l, esc "
                f"WHERE l.inscricao_iptu = c.inscricao_iptu AND {self.dentro('l')})")


def col(id: str, rotulo: str, tipo: str = "texto", soma: bool = False) -> dict:
    return {"id": id, "rotulo": rotulo, "tipo": tipo, "soma": soma}


async def consultar(ctx: Ctx, corpo: str, extra: dict | None = None) -> list[dict]:
    """`corpo` continua o WITH: começa com ", outra_cte AS (...)" ou direto com "SELECT"."""
    return await fetch_all(f"WITH {ctx.cte} {corpo}", {**ctx.params, **(extra or {})})


def com_percentual(linhas: list[dict], base: str, destino: str = "pct") -> list[dict]:
    total = sum(float(l[base] or 0) for l in linhas)
    for l in linhas:
        l[destino] = round(float(l[base] or 0) * 100 / total, 4) if total else 0
    return linhas


def _num(s: Any) -> float:
    m = re.search(r"\d+(?:[.,]\d+)?", str(s or ""))
    return float(m.group().replace(",", ".")) if m else float("inf")


async def periodo() -> str:
    r = await fetch_one("SELECT ultimo_mes FROM relatorios.periodo_consumo")
    u = r and r["ultimo_mes"]
    if not u:
        return "sem faturamento"
    fim = f"{u % 100:02d}/{u // 100}"
    ini_am = (u // 100 - 1) * 100 + u % 100 + 1 if u % 100 < 12 else (u // 100) * 100 + 1
    return f"{ini_am % 100:02d}/{ini_am // 100} a {fim}"


# ------------------------------------------------------------------ redes
REDES = {
    "agua": {"tabela": "agua.saa_rede", "diametro": "agua.saa_adiametro", "material": "agua.saa_amaterial",
             "tipo": "agua.saa_atipo_rede", "situacao": ("situacao_rede", "agua.saa_asituacao_rede")},
    "esgoto": {"tabela": "esgoto.ses_rede", "diametro": "esgoto.ses_adiametro", "material": "esgoto.ses_amaterial",
               "tipo": "esgoto.ses_atipo_rede", "situacao": ("situacao_rede", "esgoto.ses_asituacao_rede")},
    "drenagem": {"tabela": "drenagem.sdu_rede_drenagem", "diametro": "drenagem.sdu_adiametro",
                 "material": "drenagem.sdu_amaterial_rede", "tipo": "drenagem.sdu_atipo_rede",
                 "situacao": ("estado", "drenagem.sdu_aestado")},
}
DIMS = {
    "diametro": ("Diâmetro", "diametro"),
    "material": ("Material", "material"),
    "tipo": ("Tipo de rede", "tipo_rede"),
}
FAIXAS_IDADE = ["0 a 5 anos", "6 a 10 anos", "11 a 15 anos", "16 a 20 anos", "Mais de 20 anos", "Não informado"]
IDADE_SQL = """CASE WHEN r.data_implantacao IS NULL OR r.data_implantacao > current_date THEN 'Não informado'
  ELSE (ARRAY['0 a 5 anos','6 a 10 anos','11 a 15 anos','16 a 20 anos','Mais de 20 anos'])[
    least(5, greatest(1, ceil(greatest(extract(year FROM age(current_date, r.data_implantacao)), 0.5) / 5)::int))] END"""


def rotulo_dom(alias: str, coluna: str) -> str:
    return (f"coalesce(nullif(btrim({alias}.descricao), ''), CASE WHEN r.{coluna} IS NULL THEN 'Não informado' "
            f"ELSE 'Código ' || r.{coluna} END)")


def rede_por(sistema: str, dims: list[str]):
    cfg = REDES[sistema]

    async def run(ctx: Ctx, _p: dict) -> dict:
        sel, joins, cols, grp = [], [], [], []
        for i, d in enumerate(dims, 1):
            if d == "idade":
                sel.append(f"{IDADE_SQL} AS idade")
                cols.append(col("idade", "Faixa de idade"))
            else:
                rot, coluna = DIMS[d]
                joins.append(f"LEFT JOIN {cfg[d]} d{i} ON d{i}.id = r.{coluna}")
                sel.append(f"{rotulo_dom(f'd{i}', coluna)} AS {d}")
                cols.append(col(d, rot))
            grp.append(str(i))
        linhas = await consultar(ctx, f"""
            SELECT {', '.join(sel)}, round((sum({ctx.extensao('r')}) / 1000)::numeric, 3) AS extensao_km
              FROM {cfg['tabela']} r {' '.join(joins)} CROSS JOIN esc
             WHERE r.geometria IS NOT NULL AND {ctx.dentro('r')}
             GROUP BY {', '.join(grp)}""")
        linhas = [l for l in linhas if l["extensao_km"] and l["extensao_km"] > 0]

        def chave(l):
            return tuple(_num(l[d]) if d == "diametro" else (FAIXAS_IDADE.index(l[d]) if d == "idade" else 0)
                         for d in dims) + tuple(str(l[d]) for d in dims)

        linhas.sort(key=chave if len(dims) > 1 or dims[0] in ("diametro", "idade") else (lambda l: -float(l["extensao_km"])))
        com_percentual(linhas, "extensao_km")
        return {"colunas": cols + [col("extensao_km", "Extensão (km)", "km", True), col("pct", "Percentual", "pct", True)],
                "linhas": linhas, "barra": "pct"}

    return run


def rede_lista(sistema: str):
    cfg = REDES[sistema]
    sit_col, sit_dom = cfg["situacao"]
    dmc = sistema == "agua"

    async def run(ctx: Ctx, _p: dict) -> dict:
        linhas = await consultar(ctx, f"""
            SELECT r.fid, {rotulo_dom('dt', 'tipo_rede')} AS tipo, {rotulo_dom('dd', 'diametro')} AS diametro,
                   {rotulo_dom('dm', 'material')} AS material, {rotulo_dom('ds', sit_col)} AS situacao,
                   round({ctx.extensao('r')}::numeric, 2) AS extensao_m, r.extensao_informada AS informada_m, r.data_implantacao
                   {", s.nome AS dmc" if dmc else ""}
              FROM {cfg['tabela']} r
              LEFT JOIN {cfg['tipo']} dt ON dt.id = r.tipo_rede
              LEFT JOIN {cfg['diametro']} dd ON dd.id = r.diametro
              LEFT JOIN {cfg['material']} dm ON dm.id = r.material
              LEFT JOIN {sit_dom} ds ON ds.id = r.{sit_col}
              {"LEFT JOIN agua.saa_setorabastecimento s ON s.fid = r.dmc_vrp" if dmc else ""}
              CROSS JOIN esc
             WHERE r.geometria IS NOT NULL AND {ctx.dentro('r')}
             ORDER BY r.fid LIMIT {LIMITE_LISTA + 1}""")
        cols = [col("fid", "Identificador", "inteiro"), col("tipo", "Tipo"), col("diametro", "Diâmetro"),
                col("material", "Material"), col("situacao", "Situação" if sit_col != "estado" else "Estado"),
                col("extensao_m", "Extensão desenhada (m)", "decimal", True),
                col("informada_m", "Extensão informada (m)", "decimal", True), col("data_implantacao", "Implantação", "data")]
        if dmc:
            cols.append(col("dmc", "DMC / VRP"))
        return {"colunas": cols, "linhas": linhas[:LIMITE_LISTA], "truncado": len(linhas) > LIMITE_LISTA,
                "camada": CAMADA_REDE[sistema]}

    return run


CAMADA_REDE = {"agua": "agua_vw_geoserver_front_rede_agua", "esgoto": "esgoto_ses_geoserver_rede",
               "drenagem": "drenagem_sdu_geoserver_rede"}


def rede_divergencia(sistema: str):
    """Qualidade do cadastro: trechos cuja extensão informada difere do desenho além dos limites."""
    cfg = REDES[sistema]

    async def run(ctx: Ctx, p: dict) -> dict:
        lim_m = float(p.get("min_m") or 10)
        lim_pct = float(p.get("min_pct") or 50)
        linhas = await consultar(ctx, f"""
            SELECT r.fid, {rotulo_dom('dd', 'diametro')} AS diametro, {rotulo_dom('dm', 'material')} AS material,
                   round(ST_Length(r.geometria)::numeric, 2) AS desenho_m, r.extensao_informada AS informada_m,
                   round((r.extensao_informada - ST_Length(r.geometria))::numeric, 2) AS diferenca_m,
                   round((100 * abs(r.extensao_informada - ST_Length(r.geometria))
                          / greatest(ST_Length(r.geometria), 0.01))::numeric, 1) AS diferenca_pct
              FROM {cfg['tabela']} r
              LEFT JOIN {cfg['diametro']} dd ON dd.id = r.diametro
              LEFT JOIN {cfg['material']} dm ON dm.id = r.material
              CROSS JOIN esc
             WHERE r.geometria IS NOT NULL AND nullif(r.extensao_informada, 0) IS NOT NULL AND {ctx.dentro('r')}
               AND abs(r.extensao_informada - ST_Length(r.geometria)) >= %(lim_m)s
               AND 100 * abs(r.extensao_informada - ST_Length(r.geometria)) / greatest(ST_Length(r.geometria), 0.01) >= %(lim_pct)s
             ORDER BY abs(r.extensao_informada - ST_Length(r.geometria)) DESC
             LIMIT {LIMITE_LISTA + 1}""", {"lim_m": lim_m, "lim_pct": lim_pct})
        return {"colunas": [col("fid", "Identificador", "inteiro"), col("diametro", "Diâmetro"), col("material", "Material"),
                            col("desenho_m", "Desenhada (m)", "decimal", True), col("informada_m", "Informada (m)", "decimal", True),
                            col("diferenca_m", "Diferença (m)", "decimal", True), col("diferenca_pct", "Diferença (%)", "decimal")],
                "linhas": linhas[:LIMITE_LISTA], "truncado": len(linhas) > LIMITE_LISTA, "camada": CAMADA_REDE[sistema],
                "nota": f"Trechos com extensão informada diferente do desenho em pelo menos {lim_m:g} m e {lim_pct:g} %. "
                        "Os relatórios de extensão usam o comprimento desenhado."}

    return run


def pecas(sistema: str):
    """Quantificação de peças: itens pontuais do inventário (inventario.itens), por tipo quando há."""

    async def run(ctx: Ctx, _p: dict) -> dict:
        itens = await consultar(ctx, """
            SELECT it.ordem, inventario._item(it, esc.g) AS r
              FROM inventario.itens it CROSS JOIN esc
             WHERE it.sistema = %(sistema)s AND NOT it.linear
             ORDER BY it.ordem""", {"sistema": {"agua": "Água", "esgoto": "Esgoto", "drenagem": "Drenagem"}[sistema]})
        linhas = []
        for it in itens:
            r = it["r"]
            grupo = next((g for g in r["grupos"] if g["rotulo"] == "Tipo"), None)
            if grupo and grupo["linhas"]:
                for l in grupo["linhas"]:
                    linhas.append({"peca": r["ativo"], "tipo": l["rotulo"], "quantidade": l["quantidade"]})
            else:
                linhas.append({"peca": r["ativo"], "tipo": "—", "quantidade": r["quantidade"]})
        return {"colunas": [col("peca", "Peça"), col("tipo", "Tipo"), col("quantidade", "Quantidade", "inteiro", True)],
                "linhas": linhas}

    return run


# ------------------------------------------------------------------ clientes
COBRANCA_SQL = """CASE cu.cod_faturamento WHEN 1 THEN 'Residencial' WHEN 2 THEN 'Comercial'
                  WHEN 3 THEN 'Industrial' ELSE 'Outros' END"""

COLS_CLIENTE = [
    col("codigo_cliente", "Cód. Cliente"), col("nome", "Nome"), col("endereco", "Endereço"), col("bairro", "Bairro"),
    col("inscricao_iptu", "IPTU"), col("categoria", "Categoria de uso"), col("tarifa", "Tarifa"),
    col("economias", "Economias", "inteiro", True), col("consumo_12m", "Consumo 12 meses (m³)", "inteiro", True),
    col("media_mensal", "Média mensal (m³)", "decimal"),
]


def lista_clientes(ctx: Ctx, onde: str = "TRUE", extra_sel: str = "", extra_join: str = "", ordem: str = "c.codigo_cliente"):
    return f"""
        , cli AS ({ctx.clientes()})
        SELECT c.id, c.codigo_cliente, btrim(c.nome) AS nome,
               concat_ws(', ', nullif(btrim(c.endereco_rua), ''), nullif(btrim(c.endereco_numero), ''),
                         nullif(btrim(c.endereco_complemento), '')) AS endereco,
               btrim(c.endereco_bairro) AS bairro, c.inscricao_iptu, btrim(cu.descricao) AS categoria,
               btrim(ct.descricao) AS tarifa, c.qtde_economias AS economias,
               cc.consumo_12m, cc.media_mensal {extra_sel},
               (SELECT min(l.fid) FROM agua.saa_ligacoes l WHERE l.inscricao_iptu = c.inscricao_iptu) AS fid_ligacao
          FROM cli c
          LEFT JOIN comercial.com_aux_categorias_uso cu ON cu.id = c.categoria_uso_id
          LEFT JOIN comercial.com_aux_classificacoes_tarifarias ct ON ct.id = c.classificacao_tarifaria_id
          LEFT JOIN relatorios.consumo_cliente cc ON cc.codigo_dae = c.codigo_cliente
          {extra_join}
         WHERE {onde}
         ORDER BY {ordem} LIMIT {LIMITE_LISTA + 1}"""


async def resp_lista(linhas, cols=COLS_CLIENTE, nota: str | None = None) -> dict:
    return {"colunas": cols, "linhas": linhas[:LIMITE_LISTA], "truncado": len(linhas) > LIMITE_LISTA,
            "nota": nota or f"Consumo: {await periodo()}.", "abre": "cliente"}


async def clientes_lista(ctx: Ctx, p: dict) -> dict:
    cob = p.get("cobranca") or ""
    onde = f"{COBRANCA_SQL} = %(cob)s" if cob else "TRUE"
    return await resp_lista(await consultar(ctx, lista_clientes(ctx, onde), {"cob": cob}))


async def clientes_poco(ctx: Ctx, _p: dict) -> dict:
    return await resp_lista(await consultar(ctx, lista_clientes(ctx, "c.grupo_leitura_id = 27")),
                            nota=f"Clientes do grupo de leitura de poços (27). Consumo: {await periodo()}.")


async def clientes_faixa(ctx: Ctx, p: dict) -> dict:
    lo, hi = float(p.get("min") or 0), p.get("max")
    onde = "coalesce(cc.media_mensal, 0) >= %(lo)s" + (" AND coalesce(cc.media_mensal, 0) < %(hi)s" if hi not in (None, "") else "")
    linhas = await consultar(ctx, lista_clientes(ctx, onde, ordem="cc.media_mensal DESC NULLS LAST"),
                             {"lo": lo, "hi": float(hi) if hi not in (None, "") else None})
    return await resp_lista(linhas, nota=f"Média mensal de consumo nos 12 meses ({await periodo()}).")


async def clientes_hidrometro(ctx: Ctx, p: dict) -> dict:
    ini, fim = p.get("inicio") or "1900-01-01", p.get("fim") or date.today().isoformat()
    linhas = await consultar(ctx, lista_clientes(
        ctx, "h.data_instalacao BETWEEN %(ini)s::date AND %(fim)s::date",
        extra_sel=", h.codigo_hidrometro, h.data_instalacao AS data_instalacao_hidrometro, btrim(h.marca_hidrometro) AS marca, "
                  "btrim(h.capacidade_hidrometro) AS capacidade",
        extra_join="JOIN comercial.com_hidrometros h ON h.cliente_id = c.id",
        ordem="h.data_instalacao DESC"), {"ini": ini, "fim": fim})
    cols = COLS_CLIENTE[:5] + [col("codigo_hidrometro", "Hidrômetro"), col("data_instalacao_hidrometro", "Instalação", "data"),
                               col("marca", "Marca"), col("capacidade", "Capacidade")] + COLS_CLIENTE[5:]
    return await resp_lista(linhas, cols)


async def hidrometros_duplicados(ctx: Ctx, _p: dict) -> dict:
    """Lista do cadastro comercial (comercial.com_hidrometros_duplicados), como no original."""
    linhas = await consultar(ctx, f"""
        , cli AS ({ctx.clientes()})
        SELECT d.numero_hidrometros AS hidrometro, d.quantidade_duplicados AS quantidade,
               array_to_string((array_agg(c.codigo_cliente ORDER BY c.codigo_cliente))[1:20], ', ')
                 || CASE WHEN count(*) > 20 THEN format(' … (+%%s)', count(*) - 20) ELSE '' END AS clientes,
               string_agg(DISTINCT concat_ws(', ', btrim(c.endereco_rua), btrim(c.endereco_numero)), ' | ') AS enderecos
          FROM comercial.com_hidrometros_duplicados d
          CROSS JOIN LATERAL jsonb_array_elements_text(d.codigo_clientes) AS cod(codigo)
          JOIN cli c ON c.codigo_cliente = cod.codigo
         GROUP BY d.id, d.numero_hidrometros, d.quantidade_duplicados
         ORDER BY 2 DESC, 1""")
    return {"colunas": [col("hidrometro", "Hidrômetro"), col("quantidade", "Clientes", "inteiro", True),
                        col("clientes", "Códigos dos clientes"), col("enderecos", "Endereços")], "linhas": linhas}


async def agrupar_clientes(ctx: Ctx, rotulos: list[tuple[str, str, str]], join: str, ordem: str, extra_cols=()) -> list[dict]:
    """Agrega clientes do escopo por expressões (id, rótulo, sql). Contagens distintas, consumo de 12 meses."""
    sel = ", ".join(f"{sqlx} AS {i}" for i, _, sqlx in rotulos)
    grp = ", ".join(str(n + 1) for n in range(len(rotulos)))
    return await consultar(ctx, f"""
        , cli AS ({ctx.clientes()})
        SELECT {sel},
               count(*) AS clientes,
               coalesce(sum(c.qtde_economias), 0) AS economias,
               count(DISTINCT lg.fid) AS ligacoes,
               coalesce(sum(cc.consumo_12m), 0) AS consumo_12m,
               coalesce(sum(cc.consumo_ultimo_mes), 0) AS consumo_ultimo_mes
               {''.join(', ' + e for e in extra_cols)}
          FROM cli c
          LEFT JOIN relatorios.consumo_cliente cc ON cc.codigo_dae = c.codigo_cliente
          LEFT JOIN LATERAL (SELECT min(l.fid) AS fid FROM agua.saa_ligacoes l WHERE l.inscricao_iptu = c.inscricao_iptu) lg ON true
          {join}
         GROUP BY {grp} ORDER BY {ordem}""")


async def clientes_categoria(ctx: Ctx, _p: dict) -> dict:
    linhas = await agrupar_clientes(
        ctx, [("cobranca", "Categoria", COBRANCA_SQL), ("categoria", "Subcategoria", "coalesce(btrim(cu.descricao), 'Não informado')")],
        "LEFT JOIN comercial.com_aux_categorias_uso cu ON cu.id = c.categoria_uso_id", "1, clientes DESC")
    com_percentual(linhas, "clientes")
    return {"colunas": [col("cobranca", "Categoria"), col("categoria", "Subcategoria"),
                        col("clientes", "Clientes", "inteiro", True), col("economias", "Economias", "inteiro", True),
                        col("ligacoes", "Ligações", "inteiro", True), col("consumo_12m", "Consumo 12 meses (m³)", "inteiro", True),
                        col("pct", "% clientes", "pct", True)],
            "linhas": linhas, "barra": "pct", "nota": f"Consumo: {await periodo()}."}


async def ligacoes_economias(ctx: Ctx, _p: dict) -> dict:
    linhas = await agrupar_clientes(ctx, [("cobranca", "Categoria de cobrança", COBRANCA_SQL)],
                                    "LEFT JOIN comercial.com_aux_categorias_uso cu ON cu.id = c.categoria_uso_id", "clientes DESC")
    com_percentual(linhas, "economias")
    return {"colunas": [col("cobranca", "Categoria de cobrança"), col("ligacoes", "Ligações", "inteiro", True),
                        col("clientes", "Clientes", "inteiro", True), col("economias", "Economias", "inteiro", True),
                        col("consumo_ultimo_mes", "Consumo último mês (m³)", "inteiro", True),
                        col("consumo_12m", "Consumo 12 meses (m³)", "inteiro", True), col("pct", "% economias", "pct", True)],
            "linhas": linhas, "barra": "pct", "nota": f"Consumo: {await periodo()}."}


async def clientes_ramo(ctx: Ctx, _p: dict) -> dict:
    linhas = await agrupar_clientes(ctx, [("ramo", "Ramo", "coalesce(btrim(ra.descricao), 'Não informado')")],
                                    "LEFT JOIN comercial.com_aux_ramos_atividade ra ON ra.id = c.ramo_atividade_id", "clientes DESC")
    com_percentual(linhas, "clientes")
    return {"colunas": [col("ramo", "Ramo de atividade"), col("clientes", "Clientes", "inteiro", True),
                        col("economias", "Economias", "inteiro", True), col("consumo_12m", "Consumo 12 meses (m³)", "inteiro", True),
                        col("pct", "% clientes", "pct", True)],
            "linhas": linhas, "barra": "pct", "nota": f"Consumo: {await periodo()}."}


async def clientes_tarifa(ctx: Ctx, _p: dict) -> dict:
    linhas = await agrupar_clientes(ctx, [("tarifa", "Tarifa", "coalesce(btrim(ct.descricao), 'Não informado')")],
                                    "LEFT JOIN comercial.com_aux_classificacoes_tarifarias ct ON ct.id = c.classificacao_tarifaria_id",
                                    "clientes DESC")
    com_percentual(linhas, "clientes")
    return {"colunas": [col("tarifa", "Classificação tarifária"), col("clientes", "Clientes", "inteiro", True),
                        col("economias", "Economias", "inteiro", True), col("consumo_12m", "Consumo 12 meses (m³)", "inteiro", True),
                        col("pct", "% clientes", "pct", True)],
            "linhas": linhas, "barra": "pct", "nota": f"Consumo: {await periodo()}."}


FAIXAS_CONSUMO = [(0, 10), (10, 30), (30, 50), (50, 200), (200, 500), (500, 1000), (1000, None)]


async def clientes_faixas(ctx: Ctx, _p: dict) -> dict:
    casos = " ".join(f"WHEN cc.media_mensal < {hi} THEN '{lo} a {hi} m³'" for lo, hi in FAIXAS_CONSUMO if hi)
    linhas = await agrupar_clientes(
        ctx, [("faixa", "Faixa", f"CASE WHEN cc.media_mensal IS NULL THEN 'Sem consumo no período' {casos} ELSE '1000 m³ ou mais' END")],
        "", "1")
    ordem = [f"{lo} a {hi} m³" for lo, hi in FAIXAS_CONSUMO if hi] + ["1000 m³ ou mais", "Sem consumo no período"]
    linhas.sort(key=lambda l: ordem.index(l["faixa"]))
    com_percentual(linhas, "clientes")
    return {"colunas": [col("faixa", "Média mensal"), col("clientes", "Clientes", "inteiro", True),
                        col("economias", "Economias", "inteiro", True), col("consumo_12m", "Consumo 12 meses (m³)", "inteiro", True),
                        col("pct", "% clientes", "pct", True)],
            "linhas": linhas, "barra": "pct", "nota": f"Média mensal nos 12 meses ({await periodo()})."}


async def volume_esgoto(ctx: Ctx, p: dict) -> dict:
    """Volume lançado estimado por bacia de esgotamento = consumo micromedido no período × fator (padrão 0,6457)."""
    def am(v: str | None, padrao: int) -> int:
        m = re.fullmatch(r"(\d{4})-(\d{2})", str(v or ""))
        return int(m[1]) * 100 + int(m[2]) if m else padrao

    ult = (await fetch_one("SELECT ultimo_mes FROM relatorios.periodo_consumo"))["ultimo_mes"]
    fim = am(p.get("fim"), ult)
    ini = am(p.get("inicio"), (fim // 100 - 1) * 100 + fim % 100 + 1 if fim % 100 < 12 else (fim // 100) * 100 + 1)
    fator = float(p.get("fator") or 0.6457)
    linhas = await consultar(ctx, """
        , bac AS (SELECT b.fid, b.nome, b.geometria FROM esgoto.ses_sub_bacia b CROSS JOIN esc
                   WHERE esc.g IS NULL OR (b.geometria && esc.g AND ST_Intersects(b.geometria, esc.g)))
        , cli AS MATERIALIZED (
            SELECT DISTINCT ON (c.id) bac.nome AS bacia, c.id, c.codigo_cliente, c.classificacao_tarifaria_id, l.fid AS lig
              FROM bac JOIN agua.saa_ligacoes l ON l.geometria && bac.geometria AND ST_Within(l.geometria, bac.geometria)
              JOIN comercial.com_clientes c ON c.inscricao_iptu = l.inscricao_iptu
              CROSS JOIN esc WHERE esc.g IS NULL OR ST_Intersects(l.geometria, esc.g))
        , cons AS MATERIALIZED (
            -- agrega o período inteiro primeiro (índice por ano*100+mês) e só depois junta aos clientes
            SELECT f.codigo_dae, sum(f.consumo) AS consumo, count(DISTINCT f.ano_at * 100 + f.mes_at) AS meses
              FROM comercial.com_consumo_faturado f
             WHERE f.ano_at * 100 + f.mes_at BETWEEN %(ini)s AND %(fim)s AND f.consumo IS NOT NULL
             GROUP BY 1)
        SELECT cli.bacia, count(DISTINCT cli.lig) AS ligacoes, count(*) AS clientes,
               count(*) FILTER (WHERE classificacao_tarifaria_id = 3) AS residencial,
               count(*) FILTER (WHERE classificacao_tarifaria_id = 4) AS comercial,
               count(*) FILTER (WHERE classificacao_tarifaria_id = 5) AS industrial,
               coalesce(sum(cons.consumo), 0) AS consumo,
               round(coalesce(sum(cons.consumo), 0)::numeric / greatest(max(cons.meses), 1), 1) AS consumo_mensal,
               round(coalesce(sum(cons.consumo), 0) * %(fator)s::numeric, 1) AS volume
          FROM cli LEFT JOIN cons ON cons.codigo_dae = cli.codigo_cliente
         GROUP BY 1 ORDER BY volume DESC""", {"ini": ini, "fim": fim, "fator": fator})
    return {"colunas": [col("bacia", "Bacia de esgotamento"), col("ligacoes", "Ligações", "inteiro", True),
                        col("clientes", "Clientes", "inteiro", True), col("residencial", "Residencial", "inteiro", True),
                        col("comercial", "Comercial", "inteiro", True), col("industrial", "Industrial", "inteiro", True),
                        col("consumo", "Consumo no período (m³)", "inteiro", True),
                        col("consumo_mensal", "Consumo médio mensal (m³)", "decimal", True),
                        col("volume", "Volume lançado estimado (m³)", "decimal", True)],
            "linhas": linhas, "barra": "volume",
            "nota": f"Período {ini % 100:02d}/{ini // 100} a {fim % 100:02d}/{fim // 100}; fator de cálculo {fator:g} "
                    "(volume = consumo micromedido × fator)."}


# ------------------------------------------------------------------ catálogo
Run = Callable[[Ctx, dict], Awaitable[dict]]
COBRANCAS = ["Residencial", "Comercial", "Industrial", "Outros"]

CATALOGO: list[dict] = [
    # sistema, id, titulo, função, parâmetros
    {"sistema": "Clientes", "id": "clientes-lista", "titulo": "Relatório customizado de clientes", "run": clientes_lista,
     "params": [{"id": "cobranca", "rotulo": "Categoria", "tipo": "select", "opcoes": [""] + COBRANCAS, "padrao": ""}]},
    {"sistema": "Clientes", "id": "clientes-categoria-uso", "titulo": "Quantificação de clientes / Por categoria de uso", "run": clientes_categoria},
    {"sistema": "Clientes", "id": "clientes-faixas-consumo", "titulo": "Quantificação de clientes / Por faixa de consumo", "run": clientes_faixas},
    {"sistema": "Clientes", "id": "clientes-ramo-atividade", "titulo": "Quantificação de clientes / Por ramo de atividade", "run": clientes_ramo},
    {"sistema": "Clientes", "id": "clientes-poco-artesiano", "titulo": "Clientes com poço artesiano", "run": clientes_poco},
    {"sistema": "Clientes", "id": "clientes-faixa-consumo", "titulo": "Por faixa de consumo", "run": clientes_faixa,
     "params": [{"id": "min", "rotulo": "Média mensal de (m³)", "tipo": "numero", "padrao": 50},
                {"id": "max", "rotulo": "até (m³)", "tipo": "numero", "padrao": 200}]},
    {"sistema": "Clientes", "id": "clientes-hidrometro", "titulo": "Por hidrômetro (data de instalação)", "run": clientes_hidrometro,
     "params": [{"id": "inicio", "rotulo": "Instalado de", "tipo": "data", "padrao": f"{date.today().year - 1}-01-01"},
                {"id": "fim", "rotulo": "até", "tipo": "data", "padrao": date.today().isoformat()}]},
    {"sistema": "Clientes", "id": "hidrometros-duplicados", "titulo": "Hidrômetros duplicados", "run": hidrometros_duplicados},
    {"sistema": "Clientes", "id": "ligacoes-economias", "titulo": "Ligações e economias", "run": ligacoes_economias},
    {"sistema": "Clientes", "id": "clientes-tarifa", "titulo": "Clientes por tarifa", "run": clientes_tarifa},
    # água
    {"sistema": "Água", "id": "agua-rede-lista", "titulo": "Relatório customizado de rede", "run": rede_lista("agua")},
    {"sistema": "Água", "id": "agua-rede-idade", "titulo": "Extensão de rede / Por diâmetro, material e data de instalação",
     "run": rede_por("agua", ["diametro", "material", "idade"])},
    {"sistema": "Água", "id": "agua-rede-tipo", "titulo": "Extensão de rede / Por tipo", "run": rede_por("agua", ["tipo"])},
    {"sistema": "Água", "id": "agua-rede-diametro", "titulo": "Extensão de rede / Por diâmetro", "run": rede_por("agua", ["diametro"])},
    {"sistema": "Água", "id": "agua-rede-material", "titulo": "Extensão de rede / Por material", "run": rede_por("agua", ["material"])},
    {"sistema": "Água", "id": "agua-rede-material-diametro", "titulo": "Extensão de rede / Por material e diâmetro",
     "run": rede_por("agua", ["material", "diametro"])},
    {"sistema": "Água", "id": "agua-rede-divergencia", "titulo": "Trechos com extensão divergente (qualidade do cadastro)",
     "run": rede_divergencia("agua"), "params": [{"id": "min_m", "rotulo": "Diferença mínima (m)", "tipo": "numero", "padrao": 10},
                {"id": "min_pct", "rotulo": "e (%)", "tipo": "numero", "padrao": 50}]},
    {"sistema": "Água", "id": "agua-pecas", "titulo": "Quantificação de peças", "run": pecas("agua")},
    # esgoto
    {"sistema": "Esgoto", "id": "esgoto-rede-lista", "titulo": "Relatório customizado de rede", "run": rede_lista("esgoto")},
    {"sistema": "Esgoto", "id": "esgoto-rede-idade", "titulo": "Extensão de rede / Por diâmetro, material e data de instalação",
     "run": rede_por("esgoto", ["diametro", "material", "idade"])},
    {"sistema": "Esgoto", "id": "esgoto-rede-tipo", "titulo": "Extensão de rede / Por tipo", "run": rede_por("esgoto", ["tipo"])},
    {"sistema": "Esgoto", "id": "esgoto-rede-material-diametro", "titulo": "Extensão de rede / Por material e diâmetro",
     "run": rede_por("esgoto", ["material", "diametro"])},
    {"sistema": "Esgoto", "id": "esgoto-rede-divergencia", "titulo": "Trechos com extensão divergente (qualidade do cadastro)",
     "run": rede_divergencia("esgoto"), "params": [{"id": "min_m", "rotulo": "Diferença mínima (m)", "tipo": "numero", "padrao": 10},
                {"id": "min_pct", "rotulo": "e (%)", "tipo": "numero", "padrao": 50}]},
    {"sistema": "Esgoto", "id": "esgoto-pecas", "titulo": "Quantificação de peças", "run": pecas("esgoto")},
    {"sistema": "Esgoto", "id": "esgoto-volume-lancado", "titulo": "Volume lançado estimado", "run": volume_esgoto,
     "params": [{"id": "inicio", "rotulo": "De (mês)", "tipo": "mes", "padrao": ""},
                {"id": "fim", "rotulo": "até", "tipo": "mes", "padrao": ""},
                {"id": "fator", "rotulo": "Fator de cálculo", "tipo": "numero", "padrao": 0.6457}]},
    # drenagem
    {"sistema": "Drenagem", "id": "drenagem-rede-idade", "titulo": "Extensão de rede / Por diâmetro, material e data de instalação",
     "run": rede_por("drenagem", ["diametro", "material", "idade"])},
    {"sistema": "Drenagem", "id": "drenagem-rede-tipo", "titulo": "Extensão de rede / Por tipo", "run": rede_por("drenagem", ["tipo"])},
    {"sistema": "Drenagem", "id": "drenagem-rede-material", "titulo": "Extensão de rede / Por material", "run": rede_por("drenagem", ["material"])},
    {"sistema": "Drenagem", "id": "drenagem-rede-diametro", "titulo": "Extensão de rede / Por diâmetro", "run": rede_por("drenagem", ["diametro"])},
    {"sistema": "Drenagem", "id": "drenagem-rede-divergencia", "titulo": "Trechos com extensão divergente (qualidade do cadastro)",
     "run": rede_divergencia("drenagem"), "params": [{"id": "min_m", "rotulo": "Diferença mínima (m)", "tipo": "numero", "padrao": 10},
                {"id": "min_pct", "rotulo": "e (%)", "tipo": "numero", "padrao": 50}]},
    {"sistema": "Drenagem", "id": "drenagem-pecas", "titulo": "Quantificação de peças", "run": pecas("drenagem")},
]
POR_ID = {r["id"]: r for r in CATALOGO}


@router.get("")
async def catalogo():
    return [{k: v for k, v in r.items() if k != "run"} | {"params": r.get("params", [])} for r in CATALOGO]


@router.get("/escopos")
async def escopos():
    out = {}
    for tipo, (tabela, rotulo) in ESCOPOS.items():
        out[tipo] = {"rotulo": rotulo, "itens": await fetch_all(
            f"SELECT fid AS id, btrim(nome) AS nome FROM {tabela} WHERE geometria IS NOT NULL ORDER BY nome")}
    return out


@router.post("/{rid}")
async def executar(rid: str, pedido: Pedido):
    r = POR_ID.get(rid)
    if not r:
        raise HTTPException(404, "Relatório não encontrado")
    res = await r["run"](Ctx(pedido.escopo), pedido.params)
    return {"id": rid, "sistema": r["sistema"], "titulo": r["titulo"], **res}


@router.post("/consumo/atualizar")
async def atualizar_consumo():
    """Recalcula o consumo de 12 meses (rodar após importar faturamento)."""
    async with pool.connection() as conn:
        await conn.execute("REFRESH MATERIALIZED VIEW CONCURRENTLY relatorios.consumo_cliente")
    return {"ok": True, "periodo": await periodo()}
