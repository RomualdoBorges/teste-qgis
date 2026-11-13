"""Inventário agregado (município / área) — função SQL inventario.resumo()."""
import json

from fastapi import APIRouter, HTTPException
from psycopg import errors
from pydantic import BaseModel

from ..db import fetch_one

router = APIRouter(prefix="/inventario", tags=["inventário"])


class Area(BaseModel):
    area: dict | None = None  # geometria GeoJSON em EPSG:4326; null = município


@router.post("/resumo")
async def resumo(body: Area):
    try:
        row = await fetch_one(
            "select inventario.resumo(%s::json) as r",
            (json.dumps(body.area) if body.area else None,),
        )
    except errors.RaiseException as e:
        raise HTTPException(400, str(e.diag.message_primary)) from e
    return row["r"]
