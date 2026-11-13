"""Pool de conexões com o Postgres (psycopg 3, async)."""
import os
from contextlib import asynccontextmanager

from psycopg.rows import dict_row
from psycopg_pool import AsyncConnectionPool

DSN = os.environ.get("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/geomonitora")
pool = AsyncConnectionPool(DSN, min_size=1, max_size=10, open=False, kwargs={"row_factory": dict_row})


@asynccontextmanager
async def lifespan(_app):
    await pool.open()
    yield
    await pool.close()


async def fetch_all(sql: str, params=None) -> list[dict]:
    async with pool.connection() as conn:
        cur = await conn.execute(sql, params)
        return await cur.fetchall()


async def fetch_one(sql: str, params=None) -> dict | None:
    async with pool.connection() as conn:
        cur = await conn.execute(sql, params)
        return await cur.fetchone()
