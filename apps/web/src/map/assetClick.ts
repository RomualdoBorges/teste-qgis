import type OlMap from "ol/Map";
import type Feature from "ol/Feature";
import type { Coordinate } from "ol/coordinate";
import { identifyAt } from "./identify";

/**
 * Tipo de ficha de inventário por camada (mesmo roteamento do CustomLayerWms do original:
 * ligações → cliente; cruzamentos → documentos; demais → atributos do ativo).
 * Chave = nome WMS sem o workspace.
 */
export type AssetKind = "ligacao" | "cruzamento" | "ativo";

export const ASSET_LAYERS: Record<string, AssetKind> = {
  agua_geoserver_ligacoes_quant_client: "ligacao",
  cartografia_geoserver_cruzamentos: "cruzamento",
  agua_saa_conexoes: "ativo",
  agua_saa_valvula: "ativo",
  agua_vw_geoserver_front_rede_agua: "ativo",
  esgoto_ses_geoserver_rede: "ativo",
  esgoto_ses_geoserver_poco: "ativo",
  esgoto_ses_geoserver_caixa_passagem: "ativo",
  esgoto_ses_geoserver_caixa_ligacao: "ativo",
  drenagem_sdu_geoserver_rede: "ativo",
  drenagem_sdu_rede_drenagem_fluxo: "ativo",
  drenagem_sdu_geoserver_boca_lobo: "ativo",
  drenagem_sdu_geoserver_boca_leao: "ativo",
  drenagem_sdu_geoserver_caixa: "ativo",
  drenagem_sdu_geoserver_caixa_acoplada_pv: "ativo",
  drenagem_sdu_geoserver_poco_visita: "ativo",
  drenagem_sdu_geoserver_sarjetao: "ativo",
  drenagem_sdu_geoserver_valvula_flap: "ativo",
  drenagem_sdu_lancamento_fluxo: "ativo",
};

export const assetKindOf = (layerId: string): AssetKind | undefined => ASSET_LAYERS[layerId.split(":").pop()!];

export interface AssetHit {
  layerId: string;
  layerTitle: string;
  kind: AssetKind;
  features: Feature[];
}

/** fid do ativo: atributo "fid" (views sem chave primária recebem ids gerados pelo GeoServer). */
export const fidOf = (f: Feature) => {
  const attr = Number(f.get("fid"));
  return Number.isFinite(attr) && f.get("fid") !== null && f.get("fid") !== undefined
    ? attr
    : Number(String(f.getId() ?? "").split(".").pop());
};

/**
 * Consulta as camadas com ficha (ativas e na escala) no ponto clicado e escolhe uma:
 * pontos antes de linhas, linhas antes de polígonos; no mesmo tipo, a camada de cima.
 * (O original preferia a camada de baixo, o que fazia a rede "roubar" o clique de poços e bocas de lobo.)
 * `layers` vem em ordem de desenho (primeira = topo).
 */
export async function assetAt(map: OlMap, coordinate: Coordinate, layers: { id: string; title: string }[]): Promise<AssetHit | null> {
  const clickable = layers.filter((l) => assetKindOf(l.id));
  if (!clickable.length) return null;
  const hits = (await identifyAt(map, coordinate, clickable)).filter((h) => h.features.length);
  if (!hits.length) return null;
  const order = new Map(clickable.map((l, i) => [l.id, i]));
  const rank = (h: (typeof hits)[number]) => Math.min(...h.features.map(geomRank)) * 1000 + (order.get(h.layerId) ?? 999);
  const best = hits.slice().sort((a, b) => rank(a) - rank(b))[0];
  const feats = best.features.slice().sort((a, b) => geomRank(a) - geomRank(b));
  return { layerId: best.layerId, layerTitle: best.layerTitle, kind: assetKindOf(best.layerId)!, features: feats };
}

const geomRank = (f: Feature) => {
  const t = f.getGeometry()?.getType() ?? "";
  return /Point/.test(t) ? 0 : /LineString/.test(t) ? 1 : 2;
};
