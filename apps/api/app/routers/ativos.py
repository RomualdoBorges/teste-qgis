"""
Ficha de atributos de um ativo clicado no mapa (equivalente às janelas Conexões, Redes, Válvula,
Rede de Esgoto, Poço/Caixa de Esgoto e Drenagem do original) e edição da posição de válvulas.

Os códigos são traduzidos para a descrição da tabela de domínio: pelas chaves estrangeiras e, nas colunas
sem FK, pelo mapeamento DOMINIOS_EXTRA (conferido contra os dados; código sem par no domínio aparece cru).
"""
from datetime import date, datetime
from decimal import Decimal

from fastapi import APIRouter, HTTPException
from psycopg import errors, sql
from pydantic import BaseModel

from ..db import fetch_all, fetch_one, pool

router = APIRouter(tags=["ativos"])

# camada WMS (sem workspace) → (tabela de onde ler, título, coluna de busca, [tabela/coluna intermediária])
CAMADAS: dict[str, dict] = {
    "agua_saa_conexoes": {"tabela": "agua.saa_conexoes", "titulo": "Conexões"},
    "agua_saa_valvula": {"tabela": "agua.saa_valvula", "titulo": "Válvula", "editavel": "posicao_valvula"},
    "agua_vw_geoserver_front_rede_agua": {"tabela": "agua.saa_rede", "titulo": "Rede de Água"},
    "esgoto_ses_geoserver_rede": {"tabela": "esgoto.ses_rede", "titulo": "Rede de Esgoto"},
    "esgoto_ses_geoserver_poco": {"tabela": "esgoto.ses_poco", "titulo": "Poço de Esgoto"},
    "esgoto_ses_geoserver_caixa_passagem": {"tabela": "esgoto.ses_caixa_passagem", "titulo": "Caixa de Passagem"},
    "esgoto_ses_geoserver_caixa_ligacao": {"tabela": "esgoto.ses_caixa_ligacao", "titulo": "Caixa de Ligação"},
    # drenagem: as tabelas não têm FK; as views do GeoServer já trazem as descrições (*_desc)
    "drenagem_sdu_geoserver_rede": {"tabela": "drenagem.sdu_geoserver_rede", "titulo": "Rede de Drenagem"},
    "drenagem_sdu_rede_drenagem_fluxo": {"tabela": "drenagem.sdu_geoserver_rede", "titulo": "Rede de Drenagem",
                                         "via": ("drenagem.sdu_rede_drenagem_fluxo", "fidrede")},
    "drenagem_sdu_geoserver_boca_lobo": {"tabela": "drenagem.sdu_geoserver_boca_lobo", "titulo": "Boca de Lobo"},
    "drenagem_sdu_geoserver_boca_leao": {"tabela": "drenagem.sdu_geoserver_boca_leao", "titulo": "Boca de Leão"},
    "drenagem_sdu_geoserver_caixa": {"tabela": "drenagem.sdu_geoserver_caixa", "titulo": "Caixa"},
    "drenagem_sdu_geoserver_caixa_acoplada_pv": {"tabela": "drenagem.sdu_geoserver_caixa_acoplada_pv", "titulo": "Caixa Acoplada"},
    "drenagem_sdu_geoserver_poco_visita": {"tabela": "drenagem.sdu_geoserver_poco_visita", "titulo": "Poço de Visita"},
    "drenagem_sdu_geoserver_sarjetao": {"tabela": "drenagem.sdu_geoserver_sarjetao", "titulo": "Sarjetão"},
    "drenagem_sdu_geoserver_valvula_flap": {"tabela": "drenagem.sdu_geoserver_valvula_flap", "titulo": "Válvula Flap"},
    "drenagem_sdu_lancamento_fluxo": {"tabela": "drenagem.sdu_lancamento_fluxo", "titulo": "Lançamento"},
}

