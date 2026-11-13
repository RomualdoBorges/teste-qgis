import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  fmtDate,
  gerarRelatorio,
  getCatalogo,
  getEscopos,
  type ColunaRelatorio,
  type Escopo,
  type Escopos,
  type ItemCatalogo,
  type LinhaRelatorio,
  type Relatorio,
  type TipoEscopo,
} from "../api";
import { baixar, slug, toCsv } from "../csv";
import Icon from "./Icon";

interface Props {
  /** área desenhada no mapa para o escopo "área" (GeoJSON 4326) */
  area: object | null;
  onDrawArea: () => void;
  onOpenCliente: (clienteId: number, fidLigacao: number | null) => void;
  onOpenAtivo: (camada: string, fid: number) => void;
  onClose: () => void;
}

const TIPOS: { id: TipoEscopo; rotulo: string }[] = [
  { id: "global", rotulo: "Município inteiro" },
  { id: "dmc", rotulo: "por DMC / VRP" },
  { id: "setor", rotulo: "por Setor de abastecimento" },
  { id: "bacia_esgoto", rotulo: "por Bacia de esgotamento" },
  { id: "bacia_drenagem", rotulo: "por Bacia de drenagem" },
  { id: "area", rotulo: "por Área desenhada no mapa" },
];
const LIMITE_TELA = 1000;

