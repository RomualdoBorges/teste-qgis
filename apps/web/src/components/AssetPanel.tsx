import { useEffect, useMemo, useState } from "react";
import type Feature from "ol/Feature";
import {
  getAtivo,
  getClientesDaLigacao,
  setPosicaoValvula,
  type Ativo,
  type ClienteResumo,
  type Ligacao,
} from "../api";
import { fidOf, type AssetHit } from "../map/assetClick";
import { baixar, toCsv } from "../csv";
import ClientSheet, { FieldTable } from "./ClientSheet";
import FilesTab from "./FilesTab";
import Icon from "./Icon";

/** O que o painel está mostrando. */
export type AssetView =
  | { kind: "loading" }
  | { kind: "empty"; message: string }
  | { kind: "hit"; hit: AssetHit }
  | { kind: "area"; clientes: ClienteResumo[]; truncado: boolean }
  /** cliente aberto pela busca ou por um relatório */
  | { kind: "cliente"; clienteId: number; fidLigacao: number | null }
  /** ativo aberto por um relatório (camada sem workspace + fid) */
  | { kind: "ativo"; camada: string; fid: number; feature: Feature | null };

interface Props {
  view: AssetView;
  onSelectFeature: (f: Feature) => void;
  onZoomFeature: (f: Feature) => void;
  /** chamado após alterar um ativo (ex.: posição de válvula), para redesenhar a camada */
  onChanged: (layerId: string) => void;
  onClose: () => void;
}

const TITLES: Record<string, string> = { ligacao: "Inventário", cruzamento: "Cruzamento", ativo: "Informações do Ativo" };

export default function AssetPanel({ view, onSelectFeature, onZoomFeature, onChanged, onClose }: Props) {
  const [chosen, setChosen] = useState<Feature | null>(null);
  useEffect(() => setChosen(view.kind === "hit" && view.hit.features.length === 1 ? view.hit.features[0] : null), [view]);

  const title =
    view.kind === "hit"
      ? chosen && view.hit.kind === "ativo"
        ? `${TITLES.ativo}`
        : TITLES[view.hit.kind]
      : view.kind === "area"
        ? "Ligações na área"
        : view.kind === "ativo"
          ? TITLES.ativo
          : "Inventário";

  return (
    <aside className="panel side-panel asset-panel" aria-label="Inventário do ativo">
      <div className="panel__header">
        <span className="panel__title">
          {view.kind === "hit" && view.hit.features.length > 1 && chosen && (
            <button type="button" className="icon-btn" title="Voltar à lista" onClick={() => setChosen(null)}>
              <Icon name="back" size={16} />
            </button>
          )}
          <Icon name="inventory" size={16} /> {title}
        </span>
        <button type="button" className="icon-btn" title="Fechar" onClick={onClose}>
          <Icon name="close" size={16} />
        </button>
      </div>
      <div className="identify-panel__body asset-panel__body">
        {view.kind === "loading" && <p className="muted">Consultando…</p>}
        {view.kind === "empty" && <p className="muted">{view.message}</p>}
        {view.kind === "area" && <AreaList clientes={view.clientes} truncado={view.truncado} />}
        {view.kind === "cliente" && (
          <div>
            {view.fidLigacao == null && <p className="muted small">Cliente sem ligação localizada no mapa (IPTU sem ponto).</p>}
            <ClientSheet key={view.clienteId} clienteId={view.clienteId} fidLigacao={view.fidLigacao ?? undefined} />
          </div>
        )}
        {view.kind === "ativo" && (
          <div>
            <div className="asset-panel__sub">
              <span className="muted">#{view.fid}</span>
              {view.feature && (
                <button type="button" className="icon-btn" title="Zoom no ativo" onClick={() => onZoomFeature(view.feature!)}>
                  <Icon name="zoomTo" size={15} />
                </button>
              )}
            </div>
            <AtivoView key={`${view.camada}:${view.fid}`} layerId={view.camada} fid={view.fid} onChanged={onChanged} />
          </div>
        )}
        {view.kind === "hit" && !chosen && (
          <FeatureChooser hit={view.hit} onChoose={(f) => (setChosen(f), onSelectFeature(f))} />
        )}
        {view.kind === "hit" && chosen && (
          <HitDetail key={String(chosen.getId())} hit={view.hit} feature={chosen} onZoom={() => onZoomFeature(chosen)} onChanged={onChanged} />
        )}
      </div>
    </aside>
  );
}

/** Vários itens no ponto clicado (ex.: peças de drenagem sobrepostas) — "Itens encontrados" do original. */
function FeatureChooser({ hit, onChoose }: { hit: AssetHit; onChoose: (f: Feature) => void }) {
  return (
    <section className="identify-layer">
      <h3>
        {hit.layerTitle} <span className="tree__badge">{hit.features.length} itens</span>
      </h3>
      {hit.features.map((f) => (
        <button key={String(f.getId())} type="button" className="list-item" onClick={() => onChoose(f)}>
          <span>
            {String(f.get("tipo_desc") ?? f.get("legenda") ?? f.get("nome") ?? "Item")} <span className="muted">#{fidOf(f)}</span>
          </span>
          <Icon name="chevron" size={14} />
        </button>
      ))}
    </section>
  );
}

