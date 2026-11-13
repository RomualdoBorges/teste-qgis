"""
Login simples: usuários no banco (schema auth), senha com scrypt e sessão no servidor.

- POST /auth/login {usuario, senha} → cookie de sessão (HttpOnly, SameSite=Lax; Secure em HTTPS), 12 h
  renovadas com o uso;
- POST /auth/logout → encerra a sessão;  GET /auth/eu → usuário logado;
- GET /auth/verificar → 204/401 (usado pelo nginx para proteger o GeoServer);
- todas as outras rotas exigem sessão (middleware), exceto /health e a documentação.

Duas origens de usuário:
- os do sistema original (sso.sso_users, do monitora-login-api): entram com o mesmo usuário ou e-mail e a mesma
  senha (bcrypt); só status "ativo". As tabelas sso.* são apenas lidas — se o usuário for desativado lá, as sessões
  daqui deixam de valer;
- locais (auth.usuarios), criados pela linha de comando:  python -m app.usuarios criar <usuario> --nome "Nome"
  Um usuário local com o mesmo nome tem prioridade.
"""
from __future__ import annotations

import asyncio
import base64
import logging
import hashlib
import hmac
import secrets
from datetime import timedelta

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel

try:
    import bcrypt
except ImportError:  # pragma: no cover
    bcrypt = None

from .db import fetch_all, fetch_one, pool

COOKIE = "gm_sessao"
DURACAO = timedelta(hours=12)
PUBLICAS = {"/health", "/auth/login", "/docs", "/openapi.json", "/docs/oauth2-redirect"}

SCHEMA = """
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.usuarios (
  id           serial PRIMARY KEY,
  usuario      text NOT NULL UNIQUE CHECK (usuario = lower(usuario) AND usuario ~ '^[a-z0-9._-]{3,40}$'),
  nome         text NOT NULL,
  senha_hash   text NOT NULL,
  admin        boolean NOT NULL DEFAULT false,
  ativo        boolean NOT NULL DEFAULT true,
  criado_em    timestamptz NOT NULL DEFAULT now(),
  ultimo_login timestamptz
);
CREATE TABLE IF NOT EXISTS auth.sessoes (
  token_hash bytea PRIMARY KEY,
  usuario_id int NOT NULL REFERENCES auth.usuarios(id) ON DELETE CASCADE,
  criada     timestamptz NOT NULL DEFAULT now(),
  expira     timestamptz NOT NULL,
  ip         text,
  agente     text
);
CREATE INDEX IF NOT EXISTS sessoes_expira ON auth.sessoes (expira);
-- usuários do sistema original ganham uma linha-sombra aqui (sem senha), para as sessões
ALTER TABLE auth.usuarios ADD COLUMN IF NOT EXISTS origem text NOT NULL DEFAULT 'local';
ALTER TABLE auth.usuarios ADD COLUMN IF NOT EXISTS sso_id int UNIQUE;
ALTER TABLE auth.usuarios ADD COLUMN IF NOT EXISTS nivel int;
ALTER TABLE auth.usuarios ALTER COLUMN senha_hash DROP NOT NULL;
ALTER TABLE auth.usuarios DROP CONSTRAINT IF EXISTS usuarios_usuario_check;
ALTER TABLE auth.usuarios DROP CONSTRAINT IF EXISTS usuarios_usuario_key;
ALTER TABLE auth.usuarios DROP CONSTRAINT IF EXISTS usuarios_local_check;
ALTER TABLE auth.usuarios ADD CONSTRAINT usuarios_local_check CHECK (
  origem = 'sso' OR (senha_hash IS NOT NULL AND usuario = lower(usuario) AND usuario ~ '^[a-z0-9._-]{3,40}$'));
CREATE UNIQUE INDEX IF NOT EXISTS usuarios_local_unico ON auth.usuarios (usuario) WHERE origem = 'local';
"""

SSO = False  # sso.sso_users existe neste banco? (definido em criar_schema)


async def criar_schema() -> None:
    global SSO
    async with pool.connection() as conn:
        await conn.execute(SCHEMA)
        await conn.execute("DELETE FROM auth.sessoes WHERE expira < now()")
        cur = await conn.execute("SELECT to_regclass('sso.sso_users') IS NOT NULL AS ok")
        SSO = (await cur.fetchone())["ok"] and bcrypt is not None
    logging.getLogger("uvicorn.error").info("login: usuários do sistema original (sso.sso_users) %s",
                                            "habilitados" if SSO else "indisponíveis")


# ------------------------------------------------------------------ senha
_N, _R, _P = 2**14, 8, 1


def hash_senha(senha: str) -> str:
    sal = secrets.token_bytes(16)
    h = hashlib.scrypt(senha.encode(), salt=sal, n=_N, r=_R, p=_P, dklen=32)
    return f"scrypt${_N}${_R}${_P}${base64.b64encode(sal).decode()}${base64.b64encode(h).decode()}"


def confere_senha(senha: str, guardado: str) -> bool:
    try:
        _alg, n, r, p, sal, h = guardado.split("$")
        calc = hashlib.scrypt(senha.encode(), salt=base64.b64decode(sal), n=int(n), r=int(r), p=int(p), dklen=32)
        return hmac.compare_digest(calc, base64.b64decode(h))
    except (ValueError, TypeError):
        return False


# hash de referência para gastar o mesmo tempo quando o usuário não existe
_HASH_FALSO = hash_senha(secrets.token_hex(8))


def _token_hash(token: str) -> bytes:
    return hashlib.sha256(token.encode()).digest()


