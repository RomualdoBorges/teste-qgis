"""
Busca do mapa: clientes (código, IPTU, CPF/CNPJ, hidrômetro, nome ou endereço), logradouros e áreas
(DMC/VRP, setores, bacias). Cada resultado traz onde dar zoom (EPSG:4326) e, para clientes, a ligação do lote.
Texto é comparado sem acento e sem caixa (relatorios.norm + índice trigram).
"""
import re

from fastapi import APIRouter, Query

from ..db import fetch_all

router = APIRouter(tags=["busca"])

TIPOS_LOGRADOURO = {"r", "rua", "av", "avenida", "al", "alameda", "tv", "trav", "travessa", "pc", "praca", "pca",
                    "est", "estrada", "rod", "rodovia", "vl", "viela", "lg", "largo", "pq", "parque", "n", "no", "nº"}

AREAS = [
    ("agua.saa_setorabastecimento", "DMC / VRP"),
    ("agua.saa_setorreservatorios", "Setor de abastecimento"),
    ("esgoto.ses_sub_bacia", "Bacia de esgotamento"),
    ("drenagem.sdu_lim_bacias_drenagem", "Bacia de drenagem"),
]

# ponto da ligação do lote do cliente (o original localiza o cliente pela ligação/IPTU)
_CLIENTE = """
    SELECT 'cliente' AS tipo, c.id AS cliente_id, l.fid AS ligacao_fid, c.codigo_cliente,
           btrim(c.nome) AS titulo,
           concat_ws(' · ', 'Cód. ' || c.codigo_cliente,
                     nullif(concat_ws(', ', nullif(btrim(c.endereco_rua), ''), nullif(btrim(c.endereco_numero), '')), ''),
                     nullif(btrim(c.endereco_bairro), '')) AS detalhe,
           CASE WHEN l.geometria IS NOT NULL THEN
             ARRAY[ST_X(ST_Transform(l.geometria, 4326)), ST_Y(ST_Transform(l.geometria, 4326))] END AS ponto
      FROM comercial.com_clientes c
      LEFT JOIN LATERAL (SELECT fid, geometria FROM agua.saa_ligacoes l
                          WHERE l.inscricao_iptu = c.inscricao_iptu ORDER BY fid LIMIT 1) l ON true
"""


@router.get("/busca")
async def busca(q: str = Query(..., min_length=2, max_length=100)):
    q = q.strip()
    digitos = re.sub(r"\D", "", q)
    # endereço: ignora pontuação e o tipo de logradouro ("rua", "av."…), que o cadastro de clientes não guarda
    termos = [t.strip(".,;:-º°") for t in re.split(r"[\s,;/]+", q)]
    termos = [t for t in termos if t and _norm(t) not in TIPOS_LOGRADOURO] or [q]
    out: list[dict] = []      # identificadores exatos
    texto: list[dict] = []    # clientes por nome/endereço
    lugares: list[dict] = []  # logradouros e áreas

    # 1) identificadores exatos (código do cliente, IPTU, CPF/CNPJ, hidrômetro)
    if len(digitos) >= 4 or re.fullmatch(r"[A-Za-z]\d[\w]+", q):
        out += await fetch_all(_CLIENTE + """
             WHERE c.codigo_cliente = %(q)s OR c.inscricao_iptu = %(q)s OR c.inscricao_iptu = %(d)s
                OR (length(%(d)s) >= 11 AND (regexp_replace(c.cpf, '\\D', '', 'g') = %(d)s
                                            OR regexp_replace(c.cnpj, '\\D', '', 'g') = %(d)s))
                OR c.id IN (SELECT cliente_id FROM comercial.com_hidrometros WHERE upper(codigo_hidrometro) = upper(%(q)s))
             ORDER BY c.codigo_cliente LIMIT 10""", {"q": q, "d": digitos or q})

    # 2) nome / endereço: todos os termos precisam aparecer
    if len(q) >= 3 and len(out) < 10:
        conds = " AND ".join(f"relatorios.norm(c.nome, c.endereco_rua, c.endereco_numero, c.endereco_bairro) LIKE %(t{i})s"
                             for i in range(len(termos)))
        params = {f"t{i}": f"%{_norm(t)}%" for i, t in enumerate(termos)}
        vistos = {r["cliente_id"] for r in out}
        texto += [r for r in await fetch_all(_CLIENTE + f" WHERE {conds} ORDER BY btrim(c.nome) LIMIT 10", params)
                if r["cliente_id"] not in vistos]

    # 3) logradouros (extensão da rua inteira)
    if len(q) >= 3:
        conds = " AND ".join(f"relatorios.norm(nomeusual) LIKE %(t{i})s" for i in range(len(termos)))
        params = {f"t{i}": f"%{_norm(t)}%" for i, t in enumerate(termos)}
        lugares += await fetch_all(f"""
            SELECT 'logradouro' AS tipo, btrim(nomeusual) AS titulo, 'Logradouro' || coalesce(' · cód. ' || codigo, '') AS detalhe,
                   ARRAY[ST_XMin(e), ST_YMin(e), ST_XMax(e), ST_YMax(e)] AS extent
              FROM (SELECT nomeusual, codigo, ST_Transform(ST_SetSRID(ST_Extent(geometria)::geometry, 31983), 4326) AS e
                      FROM cartografia.cart_logradouros WHERE {conds} GROUP BY nomeusual, codigo) s
             ORDER BY length(nomeusual), nomeusual LIMIT 6""", params)

        # 4) áreas operacionais
        for tabela, rotulo in AREAS:
            lugares += await fetch_all(f"""
                SELECT 'area' AS tipo, btrim(nome) AS titulo, %(rotulo)s AS detalhe,
                       ARRAY[ST_XMin(e), ST_YMin(e), ST_XMax(e), ST_YMax(e)] AS extent
                  FROM (SELECT nome, ST_Transform(ST_Envelope(geometria), 4326) AS e FROM {tabela}
                         WHERE geometria IS NOT NULL AND {conds.replace('nomeusual', 'nome')}) s
                 ORDER BY nome LIMIT 4""", {**params, "rotulo": rotulo})
    # ordem: identificador exato > ruas e áreas > clientes por nome/endereço
    return (out + lugares + texto)[:30]


def _norm(t: str) -> str:
    import unicodedata
    return "".join(ch for ch in unicodedata.normalize("NFD", t.lower()) if unicodedata.category(ch) != "Mn")
