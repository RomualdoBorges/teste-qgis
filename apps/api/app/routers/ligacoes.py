"""Ligações → clientes (equivalente a /search/ligacao_iptu e /geometry/cartografia/ligacoes do original)."""
import json

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..db import fetch_all, fetch_one

router = APIRouter(prefix="/ligacoes", tags=["ligações"])

CLIENTES_DA_LIGACAO = """
  select c.id, c.codigo_cliente, c.nome, c.endereco_rua, c.endereco_numero, c.endereco_complemento,
         cat.descricao as categoria_de_uso, to_char(c.data_ligacao, 'DD/MM/YYYY') as data_ligacao
    from comercial.com_clientes c
    left join comercial.com_aux_categorias_uso cat on cat.id = c.categoria_uso_id
   where c.inscricao_iptu = %s
   order by c.codigo_cliente
"""


@router.get("/{fid}/clientes")
async def clientes_da_ligacao(fid: int):
    lig = await fetch_one(
        "select fid, inscricao_iptu, zona, quadra, lote from agua.saa_ligacoes where fid = %s", (fid,)
    )
    if not lig:
        raise HTTPException(404, "Ligação não encontrada")
    clientes = await fetch_all(CLIENTES_DA_LIGACAO, (lig["inscricao_iptu"],)) if lig["inscricao_iptu"] else []
    return {"ligacao": lig, "clientes": clientes}


class Area(BaseModel):
    area: dict  # geometria GeoJSON em EPSG:4326


@router.post("/clientes-na-area")
async def clientes_na_area(body: Area):
    """Todas as ligações (e seus clientes) dentro de uma área desenhada no mapa."""
    rows = await fetch_all(
        """
        with area as (select st_transform(st_setsrid(st_geomfromgeojson(%s), 4326), 31983) g)
        select l.fid, l.inscricao_iptu, l.zona, l.quadra, l.lote,
               c.id, c.codigo_cliente, c.nome, c.endereco_rua, c.endereco_numero, c.endereco_complemento,
               cat.descricao as categoria_de_uso, to_char(c.data_ligacao, 'DD/MM/YYYY') as data_ligacao
          from area
          join agua.saa_ligacoes l on l.geometria && area.g and st_intersects(l.geometria, area.g)
          join comercial.com_clientes c on c.inscricao_iptu = l.inscricao_iptu
          left join comercial.com_aux_categorias_uso cat on cat.id = c.categoria_uso_id
         order by l.inscricao_iptu, c.codigo_cliente
         limit 5001
        """,
        (json.dumps(body.area),),
    )
    return {"truncado": len(rows) > 5000, "clientes": rows[:5000]}