_SUB_BACIA = ("esgoto.ses_sub_bacia", "fid", "Sub-bacia")
_DRN = {"estado": ("drenagem.sdu_aestado", "id", None)}

# tabela → coluna → (tabela de domínio, coluna-chave, rótulo do campo ou None)
DOMINIOS_EXTRA: dict[str, dict[str, tuple[str, str, str | None]]] = {
    "agua.saa_valvula": {
        "diametro": ("agua.saa_adiametro", "id", None), "fonte": ("agua.saa_afonte", "id", None),
        "material": ("agua.saa_amaterial", "id", None),
        "setor_abastecimento": ("agua.saa_setorabastecimento", "fid", "DMC / VRP"),
    },
    "agua.saa_rede": {
        "diametro_dn": ("agua.saa_adiametro", "id", None), "diametro_de": ("agua.saa_adiametro", "id", None),
        "funcionamentorede": ("agua.saa_atipo_funcionamento_rede", "id", "Funcionamento da Rede"),
    },
    "esgoto.ses_rede": {
        "classe_pressao": ("esgoto.ses_aclasse_pressao", "id", None),
        "posicao_rede": ("esgoto.ses_aposicao_rede", "id", None),
        "proprietario": ("esgoto.ses_aproprietario", "id", None),
        "bacia_m": _SUB_BACIA,
    },
    "esgoto.ses_poco": {"bacia": _SUB_BACIA},
    "esgoto.ses_caixa_passagem": {
        "fonte": ("esgoto.ses_afonte", "id", None), "inspecao": ("esgoto.ses_ainspecao", "id", None),
        "condicao_operacao": ("esgoto.ses_acodigo_operacao_poco", "id", None), "bacia": _SUB_BACIA,
    },
    "esgoto.ses_caixa_ligacao": {"fonte": ("esgoto.ses_afonte", "id", None), "bacia": _SUB_BACIA},
    # views de drenagem: só as colunas que a view não traduz em *_desc
    "drenagem.sdu_geoserver_poco_visita": {**_DRN, "tp_estrut": ("drenagem.sdu_atipo_estrutura", "id", "Tipo de Estrutura"),
                                           "mat_tamp": ("drenagem.sdu_amaterial_tampa", "id", "Material da Tampa")},
    "drenagem.sdu_geoserver_caixa_acoplada_pv": {**_DRN, "tipo_estrut": ("drenagem.sdu_atipo_estrutura", "id", "Tipo de Estrutura"),
                                                 "mat_tamp": ("drenagem.sdu_amaterial_tampa", "id", "Material da Tampa")},
    "drenagem.sdu_geoserver_caixa": {**_DRN, "tp_estrut": ("drenagem.sdu_atipo_estrutura", "id", "Tipo de Estrutura")},
    "drenagem.sdu_geoserver_boca_lobo": _DRN,
    "drenagem.sdu_geoserver_boca_leao": _DRN,
    "drenagem.sdu_geoserver_sarjetao": _DRN,
    "drenagem.sdu_geoserver_valvula_flap": {**_DRN, "implantacao": ("drenagem.sdu_aimplantacao", "id", "Implantação"),
                                            "diametro": ("drenagem.sdu_adiametro", "id", None)},
}

OCULTAS = {"geometria", "sckey", "inicio_old", "fim_old", "tabela_inicio_old", "tabela_fim_old", "rede_reverse",
           "merged_geom", "the_geom", "geom"}

