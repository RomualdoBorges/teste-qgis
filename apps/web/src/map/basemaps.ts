import TileLayer from "ol/layer/Tile";
import OSM from "ol/source/OSM";
import XYZ from "ol/source/XYZ";
import type { BasemapId } from "../types";

export const BASEMAPS: { id: BasemapId; label: string }[] = [
  { id: "osm", label: "OpenStreetMap" },
  { id: "positron", label: "Claro (OSM)" },
  { id: "satellite", label: "Satélite (Esri)" },
  { id: "none", label: "Sem mapa base" },
];

export function createBasemap(id: BasemapId): TileLayer | null {
  switch (id) {
    case "osm":
      return new TileLayer({ source: new OSM() });
    case "positron":
      // O Carto (basemaps.cartocdn.com, usado pelo original) passou a exigir chave em todos os endereços: devolve
      // "API KEY REQUIRED" no lugar dos tiles. Mapa claro equivalente, sem chave: OSM em tons de cinza claros
      // (filtro CSS na camada, ver .basemap--claro em index.css).
      return new TileLayer({ source: new OSM(), className: "basemap--claro" });
    case "satellite":
      return new TileLayer({
        source: new XYZ({
          url: "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
          attributions: "Tiles © Esri",
          maxZoom: 19,
        }),
      });
    case "none":
      return null;
  }
}
