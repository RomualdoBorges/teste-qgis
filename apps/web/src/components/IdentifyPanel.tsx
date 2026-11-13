import { useState } from "react";
import type Feature from "ol/Feature";
import type { IdentifyHit } from "../map/identify";
import Icon from "./Icon";

interface Props {
  hits: IdentifyHit[] | null;
  loading: boolean;
  error: string | null;
  onSelect: (f: Feature) => void;
  onZoom: (f: Feature) => void;
  onClose: () => void;
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export default function IdentifyPanel({ hits, loading, error, onSelect, onZoom, onClose }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const total = hits?.reduce((n, h) => n + h.features.length, 0) ?? 0;

  return (
    <aside className="panel identify-panel" aria-label="Resultados da identificação">
      <div className="panel__header">
        <span className="panel__title">
          <Icon name="info" size={16} /> Identificar
        </span>
        <button type="button" className="icon-btn" title="Fechar" onClick={onClose}>
          <Icon name="close" size={16} />
        </button>
      </div>
      <div className="identify-panel__body">
        {loading && <p className="muted">Consultando…</p>}
        {error && <p className="error-text">{error}</p>}
        {!loading && !error && hits && total === 0 && <p className="muted">Nenhuma feição neste ponto.</p>}
        {!loading && !hits && <p className="muted">Clique no mapa para consultar as camadas ativas.</p>}
        {!loading &&
          hits?.map((h) => (
            <section key={h.layerId} className="identify-layer">
              <h3>
                {h.layerTitle} <span className="tree__badge">{h.features.length}</span>
              </h3>
              {h.features.map((f) => {
                const id = String(f.getId());
                const open = openId === id || (total === 1 && openId === null);
                const props = Object.entries(f.getProperties()).filter(([k]) => k !== f.getGeometryName());
                return (
                  <div key={id} className={`identify-feature ${open ? "is-open" : ""}`}>
                    <div className="identify-feature__head">
                      <button
                        type="button"
                        className="identify-feature__toggle"
                        onClick={() => {
                          setOpenId(open ? "" : id);
                          onSelect(f);
                        }}
                      >
                        <span className={`tree__twisty ${open ? "is-open" : ""}`}>
                          <Icon name="chevron" size={14} />
                        </span>
                        {id.split(".").pop()}
                      </button>
                      {f.getGeometry() && (
                        <button type="button" className="icon-btn" title="Zoom na feição" onClick={() => onZoom(f)}>
                          <Icon name="zoomTo" size={15} />
                        </button>
                      )}
                    </div>
                    {open && (
                      <table className="attr-table">
                        <tbody>
                          {props.map(([k, v]) => (
                            <tr key={k}>
                              <th scope="row">{k}</th>
                              <td>{formatValue(v)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                );
              })}
            </section>
          ))}
      </div>
    </aside>
  );
}