function HitDetail({ hit, feature, onZoom, onChanged }: { hit: AssetHit; feature: Feature; onZoom: () => void; onChanged: (id: string) => void }) {
  const fid = fidOf(feature);
  return (
    <div>
      <div className="asset-panel__sub">
        <span className="muted">
          {hit.layerTitle} · #{fid}
        </span>
        {feature.getGeometry() && (
          <button type="button" className="icon-btn" title="Zoom no ativo" onClick={onZoom}>
            <Icon name="zoomTo" size={15} />
          </button>
        )}
      </div>
      {hit.kind === "ligacao" && <LigacaoView fid={fid} />}
      {hit.kind === "cruzamento" && <CruzamentoView fid={fid} feature={feature} />}
      {hit.kind === "ativo" && <AtivoView layerId={hit.layerId} fid={fid} onChanged={onChanged} />}
    </div>
  );
}

// ---------------------------------------------------------------- ligação
function LigacaoView({ fid }: { fid: number }) {
  const [data, setData] = useState<{ ligacao: Ligacao; clientes: ClienteResumo[] } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [sel, setSel] = useState<number | null>(null);

  useEffect(() => {
    setData(null);
    setSel(null);
    getClientesDaLigacao(fid)
      .then((d) => {
        setData(d);
        if (d.clientes.length === 1) setSel(d.clientes[0].id);
      })
      .catch((e) => setErro(e.message));
  }, [fid]);

  if (erro) return <p className="error-text">{erro}</p>;
  if (!data) return <p className="muted">Carregando clientes…</p>;
  const l = data.ligacao;
  const iptu = (
    <p className="muted small">
      IPTU {l.inscricao_iptu ?? "—"} · Setor {l.zona ?? "—"} · Quadra {l.quadra ?? "—"} · Lote {l.lote ?? "—"}
    </p>
  );

  if (sel !== null)
    return (
      <div>
        {data.clientes.length > 1 && (
          <button type="button" className="link-btn" onClick={() => setSel(null)}>
            <Icon name="back" size={14} /> {data.clientes.length} clientes neste lote
          </button>
        )}
        <ClientSheet clienteId={sel} fidLigacao={fid} />
      </div>
    );

  if (!data.clientes.length)
    return (
      <div>
        {iptu}
        <p className="muted">Nenhum cliente cadastrado para esta inscrição.</p>
        <h4 className="chart__title">Arquivos da ligação</h4>
        <FilesTab vinculo={{ ligacao: fid }} />
      </div>
    );

  return (
    <div>
      {iptu}
      <ClientTable clientes={data.clientes} onSelect={setSel} />
    </div>
  );
}

