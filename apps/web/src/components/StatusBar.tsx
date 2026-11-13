import { useEffect, useState } from "react";
import type OlMap from "ol/Map";
import { getPointResolution, transform } from "ol/proj";
import type { Coordinate } from "ol/coordinate";

type Crs = "EPSG:31983" | "EPSG:4326";
const INCH_PER_M = 39.3701;
const DPI = 96;

function currentScale(map: OlMap) {
  const view = map.getView();
  const res = view.getResolution();
  const center = view.getCenter();
  if (!res || !center) return 0;
  return getPointResolution(view.getProjection(), res, center, "m") * INCH_PER_M * DPI;
}

function formatCoord(c: Coordinate | null, crs: Crs) {
  if (!c) return "—";
  const p = transform(c, "EPSG:3857", crs);
  return crs === "EPSG:4326"
    ? `${p[1].toFixed(6)}, ${p[0].toFixed(6)}`
    : `${p[0].toLocaleString("pt-BR", { maximumFractionDigits: 1 })} E, ${p[1].toLocaleString("pt-BR", { maximumFractionDigits: 1 })} N`;
}

export default function StatusBar({ map, activeCount, loadingCount }: { map: OlMap | null; activeCount: number; loadingCount: number }) {
  const [coord, setCoord] = useState<Coordinate | null>(null);
  const [crs, setCrs] = useState<Crs>("EPSG:31983");
  const [scale, setScale] = useState(0);
  const [scaleInput, setScaleInput] = useState("");
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    if (!map) return;
    const move = (e: { coordinate: Coordinate }) => setCoord(e.coordinate);
    const update = () => setScale(currentScale(map));
    map.on("pointermove", move);
    map.on("moveend", update);
    update();
    return () => {
      map.un("pointermove", move);
      map.un("moveend", update);
    };
  }, [map]);

  const applyScale = () => {
    setEditing(false);
    const target = Number(scaleInput.replace(/[^\d]/g, ""));
    if (!map || !target) return;
    const view = map.getView();
    const ratio = currentScale(map) / view.getResolution()!;
    view.animate({ resolution: target / ratio, duration: 200 });
  };

  return (
    <footer className="statusbar">
      <span className="statusbar__item">
        {loadingCount > 0 ? (
          <>
            <span className="tree__spinner" /> Renderizando {loadingCount} camada{loadingCount > 1 ? "s" : ""}…
          </>
        ) : (
          `${activeCount} camada${activeCount === 1 ? "" : "s"} ativa${activeCount === 1 ? "" : "s"}`
        )}
      </span>
      <span className="statusbar__spacer" />
      <label className="statusbar__item">
        Coordenada
        <output className="statusbar__value statusbar__coord">{formatCoord(coord, crs)}</output>
      </label>
      <label className="statusbar__item">
        Escala 1:
        <input
          className="statusbar__value statusbar__scale"
          value={editing ? scaleInput : Math.round(scale).toLocaleString("pt-BR")}
          onFocus={() => {
            setEditing(true);
            setScaleInput(String(Math.round(scale)));
          }}
          onChange={(e) => setScaleInput(e.target.value)}
          onBlur={applyScale}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
        />
      </label>
      <label className="statusbar__item">
        SRC
        <select value={crs} onChange={(e) => setCrs(e.target.value as Crs)}>
          <option value="EPSG:31983">EPSG:31983 (SIRGAS 2000 / UTM 23S)</option>
          <option value="EPSG:4326">EPSG:4326 (lat, lon)</option>
        </select>
      </label>
    </footer>
  );
}
