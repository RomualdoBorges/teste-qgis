/** [minLon, minLat, maxLon, maxLat] em EPSG:4326 */
export type Extent4326 = [number, number, number, number];

export interface LayerNode {
  /** Nome WMS completo, ex.: geomonitora:agua_saa_rede */
  id: string;
  /** Título WMS, ex.: agua.saa_rede */
  title: string;
  /** Rótulo exibido na árvore (nome da tabela) */
  label: string;
  visible: boolean;
  opacity: number;
  extent?: Extent4326;
  /** Extensão degenerada: a tabela não tem feições */
  empty: boolean;
  /** Zoom mínimo para desenhar (config/layers.ts → MIN_ZOOM) */
  minZoom?: number;
  /** Servida por WMTS a partir do cache (config/layers.ts → CACHED_LAYERS) */
  cached: boolean;
}

export interface GroupNode {
  id: string;
  title: string;
  visible: boolean;
  expanded: boolean;
  layers: LayerNode[];
}

export type Tool = "pan" | "identify";
export type BasemapId = "osm" | "positron" | "satellite" | "none";
export type LoadStatus = "loading" | "error";