/** Relatórios de clientes, água, esgoto e drenagem (módulo Relatórios do original). */
export default function ReportsView({ area, onDrawArea, onOpenCliente, onOpenAtivo, onClose }: Props) {
  const [catalogo, setCatalogo] = useState<ItemCatalogo[] | null>(null);
  const [escopos, setEscopos] = useState<Escopos | null>(null);
  const [erroCat, setErroCat] = useState<string | null>(null);
  const [atual, setAtual] = useState<string | null>(null);
  const [tipo, setTipo] = useState<TipoEscopo>("global");
  const [escId, setEscId] = useState<number | "">("");
  const [params, setParams] = useState<Record<string, Record<string, string | number>>>({});
  const [res, setRes] = useState<{ rel: Relatorio | null; loading: boolean; erro: string | null }>({ rel: null, loading: false, erro: null });
  const ctrl = useRef<AbortController | null>(null);

  useEffect(() => {
    Promise.all([getCatalogo(), getEscopos()])
      .then(([c, e]) => (setCatalogo(c), setEscopos(e)))
      .catch((e) => setErroCat(e.message));
  }, []);

  const item = catalogo?.find((c) => c.id === atual) ?? null;
  const valores = (it: ItemCatalogo) => ({ ...Object.fromEntries(it.params.map((p) => [p.id, p.padrao])), ...params[it.id] });

  const escopo: Escopo | null =
    tipo === "global" ? { tipo } : tipo === "area" ? (area ? { tipo, area } : null) : escId === "" ? null : { tipo, id: escId };
  const escopoRotulo =
    tipo === "global"
      ? "Município inteiro"
      : tipo === "area"
        ? "Área desenhada"
        : `${escopos?.[tipo].rotulo}: ${escopos?.[tipo].itens.find((i) => i.id === escId)?.nome ?? "—"}`;

  const gerar = (it = item, esc = escopo) => {
    if (!it || !esc) return;
    ctrl.current?.abort();
    const c = new AbortController();
    ctrl.current = c;
    setRes((r) => ({ ...r, loading: true, erro: null }));
    gerarRelatorio(it.id, esc, valores(it), c.signal)
      .then((rel) => !c.signal.aborted && setRes({ rel, loading: false, erro: null }))
      .catch((e) => !c.signal.aborted && setRes({ rel: null, loading: false, erro: e.message }));
  };

  // gera ao escolher o relatório ou mudar o escopo
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => gerar(), [atual, tipo, escId, area]);

  const porSistema = useMemo(() => {
    const m = new Map<string, ItemCatalogo[]>();
    catalogo?.forEach((c) => m.set(c.sistema, [...(m.get(c.sistema) ?? []), c]));
    return [...m];
  }, [catalogo]);

  return (
    <section className="reports" aria-label="Relatórios">
      <nav className="reports__nav" aria-label="Catálogo de relatórios">
        {erroCat && <p className="error-text">{erroCat}</p>}
        {!catalogo && !erroCat && <p className="muted">Carregando…</p>}
        {porSistema.map(([sistema, itens]) => (
          <div key={sistema}>
            <h3>{sistema}</h3>
            {itens.map((c) => (
              <button
                key={c.id}
                type="button"
                className={`reports__link ${c.id === atual ? "reports__link--sel" : ""}`}
                aria-current={c.id === atual}
                onClick={() => setAtual(c.id)}
              >
                {c.titulo}
              </button>
            ))}
          </div>
        ))}
      </nav>

      <div className="reports__main">
        <header className="reports__head">
          <h2>
            {item ? (
              <>
                <span className="muted">{item.sistema} · </span>
                {item.titulo}
              </>
            ) : (
              "Relatórios"
            )}
          </h2>
          <button type="button" className="icon-btn" title="Fechar relatórios" onClick={onClose}>
            <Icon name="close" size={16} />
          </button>
        </header>

        <div className="reports__controls">
          <label>
            Priorização
            <select value={tipo} onChange={(e) => (setTipo(e.target.value as TipoEscopo), setEscId(""))}>
              {TIPOS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.rotulo}
                </option>
              ))}
            </select>
          </label>
          {tipo !== "global" && tipo !== "area" && escopos && (
            <label>
              {escopos[tipo].rotulo}
              <select value={escId} onChange={(e) => setEscId(e.target.value === "" ? "" : Number(e.target.value))}>
                <option value="">Escolha…</option>
                {escopos[tipo].itens.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.nome}
                  </option>
                ))}
              </select>
            </label>
          )}
          {tipo === "area" && (
            <button type="button" className="btn" onClick={onDrawArea}>
              <Icon name="draw" size={15} /> {area ? "Redesenhar área" : "Desenhar área no mapa"}
            </button>
          )}
          {item?.params.map((p) => {
            const v = valores(item)[p.id];
            const set = (nv: string) => setParams((ps) => ({ ...ps, [item.id]: { ...ps[item.id], [p.id]: nv } }));
            return (
              <label key={p.id}>
                {p.rotulo}
                {p.tipo === "select" ? (
                  <select value={String(v)} onChange={(e) => set(e.target.value)}>
                    {p.opcoes!.map((o) => (
                      <option key={o} value={o}>
                        {o || "Todas"}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={p.tipo === "numero" ? "number" : p.tipo === "data" ? "date" : "month"}
                    step={p.tipo === "numero" ? "any" : undefined}
                    value={String(v ?? "")}
                    onChange={(e) => set(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && gerar()}
                  />
                )}
              </label>
            );
          })}
          {item && item.params.length > 0 && (
            <button type="button" className="btn btn--primary" onClick={() => gerar()} disabled={!escopo || res.loading}>
              Gerar
            </button>
          )}
        </div>

        <div className="reports__body">
          {!item && <p className="muted">Escolha um relatório à esquerda.</p>}
          {item && !escopo && (
            <p className="muted">{tipo === "area" ? "Desenhe a área no mapa para gerar o relatório." : "Escolha o item da priorização."}</p>
          )}
          {item && escopo && res.loading && <p className="muted">Gerando relatório…</p>}
          {res.erro && <p className="error-text">Não foi possível gerar: {res.erro}</p>}
          {item && escopo && res.rel && res.rel.id === item.id && !res.loading && (
            <ReportTable
              key={`${res.rel.id}`}
              rel={res.rel}
              escopo={escopoRotulo}
              onRow={(l) => {
                if (res.rel?.abre === "cliente" && l.id != null) onOpenCliente(Number(l.id), l.fid_ligacao == null ? null : Number(l.fid_ligacao));
                else if (res.rel?.camada && l.fid != null) onOpenAtivo(res.rel.camada, Number(l.fid));
              }}
            />
          )}
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- tabela
const nf = (min: number, max = min) => new Intl.NumberFormat("pt-BR", { minimumFractionDigits: min, maximumFractionDigits: max });
const FMT: Record<string, (v: number) => string> = {
  inteiro: (v) => nf(0).format(v),
  decimal: (v) => nf(0, 2).format(v),
  km: (v) => nf(3).format(v),
  pct: (v) => `${nf(2).format(v)} %`,
};
function formatar(c: ColunaRelatorio, v: LinhaRelatorio[string]) {
  if (v == null || v === "") return "—";
  if (c.tipo === "data") return fmtDate(v) ?? "—";
  if (c.tipo in FMT) return FMT[c.tipo](Number(v));
  return String(v);
}
const numerica = (c: ColunaRelatorio) => c.tipo !== "texto" && c.tipo !== "data";

function ReportTable({ rel, escopo, onRow }: { rel: Relatorio; escopo: string; onRow: (l: LinhaRelatorio) => void }) {
  const [filtro, setFiltro] = useState("");
  const [ordem, setOrdem] = useState<{ col: string; asc: boolean } | null>(null);
  const [ocultas, setOcultas] = useState<Set<string>>(new Set());
  const [imprimindo, setImprimindo] = useState(false);
  const clicavel = rel.abre === "cliente" || !!rel.camada;
  const lista = clicavel; // relatórios-lista: escolher colunas
  const cols = rel.colunas.filter((c) => !ocultas.has(c.id));

  const linhas = useMemo(() => {
    const t = filtro.trim().toLowerCase();
    let ls = t ? rel.linhas.filter((l) => rel.colunas.some((c) => String(l[c.id] ?? "").toLowerCase().includes(t))) : rel.linhas;
    if (ordem) {
      const c = rel.colunas.find((x) => x.id === ordem.col)!;
      const k = (l: LinhaRelatorio) => (numerica(c) ? Number(l[c.id] ?? -Infinity) : String(l[c.id] ?? ""));
      ls = ls.slice().sort((a, b) => {
        const [x, y] = [k(a), k(b)];
        const r = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), "pt-BR", { numeric: true });
        return ordem.asc ? r : -r;
      });
    }
    return ls;
  }, [rel, filtro, ordem]);

  const totais = useMemo(
    () => Object.fromEntries(rel.colunas.filter((c) => c.soma).map((c) => [c.id, linhas.reduce((s, l) => s + Number(l[c.id] ?? 0), 0)])),
    [rel, linhas],
  );
  const maxBarra = rel.barra ? Math.max(0, ...linhas.map((l) => Number(l[rel.barra!] ?? 0))) : 0;
  const temTotal = cols.some((c) => c.soma) && linhas.length > 1;

  const exportar = () => {
    const csv = toCsv(
      cols.map((c) => c.rotulo),
      linhas.map((l) =>
        cols.map((c) =>
          c.tipo === "data" ? fmtDate(l[c.id]) : c.tipo === "pct" && l[c.id] != null ? Math.round(Number(l[c.id]) * 100) / 100 : l[c.id],
        ),
      ),
      [rel.titulo, escopo, `Emitido em ${new Date().toLocaleString("pt-BR")}`],
    );
    baixar(`${slug(`${rel.sistema} ${rel.titulo}`)}.csv`, csv);
  };

  useEffect(() => {
    if (!imprimindo) return;
    const done = () => setImprimindo(false);
    window.addEventListener("afterprint", done, { once: true });
    const t = setTimeout(() => window.print(), 50);
    return () => (clearTimeout(t), window.removeEventListener("afterprint", done));
  }, [imprimindo]);

  const ordenar = (id: string) => setOrdem((o) => (o?.col === id ? (o.asc ? { col: id, asc: false } : null) : { col: id, asc: true }));

  const tabela = (todas: boolean) => (
    <table className="report-table">
      <thead>
        <tr>
          {cols.map((c) => (
            <th
              key={c.id}
              scope="col"
              className={numerica(c) ? "num" : ""}
              aria-sort={ordem?.col === c.id ? (ordem.asc ? "ascending" : "descending") : undefined}
            >
              {todas ? (
                c.rotulo
              ) : (
                <button type="button" onClick={() => ordenar(c.id)} title="Ordenar">
                  {c.rotulo}
                  {ordem?.col === c.id ? (ordem.asc ? " ▲" : " ▼") : ""}
                </button>
              )}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {(todas ? linhas : linhas.slice(0, LIMITE_TELA)).map((l, i) => (
          <tr
            key={i}
            className={clicavel && !todas ? "report-table__click" : ""}
            onClick={clicavel && !todas ? () => onRow(l) : undefined}
            tabIndex={clicavel && !todas ? 0 : undefined}
            onKeyDown={clicavel && !todas ? (e) => e.key === "Enter" && onRow(l) : undefined}
          >
            {cols.map((c) => (
              <td key={c.id} className={numerica(c) ? "num" : ""}>
                {c.id === rel.barra ? (
                  <span className="report-bar">
                    <span className="report-bar__track" aria-hidden="true">
                      <span
                        className="report-bar__fill"
                        style={{ width: `${c.tipo === "pct" ? Number(l[c.id] ?? 0) : maxBarra ? (Number(l[c.id] ?? 0) / maxBarra) * 100 : 0}%` }}
                      />
                    </span>
                    {formatar(c, l[c.id])}
                  </span>
                ) : (
                  formatar(c, l[c.id])
                )}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
      {temTotal && (
        <tfoot>
          <tr>
            {cols.map((c, i) => (
              <td key={c.id} className={numerica(c) ? "num" : ""}>
                {c.soma ? formatar(c, totais[c.id]) : i === 0 ? "Total" : ""}
              </td>
            ))}
          </tr>
        </tfoot>
      )}
    </table>
  );

  return (
    <div className="report">
      <div className="report__bar">
        <span className="muted small">
          {escopo} · {linhas.length.toLocaleString("pt-BR")} {linhas.length === 1 ? "linha" : "linhas"}
          {rel.truncado && " (limitado às primeiras 5.000 — use a priorização para recortar)"}
          {rel.nota && ` · ${rel.nota}`}
        </span>
        <span className="report__actions">
          <input className="search-input" type="search" placeholder="Filtrar…" value={filtro} onChange={(e) => setFiltro(e.target.value)} />
          {lista && (
            <details className="report__cols">
              <summary className="btn">Colunas</summary>
              <div>
                {rel.colunas.map((c) => (
                  <label key={c.id}>
                    <input
                      type="checkbox"
                      checked={!ocultas.has(c.id)}
                      onChange={() =>
                        setOcultas((s) => {
                          const n = new Set(s);
                          if (n.has(c.id)) n.delete(c.id);
                          else if (cols.length > 1) n.add(c.id);
                          return n;
                        })
                      }
                    />
                    {c.rotulo}
                  </label>
                ))}
              </div>
            </details>
          )}
          <button type="button" className="btn" onClick={exportar} disabled={!linhas.length}>
            <Icon name="download" size={15} /> CSV
          </button>
          <button type="button" className="btn" onClick={() => setImprimindo(true)} disabled={!linhas.length}>
            <Icon name="print" size={15} /> Imprimir
          </button>
        </span>
      </div>
      {linhas.length ? (
        <div className="report__scroll">{tabela(false)}</div>
      ) : (
        <p className="muted">Nenhum dado {filtro ? "para o filtro" : "no escopo escolhido"}.</p>
      )}
      {linhas.length > LIMITE_TELA && (
        <p className="muted small">
          Mostrando {LIMITE_TELA.toLocaleString("pt-BR")} de {linhas.length.toLocaleString("pt-BR")} linhas; o CSV e a impressão levam todas.
        </p>
      )}
      {clicavel && <p className="muted small">Clique numa linha para abrir a ficha no mapa.</p>}
      {imprimindo &&
        createPortal(
          <div className="print-root print-report">
            <header className="print-root__head">
              <div>
                <h1>{rel.titulo}</h1>
                <div>
                  {rel.sistema} · {escopo}
                </div>
              </div>
              <div className="muted">Emitido em {new Date().toLocaleString("pt-BR")}</div>
            </header>
            {rel.nota && <p>{rel.nota}</p>}
            {tabela(true)}
          </div>,
          document.body,
        )}
    </div>
  );
}
