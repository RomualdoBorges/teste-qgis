import { useState } from "react";
import {
  formatArea,
  formatCount,
  formatLength,
  inventoryToCsv,
  type Inventory,
  type InventoryItem,
} from "../inventory";
import Icon from "./Icon";

export type InventoryScope = "municipio" | "visivel" | "desenho";

const SCOPES: { id: InventoryScope; label: string; title: string }[] = [
  { id: "municipio", label: "Município", title: "Todo o cadastro" },
  { id: "visivel", label: "Área visível", title: "O que está visível no mapa agora" },
  { id: "desenho", label: "Desenhar área", title: "Desenhe um polígono no mapa (duplo clique para terminar)" },
];

interface Props {
  scope: InventoryScope;
  data: Inventory | null;
  loading: boolean;
  error: string | null;
  drawing: boolean;
  /** Camadas WMS existentes na árvore (para oferecer "ligar no mapa") */
  knownLayers: Set<string>;
  onScope: (s: InventoryScope) => void;
  onRefresh: () => void;
  onShowLayer: (layerId: string) => void;
  onClose: () => void;
}

const scopeLabel = (s: InventoryScope, area?: string) =>
  s === "municipio" ? "Município" : `${s === "visivel" ? "Área visível" : "Área desenhada"}${area ? ` (${area})` : ""}`;

export default function InventoryPanel(p: Props) {
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [groupSel, setGroupSel] = useState<Record<number, number>>({});
  const area = formatArea(p.data?.area_m2 ?? null);

  const toggle = (id: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const exportCsv = () => {
    if (!p.data) return;
    const blob = new Blob([inventoryToCsv(p.data, scopeLabel(p.scope, area))], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `inventario-${p.scope}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <aside className="panel side-panel inventory-panel" aria-label="Inventário de ativos">
      <div className="panel__header">
        <span className="panel__title">
          <Icon name="inventory" size={16} /> Inventário
        </span>
        <button type="button" className="icon-btn" title="Fechar" onClick={p.onClose}>
          <Icon name="close" size={16} />
        </button>
      </div>

      <div className="inventory-panel__controls">
        <div className="segmented" role="radiogroup" aria-label="Recorte do inventário">
          {SCOPES.map((s) => (
            <button
              key={s.id}
              type="button"
              role="radio"
              aria-checked={p.scope === s.id}
              className={p.scope === s.id ? "is-on" : ""}
              title={s.title}
              onClick={() => p.onScope(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <div className="inventory-panel__meta">
          <span className="muted">
            {p.drawing
              ? "Clique no mapa para desenhar; duplo clique termina."
              : p.data
                ? `${scopeLabel(p.scope, area)} · ${new Date(p.data.gerado_em).toLocaleTimeString("pt-BR")}`
                : ""}
          </span>
          <span className="inventory-panel__actions">
            {p.scope !== "municipio" && !p.drawing && (
              <button type="button" className="icon-btn" title={p.scope === "visivel" ? "Recalcular para a área visível" : "Desenhar outra área"} onClick={p.onRefresh}>
                <Icon name={p.scope === "visivel" ? "refresh" : "draw"} size={15} />
              </button>
            )}
            <button type="button" className="icon-btn" title="Exportar CSV" disabled={!p.data} onClick={exportCsv}>
              <Icon name="download" size={15} />
            </button>
          </span>
        </div>
      </div>

      <div className="identify-panel__body">
        {p.loading && <p className="muted">Calculando inventário…</p>}
        {p.error && <p className="error-text">{p.error}</p>}
        {!p.loading && !p.error && p.scope === "desenho" && !p.data && !p.drawing && (
          <p className="muted">Clique em “Desenhar área” para delimitar a região.</p>
        )}
        {!p.loading &&
          p.data?.sistemas.map((s) => (
            <section key={s.sistema} className="identify-layer">
              <h3>{s.sistema}</h3>
              {s.itens.map((it) => (
                <Item
                  key={it.id}
                  item={it}
                  open={open.has(it.id)}
                  group={groupSel[it.id] ?? 0}
                  canShow={!!it.camada && p.knownLayers.has(it.camada)}
                  onToggle={() => toggle(it.id)}
                  onGroup={(g) => setGroupSel((prev) => ({ ...prev, [it.id]: g }))}
                  onShowLayer={() => it.camada && p.onShowLayer(it.camada)}
                />
              ))}
            </section>
          ))}
      </div>
    </aside>
  );
}

function Item(p: {
  item: InventoryItem;
  open: boolean;
  group: number;
  canShow: boolean;
  onToggle: () => void;
  onGroup: (g: number) => void;
  onShowLayer: () => void;
}) {
  const it = p.item;
  const total = it.linear ? formatLength(it.extensao_m) : formatCount(it.quantidade);
  const expandable = it.grupos.length > 0;
  const g = it.grupos[Math.min(p.group, it.grupos.length - 1)];
  const base = it.linear ? it.extensao_m || 0 : it.quantidade;
  const empty = it.quantidade === 0;

  return (
    <div className={`inv-item ${p.open ? "is-open" : ""} ${empty ? "is-empty" : ""}`}>
      <div className="identify-feature__head">
        <button
          type="button"
          className="identify-feature__toggle"
          onClick={expandable ? p.onToggle : undefined}
          aria-expanded={expandable ? p.open : undefined}
          disabled={!expandable && !p.canShow}
        >
          <span className={`tree__twisty ${p.open ? "is-open" : ""}`} style={{ visibility: expandable ? "visible" : "hidden" }}>
            <Icon name="chevron" size={14} />
          </span>
          <span className="inv-item__name">{it.ativo}</span>
          <span className="inv-item__total">
            {total}
            {it.linear && <small> · {formatCount(it.quantidade)} trechos</small>}
          </span>
        </button>
        {p.canShow && (
          <button type="button" className="icon-btn" title="Ligar esta camada no mapa" onClick={p.onShowLayer}>
            <Icon name="layers" size={15} />
          </button>
        )}
      </div>

      {p.open && g && (
        <div className="inv-item__detail">
          {it.grupos.length > 1 && (
            <div className="chips" role="tablist">
              {it.grupos.map((gr, i) => (
                <button
                  key={gr.rotulo}
                  type="button"
                  role="tab"
                  aria-selected={gr === g}
                  className={gr === g ? "is-on" : ""}
                  onClick={() => p.onGroup(i)}
                >
                  {gr.rotulo}
                </button>
              ))}
            </div>
          )}
          <table className="attr-table inv-table">
            <thead>
              <tr>
                <th scope="col">{g.rotulo}</th>
                <th scope="col" className="num">{it.linear ? "Extensão" : "Qtd."}</th>
                <th scope="col" className="num">%</th>
              </tr>
            </thead>
            <tbody>
              {g.linhas.map((l) => {
                const v = it.linear ? l.extensao_m || 0 : l.quantidade;
                return (
                  <tr key={l.rotulo}>
                    <th scope="row" title={it.linear ? `${formatCount(l.quantidade)} trechos` : undefined}>
                      {l.rotulo}
                    </th>
                    <td className="num">{it.linear ? formatLength(l.extensao_m) : formatCount(l.quantidade)}</td>
                    <td className="num muted">{base ? `${((v / base) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
