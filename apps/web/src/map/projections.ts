import proj4 from "proj4";
import { register } from "ol/proj/proj4";
import { get as getProjection } from "ol/proj";

// SIRGAS 2000 / UTM zona 23S — CRS nativo dos dados
proj4.defs(
  "EPSG:31983",
  "+proj=utm +zone=23 +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs",
);
register(proj4);

/** Normaliza "urn:ogc:def:crs:EPSG::31983" / "EPSG:31983" → "EPSG:31983" (se conhecido). */
export function normalizeCrs(name?: string | null): string | undefined {
  const code = name?.match(/(\d+)\s*$/)?.[1];
  if (!code) return undefined;
  const id = code === "900913" ? "EPSG:3857" : `EPSG:${code}`;
  return getProjection(id) ? id : undefined;
}
