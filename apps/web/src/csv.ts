/** CSV para o Excel em pt-BR: separador ";", vírgula decimal e BOM UTF-8. */
export type CsvValue = string | number | boolean | null | undefined;

export function toCsv(header: string[], rows: CsvValue[][], titulo?: string[]) {
  const q = (v: CsvValue) => {
    if (v == null) return "";
    const s = typeof v === "number" ? String(v).replace(".", ",") : String(v);
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const linhas = [...(titulo ? [titulo.map(q).join(";")] : []), header.map(q).join(";"), ...rows.map((r) => r.map(q).join(";"))];
  return "﻿" + linhas.join("\r\n");
}

export function baixar(nome: string, conteudo: string, tipo = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([conteudo], { type: tipo }));
  const a = Object.assign(document.createElement("a"), { href: url, download: nome });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** "Relatório X" → "relatorio-x" */
export const slug = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
