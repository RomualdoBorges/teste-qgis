import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import type OlMap from "ol/Map";
import Feature from "ol/Feature";
import GeoJSON from "ol/format/GeoJSON";
import { fromExtent } from "ol/geom/Polygon";
import Point from "ol/geom/Point";
import type Polygon from "ol/geom/Polygon";
import type { Coordinate } from "ol/coordinate";
import { createEmpty, extend, isEmpty } from "ol/extent";
import { fromLonLat, transformExtent } from "ol/proj";
import { featureByFid, fetchCapabilities, isUsableExtent } from "./geoserver";
import { buildGroups, flatLayers, reducer, saveTree } from "./store";
import type { BasemapId, Extent4326, LoadStatus, Tool } from "./types";
import MapView from "./map/MapView";
import { identifyAt, type IdentifyHit } from "./map/identify";
import { isInScale } from "./map/renderPlan";
import Toolbar from "./components/Toolbar";
import LayerTree from "./components/LayerTree";
import IdentifyPanel from "./components/IdentifyPanel";
import StatusBar from "./components/StatusBar";
import InventoryPanel, { type InventoryScope } from "./components/InventoryPanel";
import { fetchInventory, type Inventory } from "./inventory";
import AssetPanel, { type AssetView } from "./components/AssetPanel";
import { assetAt, assetKindOf } from "./map/assetClick";
import { useAssetHover } from "./map/hover";
import { getClientesNaArea, type ResultadoBusca } from "./api";
import ReportsView from "./components/ReportsView";
import PanelResizer, { useLarguraPainel } from "./components/PanelResizer";

const geojson = new GeoJSON();
const toWgs84 = (g: Polygon) =>
  geojson.writeGeometryObject(g, { featureProjection: "EPSG:3857", dataProjection: "EPSG:4326", decimals: 7 });

