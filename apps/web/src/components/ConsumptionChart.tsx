import { useMemo, useRef, useState, type PointerEvent } from "react";
import type { ConsumoAno } from "../api";

export const MESES = ["janeiro", "fevereiro", "marco", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
export const MESES_CURTO = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export interface Ponto {
  ano: number;
  mes: number; // 0-11
  valor: number;
}

/** Série mês a mês; zeros no fim da série (meses ainda não faturados) são descartados. */
export function serieMensal(dados: ConsumoAno[]): Ponto[] {
  const pts = dados
    .slice()
    .sort((a, b) => a.ano_at - b.ano_at)
    .flatMap((a) => MESES.map((m, i) => ({ ano: a.ano_at, mes: i, valor: Number(a[m] ?? 0) })));
  let fim = pts.length;
  while (fim > 0 && pts[fim - 1].valor === 0) fim--;
  return pts.slice(0, fim);
}

function niceMax(v: number) {
  if (v <= 0) return 10;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}

const W = 340;
const H = 190;
const M = { top: 14, right: 34, bottom: 22, left: 34 };

/**
 * Consumo faturado mês a mês (uma série, linha 2px + área 10%), crosshair e tooltip no hover.
 * A tabela equivalente é a aba "Histórico".
 */
export default function ConsumptionChart({ dados, width = W, height = H }: { dados: ConsumoAno[]; width?: number; height?: number }) {
  const pts = useMemo(() => serieMensal(dados), [dados]);
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  if (!pts.length) return <p className="muted">Sem consumo faturado registrado.</p>;

  const iw = width - M.left - M.right;
  const ih = height - M.top - M.bottom;
  const max = niceMax(Math.max(...pts.map((p) => p.valor)));
  const x = (i: number) => M.left + (pts.length === 1 ? iw / 2 : (i / (pts.length - 1)) * iw);
  const y = (v: number) => M.top + ih - (v / max) * ih;
  const ticks = [0, max / 2, max];
  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.valor).toFixed(1)}`).join("");
  const area = `${line}L${x(pts.length - 1).toFixed(1)},${y(0)}L${x(0).toFixed(1)},${y(0)}Z`;
  const anos = pts.map((p, i) => ({ p, i })).filter(({ p }) => p.mes === 0);
  const last = pts[pts.length - 1];
  const fmt = (v: number) => v.toLocaleString("pt-BR", { maximumFractionDigits: 1 });

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    const r = svgRef.current!.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * width;
    const i = Math.round(((px - M.left) / iw) * (pts.length - 1));
    setHover(Math.max(0, Math.min(pts.length - 1, i)));
  };

  const h = hover !== null ? pts[hover] : null;
  const tipLeft = hover !== null ? (x(hover) / width) * 100 : 0;

  return (
    <div className="chart">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        role="img"
        aria-label={`Consumo faturado mensal de ${MESES_CURTO[pts[0].mes]}/${pts[0].ano} a ${MESES_CURTO[last.mes]}/${last.ano}`}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line className="chart__grid" x1={M.left} x2={M.left + iw} y1={y(t)} y2={y(t)} />
            <text className="chart__tick" x={M.left - 6} y={y(t)} dy="0.32em" textAnchor="end">
              {fmt(t)}
            </text>
          </g>
        ))}
        {anos.map(({ p, i }) => (
          <text key={p.ano} className="chart__tick" x={x(i)} y={height - 6} textAnchor="middle">
            {p.ano}
          </text>
        ))}
        <path className="chart__area" d={area} />
        <path className="chart__line" d={line} />
        <circle className="chart__end" cx={x(pts.length - 1)} cy={y(last.valor)} r={4} />
        <text className="chart__label" x={x(pts.length - 1) + 7} y={y(last.valor)} dy="0.32em">
          {fmt(last.valor)}
        </text>
        {h && hover !== null && (
          <g>
            <line className="chart__cross" x1={x(hover)} x2={x(hover)} y1={M.top} y2={M.top + ih} />
            <circle className="chart__dot" cx={x(hover)} cy={y(h.valor)} r={4.5} />
          </g>
        )}
      </svg>
      {h && (
        <div className="chart__tip" style={{ left: `${Math.min(78, Math.max(8, tipLeft))}%` }}>
          <b>
            {MESES_CURTO[h.mes]}/{h.ano}
          </b>{" "}
          {fmt(h.valor)} m³
        </div>
      )}
    </div>
  );
}
