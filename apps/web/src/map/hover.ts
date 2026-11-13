import { useEffect, useRef } from "react";
import type OlMap from "ol/Map";
import Overlay from "ol/Overlay";
import type MapBrowserEvent from "ol/MapBrowserEvent";
import { getAtivo, type Ativo } from "../api";
import { assetAt, fidOf, type AssetHit } from "./assetClick";

/**
 * Dica ao passar o mouse sobre um ativo (como o tooltip do original):
 * só em zoom alto, depois que o mouse para; o cursor vira "mão" sobre o que abre ficha ao clicar.
 */
const ZOOM_MIN = 18;
const ESPERA_MS = 300;

/** campos da ficha (já traduzidos pela API) mostrados na dica, por camada */
const CAMPOS: Record<string, string[]> = {
  agua_saa_conexoes: ["tipo_peca", "diametro1", "material"],
  agua_saa_valvula: ["tipo_valvula", "posicao_valvula", "diametro"],
  agua_vw_geoserver_front_rede_agua: ["diametro", "material", "tipo_rede"],
  esgoto_ses_geoserver_rede: ["diametro", "material", "declividade"],
  esgoto_ses_geoserver_poco: ["tipo_poco", "cota_tampao", "cota_fundo"],
  esgoto_ses_geoserver_caixa_passagem: ["cota_tampao", "cota_fundo", "bacia"],
  esgoto_ses_geoserver_caixa_ligacao: ["cota_tampao", "cota_fundo", "bacia"],
  drenagem_sdu_geoserver_rede: ["legenda", "tipo_rede", "tipo_secao"],
  drenagem_sdu_rede_drenagem_fluxo: ["legenda", "tipo_rede", "tipo_secao"],
  drenagem_sdu_geoserver_poco_visita: ["nome", "cota_tampao", "cota_fundo"],
};
const PADRAO = ["nome", "tipo_desc", "legenda", "tipo_caixa_desc", "material_desc", "diametro", "estado"];

const cache = new Map<string, Promise<Ativo>>();
const ativo = (camada: string, fid: number) => {
  const k = `${camada}:${fid}`;
  if (!cache.has(k)) {
    if (cache.size > 300) cache.clear();
    cache.set(k, getAtivo(camada, fid).catch((e) => (cache.delete(k), Promise.reject(e))));
  }
  return cache.get(k)!;
};

async function conteudo(hit: AssetHit): Promise<{ titulo: string; linhas: string[] }> {
  const f = hit.features[0];
  const mais = hit.features.length > 1 ? [`+${hit.features.length - 1} ${hit.features.length > 2 ? "itens" : "item"} no ponto`] : [];
  if (hit.kind === "ligacao") {
    const n = Number(f.get("informacoes_clientes") ?? 0);
    return {
      titulo: "Ligação",
      linhas: [
        `Número: ${f.get("endereco_numero") ?? "—"}`,
        `${n} ${n === 1 ? "cliente" : "clientes"} · IPTU ${f.get("inscricao_iptu") ?? "—"}`,
        ...mais,
      ],
    };
  }
  if (hit.kind === "cruzamento") return { titulo: "Cruzamento", linhas: [`Nº ${f.get("no") ?? "—"}`, ...mais] };
  const camada = hit.layerId.split(":").pop()!;
  const a = await ativo(camada, fidOf(f));
  const quer = CAMPOS[camada] ?? PADRAO;
  const linhas = quer
    .map((id) => a.campos.find((c) => c.campo === id))
    .filter((c) => c && c.valor !== null)
    .slice(0, 3)
    .map((c) => `${c!.rotulo}: ${c!.valor}`);
  return { titulo: a.titulo, linhas: [...linhas, ...mais] };
}

export function useAssetHover(
  map: OlMap | null,
  opts: { enabled: boolean; zoom: number; layers: { id: string; title: string }[] },
) {
  const o = useRef(opts);
  o.current = opts;

  useEffect(() => {
    if (!map) return;
    const el = document.createElement("div");
    el.className = "map-tip";
    el.setAttribute("role", "tooltip");
    const overlay = new Overlay({ element: el, positioning: "bottom-center", offset: [0, -14], stopEvent: false });
    map.addOverlay(overlay);
    const target = map.getTargetElement()!;

    let timer = 0;
    let seq = 0;
    let last: number[] | null = null;
    const esconder = () => overlay.setPosition(undefined);
    const limpar = () => {
      seq++;
      clearTimeout(timer);
      esconder();
      target.style.cursor = "";
    };

    const onMove = (e: MapBrowserEvent) => {
      if (e.dragging || !o.current.enabled || o.current.zoom < ZOOM_MIN) {
        if (last) (limpar(), (last = null));
        return;
      }
      const px = e.pixel;
      if (last && (px[0] - last[0]) ** 2 + (px[1] - last[1]) ** 2 < 36) return;
      last = px;
      clearTimeout(timer);
      esconder();
      const coord = e.coordinate;
      const meu = ++seq;
      timer = window.setTimeout(async () => {
        try {
          const hit = await assetAt(map, coord, o.current.layers);
          if (meu !== seq) return;
          target.style.cursor = hit ? "pointer" : "";
          if (!hit) return;
          const c = await conteudo(hit);
          if (meu !== seq) return;
          el.replaceChildren(
            Object.assign(document.createElement("strong"), { textContent: c.titulo }),
            ...c.linhas.map((t) => Object.assign(document.createElement("div"), { textContent: t })),
          );
          overlay.setPosition(coord);
        } catch {
          if (meu === seq) limpar();
        }
      }, ESPERA_MS);
    };

    map.on("pointermove", onMove);
    map.on("singleclick", limpar);
    map.on("movestart", limpar);
    target.addEventListener("mouseleave", limpar);
    return () => {
      clearTimeout(timer);
      map.un("pointermove", onMove);
      map.un("singleclick", limpar);
      map.un("movestart", limpar);
      target.removeEventListener("mouseleave", limpar);
      map.removeOverlay(overlay);
    };
  }, [map]);
}
