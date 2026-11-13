"""
Documentos (PDF) associados a ligações e cruzamentos — tabelas arquivos.arq_arquivos e arq_arquivos_tipos.

Os registros antigos apontam para /src/app/tmp/<nome>.pdf (servidor de produção). Aqui o PDF é procurado
pelo nome dentro de ARQUIVOS_DIR; copie os PDFs de produção para essa pasta para que fiquem acessíveis.
"""
import os
import re
from datetime import date

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse

from ..db import fetch_all, fetch_one, pool

router = APIRouter(prefix="/arquivos", tags=["arquivos"])
ARQUIVOS_DIR = os.environ.get("ARQUIVOS_DIR", "/data/arquivos")
MAX_BYTES = 50 * 1024 * 1024

LISTA = """
  select a.id, a.descricao, a.tipo_documento, a.data_documento, a.data_criacao,
         t.tipo_nome as associacao, t.tipo_id as associacao_id
    from arquivos.arq_arquivos_tipos t
    join arquivos.arq_arquivos a on a.id = t.arquivo_id
   where t.tipo_nome = %s and t.tipo_id = %s
   order by a.data_documento desc nulls last, a.id desc
"""


def _resolver(caminho: str | None) -> str | None:
    if not caminho:
        return None
    if os.path.isfile(caminho):
        return caminho
    local = os.path.join(ARQUIVOS_DIR, os.path.basename(caminho))
    return local if os.path.isfile(local) else None


@router.get("")
async def listar(ligacao: int | None = Query(None), cruzamento: int | None = Query(None)):
    if (ligacao is None) == (cruzamento is None):
        raise HTTPException(400, "Informe ligacao=<fid> ou cruzamento=<fid>")
    tipo, ident = ("ligacao", ligacao) if ligacao is not None else ("cruzamento", cruzamento)
    rows = await fetch_all(LISTA, (tipo, ident))
    caminhos = {r["id"]: r["caminho"] for r in await fetch_all(
        "select id, caminho from arquivos.arq_arquivos where id = any(%s)", ([r["id"] for r in rows],))}
    for r in rows:
        r["disponivel"] = _resolver(caminhos.get(r["id"])) is not None
    return rows


@router.get("/tipos-documento")
async def tipos_documento():
    rows = await fetch_all(
        "select tipo_documento, count(*) n from arquivos.arq_arquivos where tipo_documento is not null "
        "group by 1 order by 2 desc")
    return [r["tipo_documento"] for r in rows]


@router.get("/{arquivo_id}/download")
async def download(arquivo_id: int, inline: bool = True):
    a = await fetch_one("select descricao, caminho from arquivos.arq_arquivos where id = %s", (arquivo_id,))
    if not a:
        raise HTTPException(404, "Arquivo não encontrado")
    path = _resolver(a["caminho"])
    if not path:
        raise HTTPException(404, "O PDF deste registro não está disponível neste ambiente "
                                 f"(esperado: {os.path.basename(a['caminho'] or '')} em {ARQUIVOS_DIR}).")
    nome = a["descricao"] if a["descricao"].lower().endswith(".pdf") else f"{a['descricao']}.pdf"
    return FileResponse(path, media_type="application/pdf", filename=nome,
                        content_disposition_type="inline" if inline else "attachment")


@router.post("", status_code=201)
async def enviar(
    documento: UploadFile = File(...),
    descricao: str = Form(...),
    tipo_documento: str = Form(...),
    data_documento: date = Form(...),
    ligacoes: str = Form(""),      # fids separados por vírgula
    cruzamentos: str = Form(""),   # fids separados por vírgula
):
    ids_lig = [int(x) for x in ligacoes.split(",") if x.strip()]
    ids_cru = [int(x) for x in cruzamentos.split(",") if x.strip()]
    if not ids_lig and not ids_cru:
        raise HTTPException(400, "Associe o documento a pelo menos uma ligação ou cruzamento")
    conteudo = await documento.read()
    if not conteudo.startswith(b"%PDF"):
        raise HTTPException(400, "Envie um arquivo PDF")
    if len(conteudo) > MAX_BYTES:
        raise HTTPException(413, "Arquivo maior que 50 MB")

    os.makedirs(ARQUIVOS_DIR, exist_ok=True)
    async with pool.connection() as conn:
        async with conn.transaction():
            cur = await conn.execute(
                "insert into arquivos.arq_arquivos (descricao, caminho, tipo_documento, data_documento, data_criacao, data_atualizacao) "
                "values (%s, '', %s, %s, now(), now()) returning id",
                (descricao.strip(), tipo_documento.strip(), date.fromisoformat(str(data_documento))),
            )
            arquivo_id = (await cur.fetchone())["id"]
            nome = f"{arquivo_id}_{re.sub(r'[^A-Za-z0-9._-]+', '_', descricao.strip())[:80]}.pdf"
            caminho = os.path.join(ARQUIVOS_DIR, nome)
            with open(caminho, "wb") as f:
                f.write(conteudo)
            await conn.execute("update arquivos.arq_arquivos set caminho = %s where id = %s", (caminho, arquivo_id))
            for tipo, ids in (("ligacao", ids_lig), ("cruzamento", ids_cru)):
                for i in ids:
                    await conn.execute(
                        "insert into arquivos.arq_arquivos_tipos (tipo_nome, tipo_id, arquivo_id, data_criacao, data_atualizacao) "
                        "values (%s, %s, %s, now(), now())", (tipo, i, arquivo_id))
    return {"id": arquivo_id}


@router.delete("/{arquivo_id}")
async def excluir(arquivo_id: int):
    async with pool.connection() as conn:
        async with conn.transaction():
            cur = await conn.execute("select caminho from arquivos.arq_arquivos where id = %s", (arquivo_id,))
            a = await cur.fetchone()
            if not a:
                raise HTTPException(404, "Arquivo não encontrado")
            await conn.execute("delete from arquivos.arq_arquivos_tipos where arquivo_id = %s", (arquivo_id,))
            await conn.execute("delete from arquivos.arq_arquivos where id = %s", (arquivo_id,))
    # só apaga do disco arquivos enviados por esta API (dentro de ARQUIVOS_DIR)
    if a["caminho"] and os.path.dirname(a["caminho"]) == ARQUIVOS_DIR and os.path.isfile(a["caminho"]):
        os.remove(a["caminho"])
    return {"ok": True}
