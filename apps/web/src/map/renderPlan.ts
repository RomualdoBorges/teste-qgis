import type { TreeState } from "../store";
import { flatLayers } from "../store";
import type { Extent4326, LayerNode } from "../types";
import { isUsableExtent } from "../geoserver";

/**
 * Uma fonte de imagem no mapa. Várias camadas WMS consecutivas do mesmo grupo
 * são desenhadas numa única requisição (LAYERS=a,b,c), reduzindo muito o número
 * de tiles pedidos. Camadas em cache (WMTS) ou com opacidade < 100% ficam sozinhas.
 */
export interface RenderEntry {
  key: string;
  kind: "wms" | "wmts";
  /** Em ordem de desenho: a primeira fica por cima */
  layers: string[];
  opacity: number;
  /** Para WMTS: limita os tiles à extensão da camada (o GeoWebCache recusa tiles fora dela) */
  extent?: Extent4326;
}

export function isInScale(layer: LayerNode, zoom: number) {
  return layer.minZoom === undefined || zoom >= layer.minZoom;
}

export function buildRenderPlan(tree: TreeState, zoom: number): RenderEntry[] {
  const plan: RenderEntry[] = [];
  let batch: (RenderEntry & { group: string }) | null = null;

  for (const { layer, group, active } of flatLayers(tree)) {
    if (!active || !isInScale(layer, zoom)) continue;

    if (layer.cached) {
      plan.push({
        key: `wmts:${layer.id}`,
        kind: "wmts",
        layers: [layer.id],
        opacity: layer.opacity,
        extent: isUsableExtent(layer.extent) ? layer.extent : undefined,
      });
      batch = null; // mantém a ordem de desenho
      continue;
    }
    if (layer.opacity < 1) {
      plan.push({ key: `wms:${layer.id}`, kind: "wms", layers: [layer.id], opacity: layer.opacity });
      batch = null;
      continue;
    }
    if (batch && batch.group === group.id) {
      batch.layers.push(layer.id);
    } else {
      batch = { key: "", kind: "wms", layers: [layer.id], opacity: 1, group: group.id };
      plan.push(batch);
    }
  }
  return plan.map((e) => ({ ...e, key: e.key || `wms:${e.layers.join(",")}` }));
}
