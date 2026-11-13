import { useEffect, useMemo, useRef, useState } from "react";
import OlMap from "ol/Map";
import View from "ol/View";
import TileLayer from "ol/layer/Tile";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import TileWMS from "ol/source/TileWMS";
import XYZ from "ol/source/XYZ";
import type TileSource from "ol/source/Tile";
import { createXYZ } from "ol/tilegrid";
import { Style, Stroke, Fill, Circle as CircleStyle } from "ol/style";
import { fromLonLat, toLonLat, transformExtent } from "ol/proj";
import { defaults as defaultControls, ScaleLine } from "ol/control";
import DoubleClickZoom from "ol/interaction/DoubleClickZoom";
import Draw from "ol/interaction/Draw";
import type Polygon from "ol/geom/Polygon";
import type Feature from "ol/Feature";
import type { Coordinate } from "ol/coordinate";
import { GWC_WMTS_URL, WMS_URL } from "../geoserver";
import type { TreeState } from "../store";
import type { BasemapId, LoadStatus, Tool } from "../types";
import { createBasemap } from "./basemaps";
import { buildRenderPlan, type RenderEntry } from "./renderPlan";
import "./projections";

interface Props {
  tree: TreeState;
  basemap: BasemapId;
  tool: Tool;
  highlight: Feature[];
  onReady: (map: OlMap) => void;
  onLoadStatus: (layerId: string, status: LoadStatus | null) => void;
  onIdentify: (coordinate: Coordinate) => void;
  onZoom: (zoom: number) => void;
  /** Área do inventário exibida no mapa (contorno tracejado) */
  area: Feature | null;
  /** Ativa a ferramenta de desenho de polígono */
  drawing: boolean;
  onAreaDrawn: (polygon: Polygon) => void;
  /** clique no modo navegar (abre o inventário do ativo) */
  onMapClick: (coordinate: Coordinate) => void;
  /** versão por camada: ao mudar, a camada é redesenhada (ex.: após editar um ativo) */
  versions: Record<string, number>;
}

const areaStyle = new Style({
  stroke: new Stroke({ color: "#1f6fd1", width: 2, lineDash: [8, 6] }),
  fill: new Fill({ color: "rgba(31, 111, 209, 0.06)" }),
});

const highlightStyle = new Style({
  stroke: new Stroke({ color: "#ff1f8f", width: 3 }),
  fill: new Fill({ color: "rgba(255, 31, 143, 0.15)" }),
  image: new CircleStyle({
    radius: 7,
    stroke: new Stroke({ color: "#ff1f8f", width: 3 }),
    fill: new Fill({ color: "rgba(255, 31, 143, 0.25)" }),
  }),
});

/** Grade de tiles de 512 px (4× menos requisições que 256 px) para o WMS dinâmico. */
const grid512 = createXYZ({ tileSize: 512, maxZoom: 22 });
/** Máximo de fontes ocultas mantidas em memória para religar sem refazer requisições. */
const MAX_IDLE = 30;

