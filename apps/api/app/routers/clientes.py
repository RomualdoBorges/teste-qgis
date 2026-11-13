"""Ficha do cliente e consumo (equivalente a /comercial/clientes/{id} e /comercial/consumo_mensal_agrupado)."""
from datetime import date

from fastapi import APIRouter, HTTPException

from ..db import fetch_all, fetch_one

router = APIRouter(prefix="/clientes", tags=["clientes"])

# Mesmas junções do repositório original (clientes_repository.get_cliente_by_id)
FICHA = """
  select c.*,
         cat.descricao as categoria_uso_descricao, cat.external_id as categoria_uso_external_id,
         gl.descricao as grupo_leitura_descricao,
         tl.descricao as tipo_ligacao_descricao,
         ct.descricao as classificacao_tarifaria_descricao,
         sl.descricao as status_ligacao_descricao,
         ld.situacao as situacao_ligacao,
         h.codigo_hidrometro, h.grupo as hidrometro_grupo, h.data_instalacao as hidrometro_data_instalacao,
         h.vazao_hidrometro, h.cavalete, h.abrigo, h.diametro as hidrometro_diametro,
         h.marca_hidrometro, h.modelo_hidrometro, h.classe_hidrometro, h.capacidade_hidrometro,
         s.nome as vrp, s.codigo as codigo_vrp, r.prefixo as reservatorio,
         lig.fid as fid_ligacao
    from comercial.com_clientes c
    left join comercial.com_aux_categorias_uso cat on cat.id = c.categoria_uso_id
    left join comercial.com_aux_grupos_leitura gl on gl.id = c.grupo_leitura_id
    left join comercial.com_aux_tipos_ligacao tl on tl.id = c.tipo_ligacao_id
    left join comercial.com_aux_classificacoes_tarifarias ct on ct.id = c.classificacao_tarifaria_id
    left join comercial.com_aux_status_ligacao sl on sl.id = c.status_ligacao_id
    left join lateral (select situacao from comercial.com_ligacoes_dados d where d.iptu = c.inscricao_iptu limit 1) ld on true
    left join lateral (select * from comercial.com_hidrometros h where h.cliente_id = c.id
                        order by h.data_instalacao desc nulls last limit 1) h on true
    left join lateral (select fid, dmc_vrp from agua.saa_ligacoes l where l.inscricao_iptu = c.inscricao_iptu limit 1) lig on true
    left join agua.saa_setorabastecimento s on s.fid = lig.dmc_vrp
    left join agua.vw_saa_reservatorios r on r.id = s.reservatorio_id
   where c.id = %s
"""

GRUPO_LEITURA_POCO = 27  # regra do original: grupo de leitura 27 = cliente com poço artesiano


@router.get("/{cliente_id}")
async def ficha(cliente_id: int):
    c = await fetch_one(FICHA, (cliente_id,))
    if not c:
        raise HTTPException(404, "Cliente não encontrado")
    inst = c["hidrometro_data_instalacao"]
    # original: "Hidrômetro Novo" = instalado há menos de 1 ano
    c["hidrometro_novo"] = bool(inst and (date.today() - inst).days < 365)
    c["poco_artesiano"] = c["grupo_leitura_id"] == GRUPO_LEITURA_POCO
    c.pop("erro_cliente_duplicado_json", None)
    return {k: (v.strip() if isinstance(v, str) else v) for k, v in c.items()}


@router.get("/{codigo_cliente}/consumo-mensal")
async def consumo_mensal(codigo_cliente: str):
    """Consumo faturado por mês, agrupado por ano (função do banco usada pelo original)."""
    return await fetch_all(
        "select * from comercial.fnc_consumo_mensal_agrupado(%s) order by ano_at", (codigo_cliente,)
    )