ROTULOS = {
    "fid": "Identificador", "utme": "UTM E", "utmn": "UTM N", "cota_terreno": "Cota do Terreno",
    "cota_peca": "Cota da Peça", "cota_tampao": "Cota do Tampão", "cota_fundo": "Cota de Fundo",
    "data_implantacao": "Data Implantação", "data_insercao": "Data Inserção", "data_modificacao": "Data Modificação",
    "inserido_por": "Inserido Por", "modificado_por": "Modificado Por", "implantado_por": "Implantado Por",
    "nrdocorigem": "Nr Doc Origem", "observacao": "Observação", "setordeabastecimento": "Setor de Abastecimento",
    "setor_abastecimento": "Setor de Abastecimento", "dmc_vrp": "DMC / VRP", "tipo_peca": "Tipo da Peça",
    "tipo_ponto": "Tipo do Ponto", "diametro1": "Diâmetro 1", "diametro2": "Diâmetro 2", "diametro": "Diâmetro",
    "posicao_valvula": "Posição da Válvula", "tipo_valvula": "Tipo da Válvula", "tipo_junta": "Tipo da Junta",
    "funcao_valvula": "Função da Válvula", "codigo_operacao": "Código de Operação",
    "extensao_grafica": "Extensão Gráfica (m)", "extensao_informada": "Extensão Informada (m)",
    "profundidade_media": "Profundidade Média", "distancia_medaparente": "Distância Média Aparente",
    "tipo_rede": "Tipo de Rede", "situacao_rede": "Situação da Rede", "posicao_rede": "Posição da Rede",
    "classe_pressao": "Classe de Pressão", "tipo_agua": "Tipo de Água", "inicio_fid": "Nó Inicial",
    "fim_fid": "Nó Final", "diametro_dn": "Diâmetro DN", "diametro_de": "Diâmetro DE",
    "tipo_poco": "Tipo do Poço", "nome_poco_visita": "Nome do Poço de Visita", "condicao_operacao": "Condição de Operação",
    "condicao_acesso": "Condição de Acesso", "profundidade_montante": "Profundidade Montante",
    "profundidade_jusante": "Profundidade Jusante", "cota_montante": "Cota Montante", "cota_jusante": "Cota Jusante",
    "metodo_construtivo": "Método Construtivo", "tipo_seccao": "Tipo de Seção", "ligacao_montante": "Ligação Montante",
    "prof_ent": "Profundidade de Entrada", "prof_entr": "Profundidade de Entrada", "prof_entrada": "Profundidade de Entrada",
    "prof_saida": "Profundidade de Saída", "subbacia": "Sub-bacia", "codlogradouro": "Cód. Logradouro",
    "proprietario": "Proprietário", "inspecao": "Inspeção", "funcionamentorede": "Funcionamento da Rede",
    "nome_empr": "Empreiteira", "n_processo": "Nº Processo", "declividade": "Declividade",
}


def rotulo(col: str) -> str:
    if col in ROTULOS:
        return ROTULOS[col]
    base = col[:-5] if col.endswith("_desc") else col
    return ROTULOS.get(base, base.replace("_", " ").strip().capitalize())


def formatar(v):
    if v is None or v == "":
        return None
    if isinstance(v, datetime):
        return v.strftime("%d/%m/%Y %H:%M") if (v.hour, v.minute) != (0, 0) else v.strftime("%d/%m/%Y")
    if isinstance(v, date):
        return v.strftime("%d/%m/%Y")
    if isinstance(v, bool):
        return "Sim" if v else "Não"
    if isinstance(v, (Decimal, float)):
        f = float(v)
        return round(f, 3) if abs(f) < 1e5 else round(f, 2)
    if isinstance(v, str):
        return v.strip() or None
    return v


async def dominios(tabela: str) -> dict[str, tuple[str, str]]:
    """coluna → (tabela de domínio, coluna-chave): FKs para tabelas com "descricao" ou "nome", mais DOMINIOS_EXTRA."""
    rows = await fetch_all(
        """
        select a.attname as coluna, format('%%I.%%I', fn.nspname, f.relname) as dominio, fa.attname as chave
          from pg_constraint co
          join pg_attribute a on a.attrelid = co.conrelid and a.attnum = co.conkey[1]
          join pg_attribute fa on fa.attrelid = co.confrelid and fa.attnum = co.confkey[1]
          join pg_class f on f.oid = co.confrelid join pg_namespace fn on fn.oid = f.relnamespace
         where co.contype = 'f' and co.conrelid = %s::regclass and array_length(co.conkey, 1) = 1
           and exists (select 1 from pg_attribute d where d.attrelid = co.confrelid and d.attname in ('descricao', 'nome'))
        """, (tabela,))
    doms = {r["coluna"]: (r["dominio"], r["chave"]) for r in rows}
    doms.update({c: (d, k) for c, (d, k, _) in DOMINIOS_EXTRA.get(tabela, {}).items()})
    return doms