export default function MapView(props: Props) {
  const { tree, basemap, tool, highlight, onReady, area, drawing } = props;
  const areaSource = useRef(new VectorSource());
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<OlMap | null>(null);
  const pool = useRef(new Map<string, { layer: TileLayer<TileSource>; entry: RenderEntry; v?: number }>());
  const highlightSource = useRef(new VectorSource());
  const basemapLayer = useRef<TileLayer | null>(null);
  const [zoom, setZoom] = useState(12);

  // callbacks mais recentes sem recriar listeners
  const cb = useRef(props);
  cb.current = props;

  // cria o mapa uma única vez
  useEffect(() => {
    const map = new OlMap({
      target: el.current!,
      // padrão do OpenLayers é 16 tiles simultâneos; com dezenas de camadas isso vira o gargalo
      maxTilesLoading: 96,
      controls: defaultControls({ zoom: false, rotate: false }).extend([new ScaleLine({ units: "metric" })]),
      layers: [
        new VectorLayer({ source: areaSource.current, style: areaStyle, zIndex: 99999 }),
        new VectorLayer({ source: highlightSource.current, style: highlightStyle, zIndex: 100000 }),
      ],
      view: new View({ ...viewFromHash(), maxZoom: 22 }),
    });
    map.on("singleclick", (e) => {
      if (cb.current.drawing) return;
      if (cb.current.tool === "identify") cb.current.onIdentify(e.coordinate);
      else cb.current.onMapClick(e.coordinate);
    });
    // o plano só muda quando o zoom cruza um limite de escala, então basta atualizar no fim do movimento
    map.on("moveend", () => {
      const z = map.getView().getZoom() ?? 0;
      const [lon, lat] = toLonLat(map.getView().getCenter()!);
      history.replaceState(null, "", `#map=${z.toFixed(2)}/${lat.toFixed(6)}/${lon.toFixed(6)}`);
      setZoom(z);
      cb.current.onZoom(z);
    });
    mapRef.current = map;
    onReady(map);
    return () => map.setTarget(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // mapa base
  useEffect(() => {
    const map = mapRef.current!;
    if (basemapLayer.current) map.removeLayer(basemapLayer.current);
    basemapLayer.current = createBasemap(basemap);
    if (basemapLayer.current) {
      basemapLayer.current.setZIndex(0);
      map.addLayer(basemapLayer.current);
    }
  }, [basemap]);

  const plan = useMemo(() => buildRenderPlan(tree, zoom), [tree, zoom]);

  // aplica o plano: reutiliza fontes existentes, cria as novas, esconde as que saíram
  useEffect(() => {
    const map = mapRef.current!;
    const used = new Set<string>();
    plan.forEach((entry, i) => {
      used.add(entry.key);
      let item = pool.current.get(entry.key);
      if (!item) {
        const layer = createLayer(entry, (s) => entry.layers.forEach((id) => cb.current.onLoadStatus(id, s)));
        item = { layer, entry };
        pool.current.set(entry.key, item);
        map.addLayer(layer);
      }
      item.layer.setVisible(true);
      item.layer.setOpacity(entry.opacity);
      item.layer.setZIndex(10 + plan.length - i); // primeira do plano = topo
    });

    const idle: string[] = [];
    for (const [key, item] of pool.current) {
      if (used.has(key)) continue;
      if (item.layer.getVisible()) {
        item.layer.setVisible(false);
        item.entry.layers.forEach((id) => cb.current.onLoadStatus(id, null));
      }
      idle.push(key);
    }
    // descarta as fontes ociosas mais antigas
    for (const key of idle.slice(0, Math.max(0, idle.length - MAX_IDLE))) {
      const item = pool.current.get(key)!;
      map.removeLayer(item.layer);
      item.layer.dispose();
      pool.current.delete(key);
    }
  }, [plan]);

  // redesenha fontes cujas camadas mudaram de versão
  useEffect(() => {
    for (const item of pool.current.values()) {
      const v = item.entry.layers.reduce((n, id) => n + (props.versions[id] ?? 0), 0);
      if (v && item.v !== v) {
        const src = item.layer.getSource();
        if (src instanceof TileWMS) src.updateParams({ _v: v });
        item.v = v;
      }
    }
  }, [props.versions, plan]);

  // no modo identificar (e ao desenhar), duplo clique não aproxima (como no QGIS)
  useEffect(() => {
    const set = (active: boolean) =>
      mapRef.current?.getInteractions().forEach((i) => i instanceof DoubleClickZoom && i.setActive(active));
    const enable = tool !== "identify" && !drawing;
    if (!enable) {
      set(false);
      return;
    }
    // o desenho termina no duplo clique: religar só depois, senão o mesmo duplo clique aproxima o mapa
    const t = setTimeout(() => set(true), 400);
    return () => clearTimeout(t);
  }, [tool, drawing]);

  // área do inventário
  useEffect(() => {
    areaSource.current.clear();
    if (area) areaSource.current.addFeature(area);
  }, [area]);

  // desenho de polígono para o inventário
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !drawing) return;
    const draw = new Draw({ type: "Polygon", style: areaStyle });
    draw.on("drawend", (e) => cb.current.onAreaDrawn(e.feature.getGeometry() as Polygon));
    map.addInteraction(draw);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && draw.abortDrawing();
    window.addEventListener("keydown", esc);
    return () => {
      map.removeInteraction(draw);
      window.removeEventListener("keydown", esc);
    };
  }, [drawing]);

  // destaque das feições identificadas
  useEffect(() => {
    highlightSource.current.clear();
    highlightSource.current.addFeatures(highlight);
  }, [highlight]);

  return <div ref={el} className={`map ${tool === "identify" ? "map--identify" : ""} ${drawing ? "map--draw" : ""}`} />;
}

/** Posição inicial do mapa a partir de #map=zoom/lat/lon (link compartilhável). */
function viewFromHash() {
  const m = location.hash.match(/map=([\d.]+)\/(-?[\d.]+)\/(-?[\d.]+)/);
  if (m) return { zoom: Number(m[1]), center: fromLonLat([Number(m[3]), Number(m[2])]) };
  return { zoom: 12, center: fromLonLat([-46.56, -23.62]) };
}

function createLayer(entry: RenderEntry, setStatus: (s: LoadStatus | null) => void) {
  const source: TileSource =
    entry.kind === "wmts"
      ? new XYZ({
          // GeoWebCache: gridset EPSG:900913 (= Web Mercator, tiles 256 px), mesma origem do XYZ
          url:
            `${GWC_WMTS_URL}?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${encodeURIComponent(entry.layers[0])}` +
            `&STYLE=&TILEMATRIXSET=EPSG:900913&TILEMATRIX=EPSG:900913:{z}&TILEROW={y}&TILECOL={x}&FORMAT=image/png`,
          maxZoom: 22,
          transition: 0,
        })
      : new TileWMS({
          url: WMS_URL,
          // WMS desenha o primeiro item de LAYERS por baixo; o plano tem o topo primeiro
          params: { LAYERS: entry.layers.slice().reverse().join(","), FORMAT: "image/png8", TRANSPARENT: true },
          serverType: "geoserver",
          tileGrid: grid512,
          transition: 0,
        });

  let pending = 0;
  let failed = false;
  source.on("tileloadstart", () => {
    if (pending++ === 0) setStatus("loading");
  });
  const done = (error: boolean) => {
    failed ||= error;
    pending = Math.max(0, pending - 1);
    if (pending === 0) {
      setStatus(failed ? "error" : null);
      failed = false;
    }
  };
  source.on("tileloadend", () => done(false));
  source.on("tileloaderror", () => done(true));
  return new TileLayer({
    source,
    extent: entry.extent ? transformExtent(entry.extent, "EPSG:4326", "EPSG:3857") : undefined,
    properties: { key: entry.key },
  });
}