export default function App() {
  const [tree, dispatch] = useReducer(reducer, { groups: [] });
  const [map, setMap] = useState<OlMap | null>(null);
  const [tool, setTool] = useState<Tool>("pan");
  const [basemap, setBasemap] = useState<BasemapId>("osm");
  const [status, setStatus] = useState<Record<string, LoadStatus>>({});
  const [loadError, setLoadError] = useState<string | null>(null);
  const [identify, setIdentify] = useState<{ hits: IdentifyHit[] | null; loading: boolean; error: string | null } | null>(null);
  const [highlight, setHighlight] = useState<Feature[]>([]);
  const [zoom, setZoom] = useState(12);
  const loaded = useRef(false);

  // ---- inventário ----
  const [invOpen, setInvOpen] = useState(false);
  const [invScope, setInvScope] = useState<InventoryScope>("municipio");
  const [inv, setInv] = useState<{ data: Inventory | null; loading: boolean; error: string | null }>({
    data: null,
    loading: false,
    error: null,
  });
  const [drawing, setDrawing] = useState(false);
  // o desenho serve ao resumo do inventário ou à seleção de ligações por área
  const [drawPurpose, setDrawPurpose] = useState<"inventario" | "ligacoes" | "relatorio">("inventario");
  // relatórios: a tela fica montada depois de aberta (mantém escolha e resultado ao ir e voltar do mapa)
  const [reportsOpen, setReportsOpen] = useState(false);
  const [reportsMounted, setReportsMounted] = useState(false);
  const [reportArea, setReportArea] = useState<object | null>(null);
  const [larguraPainel, setLarguraPainel] = useLarguraPainel();
  const [asset, setAsset] = useState<AssetView | null>(null);
  const [versions, setVersions] = useState<Record<string, number>>({});
  const assetSeq = useRef(0);
  const [invArea, setInvArea] = useState<Feature | null>(null);
  const invAbort = useRef<AbortController | null>(null);

  // carrega camadas do GeoServer
  useEffect(() => {
    fetchCapabilities()
      .then((caps) => {
        dispatch({ type: "init", groups: buildGroups(caps) });
        loaded.current = true;
      })
      .catch((e) => setLoadError(String(e?.message ?? e)));
  }, []);

  // persiste estado da árvore
  useEffect(() => {
    if (loaded.current) saveTree(tree);
  }, [tree]);

  // atalhos de teclado (como no QGIS: P navegar, I identificar)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, select, textarea") || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "p" || e.key === "P") setTool("pan");
      if (e.key === "i" || e.key === "I") setTool("identify");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const active = useMemo(() => flatLayers(tree).filter((f) => f.active), [tree]);

  const zoomTo = useCallback(
    (extents: Extent4326[]) => {
      if (!map) return;
      const ext = createEmpty();
      extents.filter(isUsableExtent).forEach((e) => extend(ext, transformExtent(e, "EPSG:4326", "EPSG:3857")));
      if (!isEmpty(ext)) map.getView().fit(ext, { padding: [40, 40, 40, 40], duration: 300, maxZoom: 19 });
    },
    [map],
  );

  const fullExtent = () => zoomTo(tree.groups.flatMap((g) => g.layers.map((l) => l.extent!)));
  const zoomBy = (d: number) => {
    const v = map?.getView();
    if (v) v.animate({ zoom: (v.getZoom() ?? 0) + d, duration: 200 });
  };

  const onIdentify = useCallback(
    async (coordinate: Coordinate) => {
      if (!map) return;
      setIdentify({ hits: null, loading: true, error: null });
      setHighlight([]);
      try {
        const hits = await identifyAt(
          map,
          coordinate,
          active.filter((a) => isInScale(a.layer, zoom)).map((a) => ({ id: a.layer.id, title: a.layer.label })),
        );
        setIdentify({ hits, loading: false, error: null });
        const first = hits[0]?.features[0];
        setHighlight(first ? [first] : []);
      } catch (e) {
        setIdentify({ hits: null, loading: false, error: String((e as Error).message ?? e) });
      }
    },
    [map, active, zoom],
  );

  const onLoadStatus = useCallback((id: string, s: LoadStatus | null) => {
    setStatus((prev) => {
      if ((prev[id] ?? null) === s) return prev;
      const next = { ...prev };
      if (s) next[id] = s;
      else delete next[id];
      return next;
    });
  }, []);

  const zoomToFeature = (f: Feature) => {
    const g = f.getGeometry();
    if (map && g) map.getView().fit(g.getExtent(), { padding: [80, 80, 80, 80], maxZoom: 20, duration: 300 });
    setHighlight([f]);
  };

  const runInventory = useCallback(async (area: object | null) => {
    invAbort.current?.abort();
    const ctrl = new AbortController();
    invAbort.current = ctrl;
    setInv((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const data = await fetchInventory(area, ctrl.signal);
      if (!ctrl.signal.aborted) setInv({ data, loading: false, error: null });
    } catch (e) {
      if (!ctrl.signal.aborted) setInv({ data: null, loading: false, error: `Não foi possível calcular: ${(e as Error).message}` });
    }
  }, []);

  const inventoryForView = useCallback(() => {
    if (!map) return;
    const poly = fromExtent(map.getView().calculateExtent(map.getSize()));
    setInvArea(new Feature(poly));
    void runInventory(toWgs84(poly));
  }, [map, runInventory]);

  const changeScope = (s: InventoryScope) => {
    setInvScope(s);
    setDrawing(false);
    setDrawPurpose("inventario");
    if (s === "municipio") {
      setInvArea(null);
      void runInventory(null);
    } else if (s === "visivel") {
      inventoryForView();
    } else {
      invAbort.current?.abort();
      setInvArea(null);
      setInv({ data: null, loading: false, error: null });
      setDrawing(true);
    }
  };

  const openInventory = () => {
    if (invOpen) return closeInventory();
    setAsset(null);
    setInvOpen(true);
    setTool("pan");
    setIdentify(null);
    setHighlight([]);
    changeScope(invScope === "desenho" ? "municipio" : invScope);
  };

  const closeInventory = () => {
    invAbort.current?.abort();
    setInvOpen(false);
    setDrawing(false);
    setInvArea(null);
  };

  const onAreaDrawn = useCallback(
    async (poly: Polygon) => {
      setDrawing(false);
      setInvArea(new Feature(poly));
      if (drawPurpose === "inventario") return void runInventory(toWgs84(poly));
      if (drawPurpose === "relatorio") {
        setReportArea(toWgs84(poly));
        setAsset(null);
        setReportsOpen(true);
        return;
      }
      // seleção de ligações por área → lista de clientes
      setAsset({ kind: "loading" });
      try {
        const r = await getClientesNaArea(toWgs84(poly));
        setAsset(
          r.clientes.length
            ? { kind: "area", clientes: r.clientes, truncado: r.truncado }
            : { kind: "empty", message: "Nenhuma ligação com cliente dentro da área desenhada." },
        );
      } catch (e) {
        setAsset({ kind: "empty", message: `Erro: ${(e as Error).message}` });
      }
    },
    [runInventory, drawPurpose],
  );

  const selectArea = () => {
    if (drawing && drawPurpose === "ligacoes") {
      setDrawing(false);
      return;
    }
    if (invOpen) closeInventory();
    setTool("pan");
    setIdentify(null);
    setInvArea(null);
    setDrawPurpose("ligacoes");
    setAsset({ kind: "empty", message: "Desenhe a área no mapa: clique nos vértices e dê duplo clique para terminar (Esc cancela)." });
    setDrawing(true);
  };

  /** Clique no modo navegar: abre a ficha de inventário do ativo (como no original). */
  const onMapClick = useCallback(
    async (coordinate: Coordinate) => {
      if (!map) return;
      const seq = ++assetSeq.current;
      const layers = active.filter((a) => isInScale(a.layer, zoom)).map((a) => ({ id: a.layer.id, title: a.layer.label }));
      try {
        const hit = await assetAt(map, coordinate, layers);
        if (seq !== assetSeq.current) return;
        if (!hit) return; // clique fora de ativos: não muda nada (como no original)
        if (invOpen) closeInventory();
        setInvArea(null);
        setAsset({ kind: "hit", hit });
        setHighlight(hit.features.length === 1 ? [hit.features[0]] : hit.features);
      } catch (e) {
        if (seq === assetSeq.current) setAsset({ kind: "empty", message: `Erro: ${(e as Error).message}` });
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [map, active, zoom, invOpen],
  );

  const selectTool = (t: Tool) => {
    if (t === "identify") {
      if (invOpen) closeInventory();
      setAsset(null);
    }
    setTool(t);
  };

  const closeAsset = () => {
    setAsset(null);
    setHighlight([]);
    if (drawPurpose === "ligacoes" || drawPurpose === "relatorio") {
      setDrawing(false);
      setInvArea(null);
    }
  };

  // ---- busca ----
  const showPoint = (lonlat: [number, number]) => {
    const f = new Feature(new Point(fromLonLat(lonlat)));
    map?.getView().animate({ center: fromLonLat(lonlat), zoom: Math.max(map.getView().getZoom() ?? 0, 20), duration: 400 });
    setHighlight([f]);
  };

  const leaveOtherModes = () => {
    if (invOpen) closeInventory();
    setReportsOpen(false);
    setDrawing(false);
    setIdentify(null);
    setTool("pan");
  };

  const onSearchPick = (r: ResultadoBusca) => {
    leaveOtherModes();
    if (r.tipo === "cliente" && r.cliente_id != null) {
      setInvArea(null);
      setAsset({ kind: "cliente", clienteId: r.cliente_id, fidLigacao: r.ligacao_fid ?? null });
      if (r.ponto) showPoint(r.ponto);
      else setHighlight([]);
    } else if (r.extent) {
      setHighlight([]);
      zoomTo([r.extent]);
    }
  };

  // ---- relatórios ----
  const openReports = () => {
    if (reportsOpen) return setReportsOpen(false);
    if (invOpen) closeInventory();
    setDrawing(false);
    setIdentify(null);
    setReportsMounted(true);
    setReportsOpen(true);
  };

  const drawReportArea = () => {
    setReportsOpen(false);
    setTool("pan");
    setInvArea(null);
    setDrawPurpose("relatorio");
    setAsset({ kind: "empty", message: "Desenhe a área do relatório: clique nos vértices e dê duplo clique para terminar (Esc cancela)." });
    setDrawing(true);
  };

  const openFromReport = async (camada: string, fid: number, view: (f: Feature | null) => AssetView) => {
    setReportsOpen(false);
    setInvArea(null);
    setAsset(view(null));
    const f = await featureByFid(camada, fid).catch(() => null);
    if (!f) return setHighlight([]);
    setAsset(view(f));
    zoomToFeature(f);
  };

  // dica ao passar o mouse (só nas camadas com ficha, ativas e na escala)
  const hoverLayers = useMemo(
    () => active.filter((a) => isInScale(a.layer, zoom) && assetKindOf(a.layer.id)).map((a) => ({ id: a.layer.id, title: a.layer.label })),
    [active, zoom],
  );
  useAssetHover(map, { enabled: tool === "pan" && !drawing && !reportsOpen, zoom, layers: hoverLayers });

  const knownLayers = useMemo(() => new Set(tree.groups.flatMap((g) => g.layers.map((l) => l.id))), [tree]);

  const loadingCount = Object.values(status).filter((s) => s === "loading").length;
  const showIdentify = !invOpen && !asset && (tool === "identify" || identify !== null);

  return (
    <div className="app">
      <Toolbar
        tool={tool}
        basemap={basemap}
        inventoryOpen={invOpen}
        onInventory={openInventory}
        selectingArea={drawPurpose === "ligacoes" && (drawing || asset?.kind === "area")}
        onSelectArea={selectArea}
        reportsOpen={reportsOpen}
        onReports={openReports}
        onSearchPick={onSearchPick}
        onTool={selectTool}
        onBasemap={setBasemap}
        onZoomIn={() => zoomBy(1)}
        onZoomOut={() => zoomBy(-1)}
        onFullExtent={fullExtent}
      />
      <div className="workspace" style={{ "--side-w": `${larguraPainel}px` } as React.CSSProperties}>
        {loadError ? (
          <aside className="panel layer-panel">
            <div className="panel__header">
              <span className="panel__title">Camadas</span>
            </div>
            <p className="error-text" style={{ padding: 12 }}>
              Não foi possível ler as camadas: {loadError}. O GeoServer está rodando?
            </p>
          </aside>
        ) : tree.groups.length === 0 ? (
          <aside className="panel layer-panel">
            <div className="panel__header">
              <span className="panel__title">Camadas</span>
            </div>
            <p className="muted" style={{ padding: 12 }}>
              Carregando camadas do GeoServer…
            </p>
          </aside>
        ) : (
          <LayerTree tree={tree} dispatch={dispatch} status={status} zoom={zoom} onZoomTo={zoomTo} />
        )}
        <main className="map-wrap">
          <MapView
            tree={tree}
            basemap={basemap}
            tool={tool}
            highlight={highlight}
            onReady={setMap}
            onLoadStatus={onLoadStatus}
            onIdentify={onIdentify}
            onZoom={setZoom}
            area={invArea}
            drawing={drawing}
            onAreaDrawn={onAreaDrawn}
            onMapClick={onMapClick}
            versions={versions}
          />
        </main>
        {reportsMounted && (
          <div className="reports-wrap" hidden={!reportsOpen}>
            <ReportsView
              area={reportArea}
              onDrawArea={drawReportArea}
              onOpenCliente={(id, fid) => {
                const view = (): AssetView => ({ kind: "cliente", clienteId: id, fidLigacao: fid });
                if (fid == null) {
                  setReportsOpen(false);
                  setInvArea(null);
                  setHighlight([]);
                  return setAsset(view());
                }
                void openFromReport("agua_geoserver_ligacoes_quant_client", fid, view);
              }}
              onOpenAtivo={(camada, fid) => void openFromReport(camada, fid, (f) => ({ kind: "ativo", camada, fid, feature: f }))}
              onClose={() => setReportsOpen(false)}
            />
          </div>
        )}
        {((asset && !invOpen) || invOpen || showIdentify) && <PanelResizer largura={larguraPainel} onChange={setLarguraPainel} />}
        {asset && !invOpen && (
          <AssetPanel
            view={asset}
            onSelectFeature={(f) => setHighlight([f])}
            onZoomFeature={zoomToFeature}
            onChanged={(id) => setVersions((v) => ({ ...v, [id]: (v[id] ?? 0) + 1 }))}
            onClose={closeAsset}
          />
        )}
        {invOpen && (
          <InventoryPanel
            scope={invScope}
            data={inv.data}
            loading={inv.loading}
            error={inv.error}
            drawing={drawing}
            knownLayers={knownLayers}
            onScope={changeScope}
            onRefresh={() => (invScope === "visivel" ? inventoryForView() : changeScope("desenho"))}
            onShowLayer={(id) => dispatch({ type: "showLayer", id })}
            onClose={closeInventory}
          />
        )}
        {showIdentify && (
          <IdentifyPanel
            hits={identify?.hits ?? null}
            loading={identify?.loading ?? false}
            error={identify?.error ?? null}
            onSelect={(f) => setHighlight([f])}
            onZoom={zoomToFeature}
            onClose={() => {
              setIdentify(null);
              setHighlight([]);
              setTool("pan");
            }}
          />
        )}
      </div>
      <StatusBar map={map} activeCount={active.length} loadingCount={loadingCount} />
    </div>
  );
}
