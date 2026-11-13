import { useEffect, useMemo, useRef, useState, type Dispatch, type DragEvent, type MouseEvent } from "react";
import { fetchLegendRules, isUsableExtent, legendIconUrl, ruleIconUrl, type LegendRule } from "../geoserver";
import type { Action, TreeState } from "../store";
import type { Extent4326, GroupNode, LayerNode, LoadStatus } from "../types";
import Icon from "./Icon";
import { isInScale } from "../map/renderPlan";

interface Props {
  tree: TreeState;
  dispatch: Dispatch<Action>;
  status: Record<string, LoadStatus>;
  zoom: number;
  onZoomTo: (extents: Extent4326[]) => void;
}

type MenuTarget = { kind: "layer"; group: GroupNode; layer: LayerNode } | { kind: "group"; group: GroupNode };
type Menu = MenuTarget & { x: number; y: number };

type Drag = { kind: "layer"; groupId: string; index: number } | { kind: "group"; index: number };

export default function LayerTree({ tree, dispatch, status, zoom, onZoomTo }: Props) {
  const [query, setQuery] = useState("");
  const [onlyActive, setOnlyActive] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  // legenda por regra do estilo (como no QGIS): camada → regras do SLD
  const [rules, setRules] = useState<Record<string, LegendRule[]>>({});
  const [legendOpen, setLegendOpen] = useState<Set<string>>(new Set());

  const layerIds = useMemo(() => tree.groups.flatMap((g) => g.layers.map((l) => l.id)).join(","), [tree]);
  useEffect(() => {
    let alive = true;
    for (const id of layerIds.split(",").filter(Boolean)) {
      if (rules[id]) continue;
      fetchLegendRules(id)
        .then((r) => alive && setRules((prev) => ({ ...prev, [id]: r })))
        .catch(() => alive && setRules((prev) => ({ ...prev, [id]: [] })));
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layerIds]);

  const toggleLegend = (id: string) =>
    setLegendOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const q = query.trim().toLowerCase();
  const filtering = q !== "" || onlyActive;

  const view = useMemo(
    () =>
      tree.groups
        .map((g, gi) => ({
          group: g,
          gi,
          layers: g.layers
            .map((l, li) => ({ layer: l, li }))
            .filter(
              ({ layer }) =>
                (!q || layer.label.toLowerCase().includes(q) || layer.title.toLowerCase().includes(q)) && (!onlyActive || (layer.visible && g.visible)),
            ),
        }))
        .filter((v) => !filtering || v.layers.length > 0),
    [tree, q, onlyActive, filtering],
  );

  const activeCount = tree.groups.reduce(
    (n, g) => n + (g.visible ? g.layers.filter((l) => l.visible).length : 0),
    0,
  );
  const totalCount = tree.groups.reduce((n, g) => n + g.layers.length, 0);

  // fecha o menu de contexto ao clicar fora / Esc
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("click", close);
    window.addEventListener("keydown", esc);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("keydown", esc);
    };
  }, [menu]);

  // ---- arrastar e soltar ----
  const startDrag = (e: DragEvent, d: Drag) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", JSON.stringify(d));
    setDrag(d);
  };
  const endDrag = () => {
    setDrag(null);
    setDropTarget(null);
  };
  const overLayer = (e: DragEvent, groupId: string, key: string) => {
    if (drag?.kind === "layer" && drag.groupId === groupId) {
      e.preventDefault();
      setDropTarget(key);
    }
  };
  const dropLayer = (groupId: string, to: number) => {
    if (drag?.kind === "layer" && drag.groupId === groupId && drag.index !== to)
      dispatch({ type: "moveLayer", groupId, from: drag.index, to });
    endDrag();
  };
  const overGroup = (e: DragEvent, key: string) => {
    if (drag?.kind === "group") {
      e.preventDefault();
      setDropTarget(key);
    }
  };
  const dropGroup = (to: number) => {
    if (drag?.kind === "group" && drag.index !== to) dispatch({ type: "moveGroup", from: drag.index, to });
    endDrag();
  };

  const openMenu = (e: MouseEvent, m: MenuTarget) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ ...m, x: e.clientX, y: e.clientY });
  };

  const groupExtents = (g: GroupNode) => g.layers.map((l) => l.extent).filter(isUsableExtent);

  return (
    <aside className="panel layer-panel" aria-label="Painel de camadas">
      <div className="panel__header">
        <span className="panel__title">
          <Icon name="layers" size={16} /> Camadas
        </span>
        <span className="panel__count" title="Camadas ativas / total">
          {activeCount}/{totalCount}
        </span>
      </div>

      <div className="layer-panel__actions">
        <button type="button" title="Expandir todos" onClick={() => dispatch({ type: "setAllExpanded", expanded: true })}>
          <Icon name="expand" size={16} />
        </button>
        <button type="button" title="Recolher todos" onClick={() => dispatch({ type: "setAllExpanded", expanded: false })}>
          <Icon name="collapse" size={16} />
        </button>
        <button type="button" title="Desmarcar todas as camadas" onClick={() => dispatch({ type: "uncheckAll" })}>
          <Icon name="uncheck" size={16} />
        </button>
        <button
          type="button"
          title="Mostrar apenas camadas ativas"
          className={onlyActive ? "is-on" : ""}
          aria-pressed={onlyActive}
          onClick={() => setOnlyActive((v) => !v)}
        >
          <Icon name="filter" size={16} />
        </button>
        <input
          className="layer-panel__search"
          type="search"
          placeholder="Filtrar camadas…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      <ul className="tree" role="tree">
        {view.map(({ group: g, gi, layers }) => {
          const expanded = filtering || g.expanded;
          const checkedCount = g.layers.filter((l) => l.visible).length;
          const gKey = `g:${g.id}`;
          return (
            <li key={g.id} role="treeitem" aria-expanded={expanded}>
              <div
                className={`tree__row tree__row--group ${dropTarget === gKey ? "is-drop" : ""} ${selected === gKey ? "is-selected" : ""}`}
                draggable={!filtering}
                onDragStart={(e) => startDrag(e, { kind: "group", index: gi })}
                onDragEnd={endDrag}
                onDragOver={(e) => overGroup(e, gKey)}
                onDrop={() => dropGroup(gi)}
                onClick={() => setSelected(gKey)}
                onDoubleClick={() => dispatch({ type: "setExpanded", id: g.id, expanded: !g.expanded })}
                onContextMenu={(e) => openMenu(e, { kind: "group", group: g })}
              >
                <button
                  type="button"
                  className={`tree__twisty ${expanded ? "is-open" : ""}`}
                  aria-label={expanded ? "Recolher" : "Expandir"}
                  onClick={(e) => {
                    e.stopPropagation();
                    dispatch({ type: "setExpanded", id: g.id, expanded: !g.expanded });
                  }}
                >
                  <Icon name="chevron" size={14} />
                </button>
                <Checkbox
                  checked={g.visible}
                  indeterminate={g.visible && checkedCount > 0 && checkedCount < g.layers.length}
                  onChange={() => dispatch({ type: "toggleGroup", id: g.id })}
                  label={`Grupo ${g.title}`}
                />
                <span className="tree__folder">
                  <Icon name="folder" size={16} />
                </span>
                <span className="tree__label">{g.title}</span>
                <span className="tree__badge">{checkedCount ? `${checkedCount}/${g.layers.length}` : g.layers.length}</span>
              </div>

              {expanded && (
                <ul role="group" className={g.visible ? "" : "is-disabled"}>
                  {layers.map(({ layer: l, li }) => {
                    const lKey = `l:${l.id}`;
                    const st = status[l.id];
                    const outOfScale = !isInScale(l, zoom);
                    const tip = [
                      `${l.title} (${l.id})`,
                      l.cached ? "servida pelo cache (WMTS)" : "renderizada na hora (WMS)",
                      l.minZoom !== undefined ? `visível a partir do zoom ${l.minZoom}` : "",
                    ].filter(Boolean).join(" · ");
                    const lr = rules[l.id] ?? [];
                    const multi = lr.length > 1;
                    const open = multi && legendOpen.has(l.id);
                    const single = lr.length === 1 && lr[0].name ? ruleIconUrl(l.id, lr[0].name) : legendIconUrl(l.id);
                    return (
                      <li key={l.id} role="treeitem" aria-expanded={multi ? open : undefined}>
                        <div
                          className={`tree__row tree__row--layer ${dropTarget === lKey ? "is-drop" : ""} ${selected === lKey ? "is-selected" : ""} ${outOfScale ? "is-out-of-scale" : ""}`}
                          title={tip}
                          draggable={!filtering}
                          onDragStart={(e) => startDrag(e, { kind: "layer", groupId: g.id, index: li })}
                          onDragEnd={endDrag}
                          onDragOver={(e) => overLayer(e, g.id, lKey)}
                          onDrop={() => dropLayer(g.id, li)}
                          onClick={() => setSelected(lKey)}
                          onDoubleClick={() => isUsableExtent(l.extent) && onZoomTo([l.extent])}
                          onContextMenu={(e) => {
                            setSelected(lKey);
                            openMenu(e, { kind: "layer", group: g, layer: l });
                          }}
                        >
                          {multi ? (
                            <button
                              type="button"
                              className={`tree__twisty ${open ? "is-open" : ""}`}
                              aria-label={open ? "Recolher legenda" : "Expandir legenda"}
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleLegend(l.id);
                              }}
                            >
                              <Icon name="chevron" size={14} />
                            </button>
                          ) : (
                            <span className="tree__twisty-spacer" />
                          )}
                          <Checkbox
                            checked={l.visible}
                            onChange={() => dispatch({ type: "toggleLayer", id: l.id })}
                            label={`Camada ${l.label}`}
                          />
                          {!multi && <img className="tree__legend" src={single} alt="" loading="lazy" width={16} height={16} />}
                          <span className="tree__label">{l.label}</span>
                          {l.opacity < 1 && <span className="tree__badge">{Math.round(l.opacity * 100)}%</span>}
                          {l.cached && <span className="tree__badge" title="Servida pelo cache (WMTS)">cache</span>}
                          {st === "loading" && <span className="tree__spinner" aria-label="Carregando" />}
                          {st === "error" && (
                            <span className="tree__error" title="Erro ao carregar">
                              <Icon name="warning" size={14} />
                            </span>
                          )}
                        </div>
                        {open && (
                          <ul role="group" className={`tree__rules ${outOfScale ? "is-out-of-scale" : ""}`}>
                            {lr.map((r, ri) => (
                              <li key={`${r.name ?? ""}-${ri}`} className="tree__row tree__row--rule" title={r.name}>
                                {r.name ? (
                                  <img className="tree__legend" src={ruleIconUrl(l.id, r.name)} alt="" loading="lazy" width={16} height={16} />
                                ) : (
                                  <span className="tree__legend" />
                                )}
                                <span className="tree__label">{r.title || "(sem título)"}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
        {view.length === 0 && <li className="tree__empty">Nenhuma camada encontrada.</li>}
      </ul>

      {menu && (
        <div
          className="ctx-menu"
          style={{ left: menu.x, top: menu.y }}
          role="menu"
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          {menu.kind === "layer" ? (
            <LayerMenu
              layer={menu.layer}
              group={menu.group}
              dispatch={dispatch}
              onZoomTo={onZoomTo}
              close={() => setMenu(null)}
            />
          ) : (
            <>
              <div className="ctx-menu__title">{menu.group.title}</div>
              <MenuItem
                label="Zoom para o grupo"
                disabled={!groupExtents(menu.group).length}
                onClick={() => {
                  onZoomTo(groupExtents(menu.group));
                  setMenu(null);
                }}
              />
              <MenuItem
                label="Ativar todas as camadas"
                onClick={() => {
                  dispatch({ type: "setGroupLayers", id: menu.group.id, visible: true });
                  setMenu(null);
                }}
              />
              <MenuItem
                label="Desativar todas as camadas"
                onClick={() => {
                  dispatch({ type: "setGroupLayers", id: menu.group.id, visible: false });
                  setMenu(null);
                }}
              />
              <hr />
              <MenuItem
                label={menu.group.expanded ? "Recolher" : "Expandir"}
                onClick={() => {
                  dispatch({ type: "setExpanded", id: menu.group.id, expanded: !menu.group.expanded });
                  setMenu(null);
                }}
              />
            </>
          )}
        </div>
      )}
    </aside>
  );
}

function LayerMenu({
  layer,
  group,
  dispatch,
  onZoomTo,
  close,
}: {
  layer: LayerNode;
  group: GroupNode;
  dispatch: Dispatch<Action>;
  onZoomTo: (e: Extent4326[]) => void;
  close: () => void;
}) {
  const index = group.layers.findIndex((l) => l.id === layer.id);
  const [opacity, setOpacity] = useState(layer.opacity);
  return (
    <>
      <div className="ctx-menu__title" title={layer.id}>{layer.label}</div>
      <MenuItem
        label="Zoom para a camada"
        disabled={!isUsableExtent(layer.extent)}
        onClick={() => {
          onZoomTo([layer.extent!]);
          close();
        }}
      />
      <MenuItem
        label="Mostrar só esta camada"
        onClick={() => {
          dispatch({ type: "showOnly", id: layer.id });
          close();
        }}
      />
      <hr />
      <label className="ctx-menu__slider">
        Opacidade <b>{Math.round(opacity * 100)}%</b>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={opacity}
          onChange={(e) => {
            const v = Number(e.target.value);
            setOpacity(v);
            dispatch({ type: "setOpacity", id: layer.id, opacity: v });
          }}
        />
      </label>
      <hr />
      <MenuItem
        label="Mover para o topo"
        disabled={index === 0}
        onClick={() => {
          dispatch({ type: "moveLayer", groupId: group.id, from: index, to: 0 });
          close();
        }}
      />
      <MenuItem
        label="Mover para o fim"
        disabled={index === group.layers.length - 1}
        onClick={() => {
          dispatch({ type: "moveLayer", groupId: group.id, from: index, to: group.layers.length - 1 });
          close();
        }}
      />
      <hr />
      <MenuItem
        label="Copiar nome da camada"
        onClick={() => {
          void navigator.clipboard?.writeText(layer.id);
          close();
        }}
      />
    </>
  );
}

function MenuItem({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" role="menuitem" className="ctx-menu__item" disabled={disabled} onClick={onClick}>
      {label}
    </button>
  );
}

function Checkbox({
  checked,
  indeterminate = false,
  onChange,
  label,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  label: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className="tree__check"
      checked={checked}
      aria-label={label}
      onChange={onChange}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
    />
  );
}
