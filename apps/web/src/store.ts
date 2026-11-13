import { isEmptyExtent, type CapabilityLayer } from "./geoserver";
import type { GroupNode, LayerNode } from "./types";
import { CACHED_LAYERS, GROUP_NAMES, LAYER_NAMES, MIN_ZOOM, START_ACTIVE, VISIBLE_LAYERS } from "./config/layers";

export interface TreeState {
  groups: GroupNode[];
}

export type Action =
  | { type: "init"; groups: GroupNode[] }
  | { type: "toggleLayer"; id: string }
  | { type: "toggleGroup"; id: string }
  | { type: "setGroupLayers"; id: string; visible: boolean }
  | { type: "showOnly"; id: string }
  | { type: "showLayer"; id: string }
  | { type: "uncheckAll" }
  | { type: "setExpanded"; id: string; expanded: boolean }
  | { type: "setAllExpanded"; expanded: boolean }
  | { type: "setOpacity"; id: string; opacity: number }
  | { type: "moveLayer"; groupId: string; from: number; to: number }
  | { type: "moveGroup"; from: number; to: number };

const STORAGE_KEY = "geomonitora.layerTree.v3";

function move<T>(list: T[], from: number, to: number): T[] {
  const next = list.slice();
  const [item] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(to, next.length)), 0, item);
  return next;
}

const mapLayers = (s: TreeState, fn: (l: LayerNode, g: GroupNode) => LayerNode): TreeState => ({
  groups: s.groups.map((g) => ({ ...g, layers: g.layers.map((l) => fn(l, g)) })),
});

const mapGroup = (s: TreeState, id: string, fn: (g: GroupNode) => GroupNode): TreeState => ({
  groups: s.groups.map((g) => (g.id === id ? fn(g) : g)),
});

export function reducer(state: TreeState, a: Action): TreeState {
  switch (a.type) {
    case "init":
      return { groups: a.groups };
    case "toggleLayer":
      return mapLayers(state, (l) => (l.id === a.id ? { ...l, visible: !l.visible } : l));
    case "toggleGroup":
      return mapGroup(state, a.id, (g) => {
        const visible = !g.visible;
        // Conveniência: ligar um grupo sem nenhuma camada marcada liga todas
        const noneChecked = g.layers.every((l) => !l.visible);
        return {
          ...g,
          visible,
          layers: visible && noneChecked ? g.layers.map((l) => ({ ...l, visible: true })) : g.layers,
        };
      });
    case "setGroupLayers":
      return mapGroup(state, a.id, (g) => ({
        ...g,
        visible: a.visible || g.visible,
        layers: g.layers.map((l) => ({ ...l, visible: a.visible })),
      }));
    case "showOnly":
      return {
        groups: state.groups.map((g) => {
          const has = g.layers.some((l) => l.id === a.id);
          return {
            ...g,
            visible: has ? true : g.visible,
            layers: g.layers.map((l) => ({ ...l, visible: l.id === a.id })),
          };
        }),
      };
    case "showLayer":
      return {
        groups: state.groups.map((g) =>
          g.layers.some((l) => l.id === a.id)
            ? { ...g, visible: true, expanded: true, layers: g.layers.map((l) => (l.id === a.id ? { ...l, visible: true } : l)) }
            : g,
        ),
      };
    case "uncheckAll":
      return mapLayers(state, (l) => ({ ...l, visible: false }));
    case "setExpanded":
      return mapGroup(state, a.id, (g) => ({ ...g, expanded: a.expanded }));
    case "setAllExpanded":
      return { groups: state.groups.map((g) => ({ ...g, expanded: a.expanded })) };
    case "setOpacity":
      return mapLayers(state, (l) => (l.id === a.id ? { ...l, opacity: a.opacity } : l));
    case "moveLayer":
      return mapGroup(state, a.groupId, (g) => ({ ...g, layers: move(g.layers, a.from, a.to) }));
    case "moveGroup":
      return { groups: move(state.groups, a.from, a.to) };
  }
}

/** Camadas em ordem de desenho: a primeira da lista fica por cima (como no QGIS). */
export function flatLayers(state: TreeState) {
  return state.groups.flatMap((g) =>
    g.layers.map((l) => ({ layer: l, group: g, active: g.visible && l.visible })),
  );
}

// ---------- persistência (por navegador) ----------

interface Saved {
  groups: { id: string; visible: boolean; expanded: boolean; layers: { id: string; visible: boolean; opacity: number }[] }[];
}

