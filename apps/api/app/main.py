"""
API do visualizador geomonitora.

Reproduz as rotas do inventário do sistema original (geomonitora_api) usadas pelo front:
ligações/clientes, consumo, arquivos, atributos dos ativos e posição de válvulas,
além do resumo agregado (inventário por área).
"""
from fastapi import FastAPI

from contextlib import asynccontextmanager

from . import auth
from .db import fetch_one, lifespan as db_lifespan
from .routers import arquivos, ativos, busca, clientes, inventario, ligacoes, relatorios



@asynccontextmanager
async def lifespan(app_):
    async with db_lifespan(app_):
        await auth.criar_schema()
        yield


app = FastAPI(title="geomonitora API", version="1.0.0", lifespan=lifespan, root_path="/api")
app.middleware("http")(auth.exigir_login)
app.include_router(auth.router)

app.include_router(inventario.router)
app.include_router(ligacoes.router)
app.include_router(clientes.router)
app.include_router(arquivos.router)
app.include_router(ativos.router)
app.include_router(relatorios.router)
app.include_router(busca.router)


@app.get("/health", tags=["status"])
async def health():
    row = await fetch_one("select now() as agora")
    return {"status": "ok", "banco": row["agora"]}
