import { useEffect, useState, type FormEvent } from "react";
import { arquivoUrl, enviarArquivo, excluirArquivo, fmtDate, getArquivos, getTiposDocumento, type Arquivo, type Vinculo } from "../api";
import Icon from "./Icon";

/** Documentos (PDF) de uma ligação ou cruzamento: listar, abrir, enviar e excluir. */
export default function FilesTab({ vinculo }: { vinculo: Vinculo }) {
  const [lista, setLista] = useState<Arquivo[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [form, setForm] = useState(false);
  const key = JSON.stringify(vinculo);

  const carregar = () => {
    setErro(null);
    getArquivos(vinculo)
      .then(setLista)
      .catch((e) => setErro(e.message));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(carregar, [key]);

  const excluir = async (a: Arquivo) => {
    if (!window.confirm(`Excluir o documento "${a.descricao}"? Esta ação não pode ser desfeita.`)) return;
    try {
      await excluirArquivo(a.id);
      carregar();
    } catch (e) {
      setErro((e as Error).message);
    }
  };

  return (
    <div className="files">
      <div className="files__bar">
        <span className="muted">{lista ? `${lista.length} documento${lista.length === 1 ? "" : "s"}` : ""}</span>
        <button type="button" className="btn" onClick={() => setForm((v) => !v)}>
          <Icon name="plus" size={14} /> Anexar PDF
        </button>
      </div>
      {form && (
        <UploadForm
          vinculo={vinculo}
          onDone={() => {
            setForm(false);
            carregar();
          }}
        />
      )}
      {erro && <p className="error-text">{erro}</p>}
      {!lista && !erro && <p className="muted">Carregando…</p>}
      {lista?.length === 0 && <p className="muted">Nenhum documento associado.</p>}
      {!!lista?.length && (
        <table className="attr-table files__table">
          <thead>
            <tr>
              <th scope="col">Arquivo</th>
              <th scope="col">Tipo</th>
              <th scope="col">Data</th>
              <th scope="col" aria-label="Ações" />
            </tr>
          </thead>
          <tbody>
            {lista.map((a) => (
              <tr key={a.id}>
                <th scope="row">{a.descricao}</th>
                <td>{a.tipo_documento ?? "—"}</td>
                <td className="num">{fmtDate(a.data_documento ?? a.data_criacao) ?? "—"}</td>
                <td className="num">
                  {a.disponivel ? (
                    <a className="icon-btn" href={arquivoUrl(a.id)} target="_blank" rel="noreferrer" title="Abrir PDF">
                      <Icon name="download" size={15} />
                    </a>
                  ) : (
                    <span className="icon-btn is-off" title="O PDF deste registro não está disponível neste ambiente (está no servidor de produção)">
                      <Icon name="warning" size={15} />
                    </span>
                  )}
                  <button type="button" className="icon-btn" title="Excluir" onClick={() => excluir(a)}>
                    <Icon name="close" size={15} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function UploadForm({ vinculo, onDone }: { vinculo: Vinculo; onDone: () => void }) {
  const [tipos, setTipos] = useState<string[]>([]);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [descricao, setDescricao] = useState("");
  const [tipo, setTipo] = useState("Croqui Cadastral");
  const [data, setData] = useState(new Date().toISOString().slice(0, 10));
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    getTiposDocumento().then((t) => setTipos(t.filter((x) => !/^(pdf|png|jpe?g)$/i.test(x)))).catch(() => {});
  }, []);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    if (!arquivo) return;
    setEnviando(true);
    setErro(null);
    try {
      await enviarArquivo(vinculo, { arquivo, descricao: descricao || arquivo.name.replace(/\.pdf$/i, ""), tipo, data });
      onDone();
    } catch (err) {
      setErro((err as Error).message);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <form className="upload" onSubmit={enviar}>
      <label>
        Arquivo (PDF)
        <input type="file" accept="application/pdf" required onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} />
      </label>
      <label>
        Descrição
        <input type="text" value={descricao} placeholder={arquivo?.name.replace(/\.pdf$/i, "") ?? ""} onChange={(e) => setDescricao(e.target.value)} />
      </label>
      <div className="upload__row">
        <label>
          Tipo de documento
          <input list="tipos-doc" value={tipo} required onChange={(e) => setTipo(e.target.value)} />
          <datalist id="tipos-doc">
            {tipos.map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
        </label>
        <label>
          Data do documento
          <input type="date" value={data} required onChange={(e) => setData(e.target.value)} />
        </label>
      </div>
      {erro && <p className="error-text">{erro}</p>}
      <button type="submit" className="btn btn--primary" disabled={!arquivo || enviando}>
        {enviando ? "Enviando…" : "Enviar"}
      </button>
    </form>
  );
}