export function saveTree(state: TreeState) {
  const data: Saved = {
    groups: state.groups.map((g) => ({
      id: g.id,
      visible: g.visible,
      expanded: g.expanded,
      layers: g.layers.map((l) => ({ id: l.id, visible: l.visible, opacity: l.opacity })),
    })),
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    /* armazenamento indisponível: ignora */
  }
}

function loadSaved(): Saved | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}

/** Chaves pelas quais uma camada pode ser referenciada em config/layers.ts. */
function layerKeys(c: CapabilityLayer) {
  const name = c.name.toLowerCase();
  return [name, name.split(":").pop()!, c.title.toLowerCase()];
}
const norm = (s: string) => s.trim().toLowerCase();

/** Filtra pelas camadas configuradas em config/layers.ts (lista vazia = todas). */
function applyAllowList(caps: CapabilityLayer[]): CapabilityLayer[] {
  const wanted = VISIBLE_LAYERS.map(norm).filter(Boolean);
  if (!wanted.length) return caps;
  const found = new Set<string>();
  const result = caps.filter((c) => {
    const hit = layerKeys(c).find((k) => wanted.includes(k));
    if (hit) found.add(hit);
    return !!hit;
  });
  const missing = wanted.filter((w) => !found.has(w));
  if (missing.length) console.warn("[config/layers.ts] Camadas não encontradas no GeoServer:", missing);
  return result;
}

const minZoomByKey = new Map(Object.entries(MIN_ZOOM).map(([k, v]) => [norm(k), v]));
const cachedKeys = new Set(CACHED_LAYERS.map(norm));
const startActiveKeys = new Set(START_ACTIVE.map(norm).filter(Boolean));
const nameByKey = new Map(Object.entries(LAYER_NAMES).map(([k, v]) => [norm(k), v.trim()]));

/** Monta a árvore a partir do GetCapabilities, reaplicando ordem/estado salvos. */
export function buildGroups(allCaps: CapabilityLayer[]): GroupNode[] {
  const caps = applyAllowList(allCaps);
  // camadas escolhidas em config/layers.ts já começam ligadas no mapa
  const startVisible = VISIBLE_LAYERS.some((s) => s.trim());
  const bySchema = new Map<string, LayerNode[]>();
  for (const c of caps) {
    if (isEmptyExtent(c.extent)) continue; // camadas sem feições não aparecem
    const [schema, ...rest] = c.title.includes(".") ? c.title.split(".") : ["outros", c.title || c.name];
    const node: LayerNode = {
      id: c.name,
      title: c.title,
      label: layerKeys(c).map((k) => nameByKey.get(k)).find(Boolean) ?? rest.join("."),
      visible: startActiveKeys.size ? layerKeys(c).some((k) => startActiveKeys.has(k)) : startVisible,
      opacity: 1,
      extent: c.extent,
      empty: isEmptyExtent(c.extent),
      minZoom: layerKeys(c).map((k) => minZoomByKey.get(k)).find((v) => v !== undefined),
      cached: layerKeys(c).some((k) => cachedKeys.has(k)),
    };
    if (!bySchema.has(schema)) bySchema.set(schema, []);
    bySchema.get(schema)!.push(node);
  }

  let groups: GroupNode[] = [...bySchema.entries()]
    .sort(([a], [b]) => (GROUP_NAMES[a] ?? a).localeCompare(GROUP_NAMES[b] ?? b, "pt-BR"))
    .map(([schema, layers]) => ({
      id: schema,
      title: GROUP_NAMES[schema] ?? schema,
      visible: true,
      expanded: false,
      layers: layers.sort((a, b) => a.label.localeCompare(b.label, "pt-BR")),
    }));

  const saved = loadSaved();
  if (!saved) return groups;

  const rank = <T extends { id: string }>(list: T[], order: { id: string }[]) => {
    const pos = new Map(order.map((o, i) => [o.id, i]));
    return list.slice().sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9));
  };
  groups = rank(groups, saved.groups).map((g) => {
    const sg = saved.groups.find((s) => s.id === g.id);
    if (!sg) return g;
    const layers = rank(g.layers, sg.layers).map((l) => {
      const sl = sg.layers.find((s) => s.id === l.id);
      return sl ? { ...l, visible: sl.visible, opacity: sl.opacity } : l;
    });
    return { ...g, visible: sg.visible, expanded: sg.expanded, layers };
  });
  return groups;
}
