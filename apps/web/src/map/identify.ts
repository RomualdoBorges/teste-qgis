import type OlMap from "ol/Map";
import type Feature from "ol/Feature";
import ImageWMS from "ol/source/ImageWMS";
import GeoJSON from "ol/format/GeoJSON";
import type { Coordinate } from "ol/coordinate";
import { WMS_URL } from "../geoserver";
import { normalizeCrs } from "./projections";
import { avisarSessao } from "../auth";

export interface IdentifyHit {
  layerId: string;
  layerTitle: string;
  features: Feature[];
}

const infoSource = new ImageWMS({ url: WMS_URL, params: {}, serverType: "geoserver" });

/**
 * GetFeatureInfo em todas as camadas ativas de uma vez.
 * `layers` em ordem de desenho (primeira = topo).
 */
export async function identifyAt(
  map: OlMap,
  coordinate: Coordinate,
  layers: { id: string; title: string }[],
): Promise<IdentifyHit[]> {
  if (!layers.length) return [];
  const view = map.getView();
  const names = layers.map((l) => l.id);
  // WMS desenha a primeira de LAYERS por baixo; invertemos para manter o topo por último
  const wmsOrder = names.slice().reverse().join(",");
  infoSource.updateParams({ LAYERS: wmsOrder });
  const url = infoSource.getFeatureInfoUrl(coordinate, view.getResolution()!, view.getProjection(), {
    INFO_FORMAT: "application/json",
    QUERY_LAYERS: wmsOrder,
    FEATURE_COUNT: 50,
    BUFFER: 8,
  });
  if (!url) return [];

  const res = avisarSessao(await fetch(url));
  if (!res.ok) throw new Error(`GetFeatureInfo falhou (${res.status})`);
  const json = await res.json();
  const dataProjection = normalizeCrs(json?.crs?.properties?.name) ?? view.getProjection().getCode();
  const features = new GeoJSON().readFeatures(json, {
    dataProjection,
    featureProjection: view.getProjection(),
  });

  // id da feição = "<featuretype>.<fid>", e o featuretype corresponde ao nome da camada sem o workspace
  const byType = new Map<string, Feature[]>();
  for (const f of features) {
    const type = String(f.getId() ?? "").replace(/\.[^.]*$/, "");
    if (!byType.has(type)) byType.set(type, []);
    byType.get(type)!.push(f);
  }
  return layers
    .map((l) => ({
      layerId: l.id,
      layerTitle: l.title,
      features: byType.get(l.id.split(":").pop()!) ?? [],
    }))
    .filter((h) => h.features.length);
}
