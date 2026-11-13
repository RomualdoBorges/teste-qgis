import { BASEMAPS } from "../map/basemaps";
import type { BasemapId, Tool } from "../types";
import type { ResultadoBusca } from "../api";
import Icon, { type IconName } from "./Icon";
import SearchBox from "./SearchBox";
import { useAuth } from "../auth";

interface Props {
  tool: Tool;
  basemap: BasemapId;
  inventoryOpen: boolean;
  onInventory: () => void;
  selectingArea: boolean;
  onSelectArea: () => void;
  reportsOpen: boolean;
  onReports: () => void;
  onSearchPick: (r: ResultadoBusca) => void;
  onTool: (t: Tool) => void;
  onBasemap: (b: BasemapId) => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFullExtent: () => void;
}

function Btn(p: { icon: IconName; title: string; active?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`tool-btn ${p.active ? "tool-btn--active" : ""}`}
      title={p.title}
      aria-label={p.title}
      aria-pressed={p.active}
      onClick={p.onClick}
    >
      <Icon name={p.icon} />
    </button>
  );
}

export default function Toolbar(p: Props) {
  const { usuario, sair } = useAuth();
  return (
    <header className="toolbar">
      <div className="toolbar__brand">
        <Icon name="layers" size={20} />
        <span>geomonitora</span>
      </div>
      <div className="toolbar__group">
        <Btn icon="pan" title="Navegar — clique num ativo para abrir o inventário (P)" active={p.tool === "pan"} onClick={() => p.onTool("pan")} />
        <Btn
          icon="info"
          title="Identificar feições — atributos brutos de todas as camadas (I)"
          active={p.tool === "identify"}
          onClick={() => p.onTool("identify")}
        />
      </div>
      <div className="toolbar__group">
        <Btn icon="plus" title="Aproximar" onClick={p.onZoomIn} />
        <Btn icon="minus" title="Afastar" onClick={p.onZoomOut} />
        <Btn icon="extent" title="Zoom na extensão total" onClick={p.onFullExtent} />
      </div>
      <div className="toolbar__group">
        <Btn icon="select" title="Selecionar ligações por área (lista de clientes)" active={p.selectingArea} onClick={p.onSelectArea} />
        <Btn icon="inventory" title="Inventário de ativos (resumo por área)" active={p.inventoryOpen} onClick={p.onInventory} />
        <Btn icon="report" title="Relatórios (clientes, água, esgoto, drenagem)" active={p.reportsOpen} onClick={p.onReports} />
      </div>
      <div className="toolbar__group toolbar__group--search">
        <SearchBox onPick={p.onSearchPick} />
      </div>
      <div className="toolbar__spacer" />
      <label className="toolbar__select">
        Mapa base
        <select value={p.basemap} onChange={(e) => p.onBasemap(e.target.value as BasemapId)}>
          {BASEMAPS.map((b) => (
            <option key={b.id} value={b.id}>
              {b.label}
            </option>
          ))}
        </select>
      </label>
      <div className="toolbar__user">
        <span title={usuario.usuario}>{usuario.nome}</span>
        <button type="button" className="btn" onClick={sair} title="Encerrar a sessão">
          Sair
        </button>
      </div>
    </header>
  );
}