@router.get("/ativos/{camada}/{fid}")
async def ativo(camada: str, fid: int):
    cfg = CAMADAS.get(camada.split(":")[-1])
    if not cfg:
        raise HTTPException(404, f"A camada {camada} não tem ficha de inventário")
    chave = fid
    if "via" in cfg:
        tab, col = cfg["via"]
        r = await fetch_one(sql.SQL("select {} as k from {} where fid = %s").format(
            sql.Identifier(col), sql.SQL(tab)), (fid,))
        if not r or r["k"] is None:
            raise HTTPException(404, "Ativo não encontrado")
        chave = r["k"]

    row = await fetch_one(sql.SQL("select * from {} where fid = %s").format(sql.SQL(cfg["tabela"])), (chave,))
    if not row:
        raise HTTPException(404, "Ativo não encontrado")

    doms = await dominios(cfg["tabela"])
    labels: dict[str, str] = {}
    for col, (dom, key) in doms.items():
        if row.get(col) is not None:
            d = await fetch_one(sql.SQL(
                "select coalesce(nullif(btrim(to_jsonb(t)->>'descricao'), ''), nullif(btrim(to_jsonb(t)->>'nome'), ''), "
                "nullif(btrim(to_jsonb(t)->>'valor'), '')) as descricao "
                "from {} t where {}::text = %s").format(sql.SQL(dom), sql.Identifier(key)), (str(row[col]),))
            if d and d["descricao"]:
                labels[col] = str(d["descricao"]).strip()

    rotulos_extra = {c: r for c, (_, _, r) in DOMINIOS_EXTRA.get(cfg["tabela"], {}).items() if r}
    campos = []
    for col, v in row.items():
        if col in OCULTAS or col.endswith("_old"):
            continue
        if f"{col}_desc" in row:       # mostra só a versão com descrição
            continue
        valor = labels.get(col, formatar(v))
        campos.append({"campo": col, "rotulo": rotulos_extra.get(col) or rotulo(col), "valor": valor})

    resp = {"camada": camada, "titulo": cfg["titulo"], "fid": row["fid"], "campos": campos}
    if cfg.get("editavel") == "posicao_valvula":
        resp["edicao"] = {
            "campo": "posicao_valvula",
            "valor": row["posicao_valvula"],
            "opcoes": await fetch_all("select id, btrim(descricao) as descricao from agua.saa_aposicao_valvula order by id"),
        }
    return resp


class Posicao(BaseModel):
    posicao_valvula: int


@router.put("/valvulas/{fid}/posicao")
async def atualizar_posicao(fid: int, body: Posicao):
    """Equivalente a PUT /updates/valvulas/{id} do original (dispara os triggers de trace da rede)."""
    try:
        async with pool.connection() as conn:
            async with conn.transaction():
                cur = await conn.execute(
                    "update agua.saa_valvula set posicao_valvula = %s where fid = %s returning fid, posicao_valvula",
                    (body.posicao_valvula, fid))
                row = await cur.fetchone()
    except errors.ForeignKeyViolation as e:
        raise HTTPException(400, "Posição inválida") from e
    except errors.Error as e:
        # ex.: os triggers de trace (refresh de agua.flow_trace_network) falham neste banco
        raise HTTPException(409, f"O banco recusou a alteração: {e.diag.message_primary}") from e
    if not row:
        raise HTTPException(404, "Válvula não encontrada")
    return row