function ClientTable({ clientes, onSelect, showIptu }: { clientes: ClienteResumo[]; onSelect: (id: number) => void; showIptu?: boolean }) {
  return (
    <table className="attr-table pick-table">
      <thead>
        <tr>
          <th scope="col">Cód. Cliente</th>
          <th scope="col">{showIptu ? "Endereço" : "Categoria de Uso"}</th>
          <th scope="col" className="num">
            Data Ligação
          </th>
        </tr>
      </thead>
      <tbody>
        {clientes.map((c) => (
          <tr key={c.id} onClick={() => onSelect(c.id)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && onSelect(c.id)}>
            <th scope="row">{c.codigo_cliente}</th>
            <td>
              {showIptu
                ? [c.endereco_rua, c.endereco_numero, c.endereco_complemento].filter(Boolean).join(", ")
                : c.categoria_de_uso ?? "—"}
            </td>
            <td className="num">{c.data_ligacao ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Seleção por área (DrawingControls do original): todos os clientes das ligações na área. */
function AreaList({ clientes, truncado }: { clientes: ClienteResumo[]; truncado: boolean }) {
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<ClienteResumo | null>(null);
  const filtrados = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t
      ? clientes.filter((c) =>
          [c.codigo_cliente, c.endereco_rua, c.endereco_numero, c.categoria_de_uso, c.inscricao_iptu].some((v) => v?.toLowerCase().includes(t)),
        )
      : clientes;
  }, [clientes, q]);

  if (sel)
    return (
      <div>
        <button type="button" className="link-btn" onClick={() => setSel(null)}>
          <Icon name="back" size={14} /> {clientes.length} clientes na área
        </button>
        <ClientSheet clienteId={sel.id} fidLigacao={sel.fid} />
      </div>
    );

  const ligacoes = new Set(clientes.map((c) => c.fid)).size;
  const exportar = () =>
    baixar(
      "ligacoes-na-area.csv",
      toCsv(
        ["Cód. Cliente", "Nome", "Rua", "Número", "Complemento", "Categoria de uso", "Data ligação", "IPTU", "Ligação (fid)"],
        filtrados.map((c) => [
          c.codigo_cliente,
          c.nome,
          c.endereco_rua,
          c.endereco_numero,
          c.endereco_complemento,
          c.categoria_de_uso,
          c.data_ligacao,
          c.inscricao_iptu,
          c.fid,
        ]),
        [`Ligações na área: ${clientes.length} clientes em ${ligacoes} ligações${truncado ? " (limitado a 5.000)" : ""}`,
         `Emitido em ${new Date().toLocaleString("pt-BR")}`],
      ),
    );
  return (
    <div>
      <div className="asset-panel__sub">
        <span className="muted small">
          {clientes.length.toLocaleString("pt-BR")} clientes em {ligacoes.toLocaleString("pt-BR")} ligações
          {truncado && " (lista limitada aos primeiros 5.000)"}
        </span>
        <button type="button" className="btn" onClick={exportar} title={q ? "Exporta os clientes filtrados" : "Exporta todos os clientes da área"}>
          <Icon name="download" size={14} /> CSV
        </button>
      </div>
      <input className="search-input" type="search" placeholder="Filtrar por código, endereço, categoria…" value={q} onChange={(e) => setQ(e.target.value)} />
      <ClientTable clientes={filtrados.slice(0, 500)} onSelect={(id) => setSel(clientes.find((c) => c.id === id)!)} showIptu />
      {filtrados.length > 500 && <p className="muted small">Mostrando 500 de {filtrados.length.toLocaleString("pt-BR")}. Refine o filtro.</p>}
    </div>
  );
}

// ---------------------------------------------------------------- cruzamento
function CruzamentoView({ fid, feature }: { fid: number; feature: Feature }) {
  return (
    <div>
      <FieldTable
        campos={[
          { rotulo: "N° Cruzamento", valor: feature.get("no") ?? null },
          { rotulo: "Setor", valor: feature.get("setor") ?? null },
        ]}
      />
      <h4 className="chart__title">Documentos</h4>
      <FilesTab vinculo={{ cruzamento: fid }} />
    </div>
  );
}

// ---------------------------------------------------------------- demais ativos
function AtivoView({ layerId, fid, onChanged }: { layerId: string; fid: number; onChanged: (id: string) => void }) {
  const [a, setA] = useState<Ativo | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [todos, setTodos] = useState(false);

  const carregar = () =>
    getAtivo(layerId.split(":").pop()!, fid)
      .then(setA)
      .catch((e) => setErro(e.message));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void carregar(), [layerId, fid]);

  if (erro) return <p className="error-text">{erro}</p>;
  if (!a) return <p className="muted">Carregando…</p>;
  const campos = todos ? a.campos : a.campos.filter((c) => c.valor !== null);
  const vazios = a.campos.length - a.campos.filter((c) => c.valor !== null).length;

  return (
    <div>
      <h3 className="asset-panel__title">{a.titulo}</h3>
      {a.edicao && <ValvulaEdit fid={a.fid} edicao={a.edicao} onSaved={() => (carregar(), onChanged(layerId))} />}
      <FieldTable campos={campos} />
      {vazios > 0 && (
        <button type="button" className="link-btn" onClick={() => setTodos((v) => !v)}>
          {todos ? "Ocultar campos vazios" : `Mostrar ${vazios} campos vazios`}
        </button>
      )}
    </div>
  );
}

function ValvulaEdit({ fid, edicao, onSaved }: { fid: number; edicao: NonNullable<Ativo["edicao"]>; onSaved: () => void }) {
  const [valor, setValor] = useState<number | "">(edicao.valor ?? "");
  const [estado, setEstado] = useState<{ tipo: "ok" | "erro" | "salvando"; msg?: string } | null>(null);
  const mudou = valor !== "" && valor !== edicao.valor;

  const salvar = async () => {
    if (valor === "") return;
    setEstado({ tipo: "salvando" });
    try {
      await setPosicaoValvula(fid, valor);
      setEstado({ tipo: "ok", msg: "Posição atualizada." });
      onSaved();
    } catch (e) {
      setEstado({ tipo: "erro", msg: (e as Error).message });
    }
  };

  return (
    <div className="valve-edit">
      <label>
        Posição da válvula
        <select value={valor} onChange={(e) => (setValor(e.target.value === "" ? "" : Number(e.target.value)), setEstado(null))}>
          <option value="">Não informado</option>
          {edicao.opcoes.map((o) => (
            <option key={o.id} value={o.id}>
              {o.descricao}
            </option>
          ))}
        </select>
      </label>
      <button type="button" className="btn btn--primary" disabled={!mudou || estado?.tipo === "salvando"} onClick={salvar}>
        {estado?.tipo === "salvando" ? "Salvando…" : "Salvar"}
      </button>
      {estado?.msg && <p className={estado.tipo === "erro" ? "error-text" : "ok-text"}>{estado.msg}</p>}
    </div>
  );
}
