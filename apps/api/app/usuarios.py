"""
Gestão de usuários pela linha de comando (dentro do container da API):

  docker exec -it teste-geoserver-api python -m app.usuarios criar maria --nome "Maria Souza" [--admin] [--gerar-senha]
  docker exec -it teste-geoserver-api python -m app.usuarios senha maria [--gerar-senha]
  docker exec -it teste-geoserver-api python -m app.usuarios desativar maria   (encerra as sessões; vale também
                                                                               para usuários do sistema original)
  docker exec -it teste-geoserver-api python -m app.usuarios ativar maria
  docker exec -it teste-geoserver-api python -m app.usuarios listar

Sem --gerar-senha, a senha é pedida no terminal (não aparece no histórico do shell).
"""
import argparse
import getpass
import secrets
import sys

import psycopg

from .auth import SCHEMA, hash_senha
from .db import DSN

MIN_SENHA = 8


def _senha(gerar: bool) -> str:
    if gerar:
        s = secrets.token_urlsafe(12)
        print(f"Senha gerada (anote, não será mostrada de novo): {s}")
        return s
    s = getpass.getpass("Senha: ")
    if len(s) < MIN_SENHA:
        sys.exit(f"A senha precisa ter pelo menos {MIN_SENHA} caracteres.")
    if getpass.getpass("Repita a senha: ") != s:
        sys.exit("As senhas não conferem.")
    return s


def main() -> None:
    ap = argparse.ArgumentParser(prog="python -m app.usuarios", description="Usuários do geomonitora")
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("criar"); c.add_argument("usuario"); c.add_argument("--nome", required=True)
    c.add_argument("--admin", action="store_true"); c.add_argument("--gerar-senha", action="store_true")
    s = sub.add_parser("senha"); s.add_argument("usuario"); s.add_argument("--gerar-senha", action="store_true")
    for n in ("desativar", "ativar"):
        sub.add_parser(n).add_argument("usuario")
    sub.add_parser("listar")
    a = ap.parse_args()

    with psycopg.connect(DSN, autocommit=True) as conn:
        conn.execute(SCHEMA)
        u = getattr(a, "usuario", "").strip().lower()
        if a.cmd == "criar":
            if conn.execute("SELECT 1 FROM auth.usuarios WHERE origem = 'local' AND usuario = %s", (u,)).fetchone():
                sys.exit(f"O usuário {u} já existe (use 'senha' para trocar a senha).")
            try:
                conn.execute("INSERT INTO auth.usuarios (usuario, nome, senha_hash, admin) VALUES (%s, %s, %s, %s)",
                             (u, a.nome, hash_senha(_senha(a.gerar_senha)), a.admin))
            except psycopg.errors.CheckViolation:
                sys.exit("Nome de usuário inválido: use 3–40 caracteres minúsculos (a-z, 0-9, ponto, hífen, sublinhado).")
            print(f"Usuário {u} criado.")
        elif a.cmd == "senha":
            r = conn.execute("UPDATE auth.usuarios SET senha_hash = %s WHERE origem = 'local' AND usuario = %s RETURNING id",
                             (hash_senha(_senha(a.gerar_senha)), u)).fetchone()
            if not r:
                sys.exit(f"Usuário {u} não encontrado.")
            conn.execute("DELETE FROM auth.sessoes WHERE usuario_id = %s", (r[0],))
            print(f"Senha de {u} alterada; sessões abertas foram encerradas.")
        elif a.cmd in ("desativar", "ativar"):
            # vale para locais e para os do sistema original (bloqueia só aqui; o cadastro original não é alterado)
            r = conn.execute("UPDATE auth.usuarios SET ativo = %s WHERE lower(usuario) = %s RETURNING id",
                             (a.cmd == "ativar", u)).fetchone()
            if not r:
                sys.exit(f"Usuário {u} não encontrado.")
            if a.cmd == "desativar":
                conn.execute("DELETE FROM auth.sessoes WHERE usuario_id = %s", (r[0],))
            print(f"Usuário {u} {'ativado' if a.cmd == 'ativar' else 'desativado'}.")
        else:
            rows = conn.execute("SELECT usuario, nome, admin, ativo, ultimo_login FROM auth.usuarios WHERE origem = 'local' ORDER BY usuario").fetchall()
            print("Locais:" if rows else "Nenhum usuário local.")
            for r in rows:
                print(f"  {r[0]:20} {r[1]:30} {'admin' if r[2] else '     '} {'ativo' if r[3] else 'INATIVO'}  último login: {r[4] or '—'}")
            if conn.execute("SELECT to_regclass('sso.sso_users')").fetchone()[0]:
                n = conn.execute("SELECT count(*) FILTER (WHERE status = 'ativo'), count(*) FROM sso.sso_users").fetchone()
                bloq = conn.execute("SELECT count(*) FROM auth.usuarios WHERE origem = 'sso' AND NOT ativo").fetchone()[0]
                print(f"Do sistema original (sso.sso_users): {n[0]} ativos de {n[1]} — entram com o login e a senha de lá"
                      + (f"; {bloq} bloqueados aqui" if bloq else "") + ".")


if __name__ == "__main__":
    main()