# ------------------------------------------------------------------ sessão
async def usuario_da_sessao(token: str | None) -> dict | None:
    if not token:
        return None
    th = _token_hash(token)
    sso_ok = ("u.origem = 'local' OR EXISTS (SELECT 1 FROM sso.sso_users o WHERE o.id = u.sso_id AND o.status = 'ativo')"
              if SSO else "u.origem = 'local'")
    row = await fetch_one(
        f"""SELECT u.id, u.usuario, u.nome, u.admin, u.origem, u.nivel, s.expira < now() + %s / 2 AS renovar
             FROM auth.sessoes s JOIN auth.usuarios u ON u.id = s.usuario_id
            WHERE s.token_hash = %s AND s.expira > now() AND u.ativo AND ({sso_ok})""", (DURACAO, th))
    if row and row.pop("renovar"):
        async with pool.connection() as conn:
            await conn.execute("UPDATE auth.sessoes SET expira = now() + %s WHERE token_hash = %s", (DURACAO, th))
    return row


def _rota(request: Request) -> str:
    path = request.scope["path"]
    raiz = request.scope.get("root_path", "")
    return path[len(raiz):] if raiz and path.startswith(raiz) else path


async def exigir_login(request: Request, call_next):
    """Middleware: 401 para qualquer rota fora de PUBLICAS sem sessão válida."""
    if request.method == "OPTIONS" or _rota(request) in PUBLICAS:
        return await call_next(request)
    u = await usuario_da_sessao(request.cookies.get(COOKIE))
    if not u:
        return JSONResponse({"detail": "Sessão expirada ou inexistente. Entre novamente."}, status_code=401)
    request.state.usuario = u
    return await call_next(request)


# ------------------------------------------------------------------ rotas
router = APIRouter(prefix="/auth", tags=["auth"])


class Credenciais(BaseModel):
    usuario: str
    senha: str


def _https(request: Request) -> bool:
    return request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https"


def _bcrypt_ok(senha: str, guardado: str | None) -> bool:
    if not guardado:
        return False
    try:
        return bcrypt.checkpw(senha.encode("utf-8"), guardado.encode("utf-8"))
    except ValueError:  # hash malformado ou senha > 72 bytes
        return False


async def _login_sso(ident: str, senha: str) -> dict | None:
    """Confere no cadastro do sistema original; devolve a linha-sombra em auth.usuarios."""
    cands = await fetch_all(
        """SELECT id, username, name, password, status, level_id FROM sso.sso_users
            WHERE lower(username) = lower(%s) OR lower(email) = lower(%s)
            ORDER BY (lower(username) = lower(%s)) DESC, id""", (ident, ident, ident))
    if not cands or (len(cands) > 1 and cands[0]["username"].lower() != ident.lower()):
        return None  # inexistente ou e-mail ambíguo
    o = cands[0]
    if o["status"] != "ativo" or not await asyncio.to_thread(_bcrypt_ok, senha, o["password"]):
        return None
    async with pool.connection() as conn:
        cur = await conn.execute(
            """INSERT INTO auth.usuarios (usuario, nome, origem, sso_id, nivel)
               VALUES (%s, %s, 'sso', %s, %s)
               ON CONFLICT (sso_id) DO UPDATE SET usuario = EXCLUDED.usuario, nome = EXCLUDED.nome, nivel = EXCLUDED.nivel
               RETURNING id, usuario, nome, admin, ativo""",
            (o["username"].strip(), (o["name"] or o["username"]).strip(), o["id"], o["level_id"]))
        u = await cur.fetchone()
    return u if u["ativo"] else None


@router.post("/login")
async def login(c: Credenciais, request: Request, response: Response):
    ident = c.usuario.strip()
    row = await fetch_one(
        "SELECT id, usuario, nome, admin, senha_hash, ativo FROM auth.usuarios WHERE origem = 'local' AND usuario = %s",
        (ident.lower(),))
    if row:
        ok = confere_senha(c.senha, row["senha_hash"]) and row["ativo"]
    else:
        confere_senha(c.senha, _HASH_FALSO)  # mesmo custo
        row = await _login_sso(ident, c.senha) if SSO else None
        ok = row is not None
    if not ok:
        await asyncio.sleep(0.6)  # freia tentativas em sequência
        raise HTTPException(401, "Usuário ou senha inválidos")
    token = secrets.token_urlsafe(32)
    async with pool.connection() as conn:
        await conn.execute(
            "INSERT INTO auth.sessoes (token_hash, usuario_id, expira, ip, agente) VALUES (%s, %s, now() + %s, %s, %s)",
            (_token_hash(token), row["id"], DURACAO,
             request.headers.get("x-real-ip") or (request.client.host if request.client else None),
             (request.headers.get("user-agent") or "")[:200]))
        await conn.execute("UPDATE auth.usuarios SET ultimo_login = now() WHERE id = %s", (row["id"],))
    response.set_cookie(COOKIE, token, max_age=int(DURACAO.total_seconds()), httponly=True, samesite="lax",
                        secure=_https(request), path="/")
    return {"usuario": row["usuario"], "nome": row["nome"], "admin": row["admin"]}


@router.post("/logout")
async def logout(request: Request, response: Response):
    token = request.cookies.get(COOKIE)
    if token:
        async with pool.connection() as conn:
            await conn.execute("DELETE FROM auth.sessoes WHERE token_hash = %s", (_token_hash(token),))
    response.delete_cookie(COOKIE, path="/")
    return {"ok": True}


@router.get("/eu")
async def eu(request: Request):
    u = request.state.usuario
    return {"usuario": u["usuario"], "nome": u["nome"], "admin": u["admin"], "origem": u["origem"], "nivel": u["nivel"]}


@router.get("/verificar", status_code=204)
async def verificar():
    """Para o auth_request do nginx: chega aqui só quem passou pelo middleware."""
    return Response(status_code=204)
