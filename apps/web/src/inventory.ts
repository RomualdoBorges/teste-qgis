/** Cliente da API de inventário agregado (apps/api → função SQL inventario.resumo). */
import { avisarSessao } from "./auth";

export const API_URL = "/api";

export interface InventoryLine {
  rotulo: string;
  quantidade: number;
  extensao_m: number | null;
}
export interface InventoryGroup {
  rotulo: string;
  linhas: InventoryLine[];
}
export interface InventoryItem {
  id: number;
  ativo: string;
  linear: boolean;
  /** Camada WMS correspondente, quando existe */
  camada: string | null;
  quantidade: number;
  extensao_m: number | null;
  grupos: InventoryGroup[];
}
export interface InventorySystem {
  sistema: string;
  itens: InventoryItem[];
}
export interface Inventory {
  area_m2: number | null;
  gerado_em: string;
  sistemas: InventorySystem[];
}

/** area: geometria GeoJSON em EPSG:4326, ou null para o município inteiro. */
export async function fetchInventory(area: object | null, signal?: AbortSignal): Promise<Inventory> {
  const res = avisarSessao(await fetch(`${API_URL}/inventario/resumo`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ area }),
    signal,
  }));
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error(err?.detail ?? err?.message ?? `API respondeu ${res.status}`);
  }
  return res.json();
}

const nf = (d: number) => new Intl.NumberFormat("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d });

/** 1234 → "1,23 km"; 850 → "850 m" */
export function formatLength(m: number | null | undefined) {
  if (m == null) return "—";
  return m >= 1000 ? `${nf(2).format(m / 1000)} km` : `${nf(0).format(m)} m`;
}

export function formatCount(n: number) {
  return nf(0).format(n);
}

export function formatArea(m2: number | null) {
  if (m2 == null) return "";
  return m2 >= 1e6 ? `${nf(2).format(m2 / 1e6)} km²` : `${nf(0).format(m2)} m²`;
}

/** CSV (separador ";" e vírgula decimal, como o Excel em pt-BR espera). */
export function inventoryToCsv(inv: Inventory, escopo: string) {
  const dec = (v: number | null) => (v == null ? "" : String(v).replace(".", ","));
  const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const rows = [["Sistema", "Ativo", "Agrupamento", "Categoria", "Quantidade", "Extensão (m)"]];
  for (const s of inv.sistemas)
    for (const it of s.itens) {
      rows.push([s.sistema, it.ativo, "Total", "", String(it.quantidade), dec(it.extensao_m)]);
      for (const g of it.grupos)
        for (const l of g.linhas) rows.push([s.sistema, it.ativo, g.rotulo, l.rotulo, String(l.quantidade), dec(l.extensao_m)]);
    }
  const head = `${q("Inventário")};${q(escopo)};${q(new Date(inv.gerado_em).toLocaleString("pt-BR"))}`;
  return "﻿" + [head, ...rows.map((r) => r.map(q).join(";"))].join("\r\n");
}
