import type { Extent4326 } from "./types";
import { avisarSessao } from "./auth";

export const GEOSERVER_BASE = "/geoserver";
export const WMS_URL = `${GEOSERVER_BASE}/wms`;
export const GWC_WMTS_URL = `${GEOSERVER_BASE}/gwc/service/wmts`;

export interface CapabilityLayer {
  name: string;
  title: string;
  extent?: Extent4326;
}

/** Lê o GetCapabilities do WMS e retorna as camadas publicadas. */
export async function fetchCapabilities(): Promise<CapabilityLayer[]> {
  const res = avisarSessao(await fetch(`${WMS_URL}?service=WMS&version=1.3.0&request=GetCapabilities`));
  if (!res.ok) throw new Error(`GeoServer respondeu ${res.status}`);
  const xml = new DOMParser().parseFromString(await res.text(), "text/xml");

  return Array.from(xml.querySelectorAll("Layer > Layer"))
    .map((el) => {
      const child = (tag: string) => el.querySelector(`:scope > ${tag}`)?.textContent ?? "";
      const bbox = el.querySelector(":scope > EX_GeographicBoundingBox");
      const num = (tag: string) => Number(bbox?.querySelector(tag)?.textContent);
      const extent: Extent4326 | undefined = bbox
        ? [
            num("westBoundLongitude"),
            num("southBoundLatitude"),
            num("eastBoundLongitude"),
            num("northBoundLatitude"),
          ]
        : undefined;
      return { name: child("Name"), title: child("Title"), extent };
    })
    .filter((l) => l.name);
}

/** Extensão que representa dados reais (não vazia nem com coordenadas absurdas). */
export function isUsableExtent(e?: Extent4326): e is Extent4326 {
  return !!e && e.every(Number.isFinite) && e[0] < e[2] && e[1] < e[3] && e[1] > -89.9 && e[3] < 89.9;
}

export function isEmptyExtent(e?: Extent4326) {
  return !e || (e[0] === e[2] && e[1] === e[3]);
}

/** Ícone de símbolo (estilo do QGIS) gerado pelo GetLegendGraphic. */
export function legendIconUrl(layer: string) {
  const p = new URLSearchParams({
    SERVICE: "WMS",
    VERSION: "1.1.1",
    REQUEST: "GetLegendGraphic",
    FORMAT: "image/png",
    WIDTH: "16",
    HEIGHT: "16",
    TRANSPARENT: "true",
    LAYER: layer,
    LEGEND_OPTIONS: "forceLabels:off;fontAntiAliasing:true",
  });
  return `${WMS_URL}?${p}`;
}

export interface LegendRule {
  /** Nome da regra no SLD (usado em GetLegendGraphic&RULE=) */
  name?: string;
  title: string;
}

/**
 * Regras do estilo padrão da camada (para a legenda em árvore, como no QGIS).
 * Usa GetStyles (SLD) porque o GetLegendGraphic em JSON falha em alguns SLDs antigos.
 * Regras só de rótulo (TextSymbolizer) ficam de fora.
 */
export async function fetchLegendRules(layer: string): Promise<LegendRule[]> {
  const res = await fetch(`${WMS_URL}?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetStyles&LAYERS=${encodeURIComponent(layer)}`);
  if (!res.ok) return [];
  const xml = new DOMParser().parseFromString(await res.text(), "text/xml");
  const direct = (el: Element, tag: string) =>
    Array.from(el.children).find((c) => c.localName === tag)?.textContent?.trim() || undefined;
  return Array.from(xml.getElementsByTagNameNS("*", "Rule"))
    .filter((r) =>
      Array.from(r.children).some((c) => c.localName.endsWith("Symbolizer") && c.localName !== "TextSymbolizer"),
    )
    .map((r) => {
      const desc = Array.from(r.children).find((c) => c.localName === "Description");
      const name = direct(r, "Name");
      return { name, title: direct(r, "Title") ?? (desc && direct(desc, "Title")) ?? name ?? "" };
    });
}

export function ruleIconUrl(layer: string, rule: string) {
  return `${legendIconUrl(layer)}&RULE=${encodeURIComponent(rule)}`;
}

/** Feição de uma camada pelo atributo "fid" (WFS, já em EPSG:3857) — para dar zoom em itens de relatório/busca. */
export async function featureByFid(layer: string, fid: number) {
  const { default: GeoJSON } = await import("ol/format/GeoJSON");
  const name = layer.includes(":") ? layer : `geomonitora:${layer}`;
  const url =
    `${GEOSERVER_BASE}/wfs?service=WFS&version=2.0.0&request=GetFeature&typeNames=${encodeURIComponent(name)}` +
    `&count=1&outputFormat=application/json&srsName=EPSG:3857&CQL_FILTER=${encodeURIComponent(`fid=${Math.trunc(fid)}`)}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const feats = new GeoJSON().readFeatures(await res.json());
  return feats[0] ?? null;
}
