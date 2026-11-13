/** Cliente da API do visualizador (apps/api, FastAPI). */
import { avisarSessao } from "./auth";
export const API = "/api";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = avisarSessao(await fetch(`${API}${path}`, init));
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const d = body?.detail;
    throw new Error(typeof d === "string" ? d : Array.isArray(d) ? d.map((x) => x.msg).join("; ") : `API respondeu ${res.status}`);
  }
  return res.json();
}
const post = <T>(path: string, body: unknown) =>
  req<T>(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

// ---------- ligações / clientes ----------
export interface ClienteResumo {
  id: number;
  codigo_cliente: string;
  nome: string | null;
  endereco_rua: string | null;
  endereco_numero: string | null;
  endereco_complemento: string | null;
  categoria_de_uso: string | null;
  data_ligacao: string | null;
  /** presente na seleção por área */
  fid?: number;
  inscricao_iptu?: string;
}
export interface Ligacao {
  fid: number;
  inscricao_iptu: string | null;
  zona: number | null;
  quadra: number | null;
  lote: number | null;
}
export const getClientesDaLigacao = (fid: number) =>
  req<{ ligacao: Ligacao; clientes: ClienteResumo[] }>(`/ligacoes/${fid}/clientes`);
export const getClientesNaArea = (area: object) =>
  post<{ truncado: boolean; clientes: ClienteResumo[] }>("/ligacoes/clientes-na-area", { area });

export type Cliente = Record<string, string | number | boolean | null> & {
  id: number;
  codigo_cliente: string;
  fid_ligacao: number | null;
};
export const getCliente = (id: number) => req<Cliente>(`/clientes/${id}`);

export interface ConsumoAno {
  ano_at: number;
  [mes: string]: number;
}
export const getConsumoMensal = (codigo: string) => req<ConsumoAno[]>(`/clientes/${encodeURIComponent(codigo)}/consumo-mensal`);

// ---------- arquivos ----------
export interface Arquivo {
  id: number;
  descricao: string;
  tipo_documento: string | null;
  data_documento: string | null;
  data_criacao: string | null;
  disponivel: boolean;
}
export type Vinculo = { ligacao: number } | { cruzamento: number };
export const getArquivos = (v: Vinculo) =>
  req<Arquivo[]>(`/arquivos?${"ligacao" in v ? `ligacao=${v.ligacao}` : `cruzamento=${v.cruzamento}`}`);
export const getTiposDocumento = () => req<string[]>("/arquivos/tipos-documento");
export const arquivoUrl = (id: number) => `${API}/arquivos/${id}/download`;
export const excluirArquivo = (id: number) => req<{ ok: boolean }>(`/arquivos/${id}`, { method: "DELETE" });
export function enviarArquivo(v: Vinculo, data: { arquivo: File; descricao: string; tipo: string; data: string }) {
  const fd = new FormData();
  fd.append("documento", data.arquivo);
  fd.append("descricao", data.descricao);
  fd.append("tipo_documento", data.tipo);
  fd.append("data_documento", data.data);
  fd.append("ligacao" in v ? "ligacoes" : "cruzamentos", String("ligacao" in v ? v.ligacao : v.cruzamento));
  return req<{ id: number }>("/arquivos", { method: "POST", body: fd });
}

// ---------- ativos ----------
export interface Campo {
  campo: string;
  rotulo: string;
  valor: string | number | null;
}
export interface Ativo {
  camada: string;
  titulo: string;
  fid: number;
  campos: Campo[];
  edicao?: { campo: string; valor: number | null; opcoes: { id: number; descricao: string }[] };
}
export const getAtivo = (camada: string, fid: number) => req<Ativo>(`/ativos/${encodeURIComponent(camada)}/${fid}`);
export const setPosicaoValvula = (fid: number, posicao: number) =>
  req<{ fid: number; posicao_valvula: number }>(`/valvulas/${fid}/posicao`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ posicao_valvula: posicao }),
  });

// ---------- formatação ----------
export const fmtDate = (v: unknown) => {
  if (!v) return null;
  const s = String(v);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  if (!m) return s;
  return `${m[3]}/${m[2]}/${m[1]}${m[4] && `${m[4]}:${m[5]}` !== "00:00" ? ` ${m[4]}:${m[5]}` : ""}`;
};

// ---------- busca ----------
export interface ResultadoBusca {
  tipo: "cliente" | "logradouro" | "area";
  titulo: string | null;
  detalhe: string | null;
  /** cliente: ponto da ligação do lote (lon, lat) */
  ponto?: [number, number] | null;
  /** logradouro/área: [minx, miny, maxx, maxy] em EPSG:4326 */
  extent?: [number, number, number, number];
  cliente_id?: number;
  ligacao_fid?: number | null;
  codigo_cliente?: string;
}
export const buscar = (q: string, signal?: AbortSignal) =>
  req<ResultadoBusca[]>(`/busca?q=${encodeURIComponent(q)}`, { signal });

// ---------- relatórios ----------
export type TipoEscopo = "global" | "dmc" | "setor" | "bacia_esgoto" | "bacia_drenagem" | "area";
export interface Escopo {
  tipo: TipoEscopo;
  id?: number;
  /** GeoJSON EPSG:4326 */
  area?: object;
}
export interface ParamRelatorio {
  id: string;
  rotulo: string;
  tipo: "numero" | "data" | "mes" | "select";
  padrao: string | number;
  opcoes?: string[];
}
export interface ItemCatalogo {
  sistema: string;
  id: string;
  titulo: string;
  params: ParamRelatorio[];
}
export type TipoColuna = "texto" | "inteiro" | "decimal" | "km" | "pct" | "data";
export interface ColunaRelatorio {
  id: string;
  rotulo: string;
  tipo: TipoColuna;
  soma: boolean;
}
export type LinhaRelatorio = Record<string, string | number | null>;
export interface Relatorio {
  id: string;
  sistema: string;
  titulo: string;
  colunas: ColunaRelatorio[];
  linhas: LinhaRelatorio[];
  /** coluna desenhada como barra de percentual */
  barra?: string;
  nota?: string;
  truncado?: boolean;
  /** linhas abrem a ficha do cliente (id) */
  abre?: "cliente";
  /** linhas são feições desta camada (fid) */
  camada?: string;
}
export type Escopos = Record<Exclude<TipoEscopo, "global" | "area">, { rotulo: string; itens: { id: number; nome: string }[] }>;

export const getCatalogo = () => req<ItemCatalogo[]>("/relatorios");
export const getEscopos = () => req<Escopos>("/relatorios/escopos");
export const gerarRelatorio = (id: string, escopo: Escopo, params: Record<string, unknown>, signal?: AbortSignal) =>
  req<Relatorio>(`/relatorios/${id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ escopo, params }),
    signal,
  });
