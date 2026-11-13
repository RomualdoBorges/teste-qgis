import { useCallback, useEffect, useRef, useState } from "react";

const CHAVE = "geomonitora.larguraPainel";
export const LARGURA_PADRAO = 440;
const MIN = 320;
const max = () => Math.max(MIN, Math.min(900, Math.round(window.innerWidth * 0.7)));
const limitar = (w: number) => Math.round(Math.min(max(), Math.max(MIN, w)));

/** Largura do painel lateral direito (ficha, inventário, identificar), guardada no navegador. */
export function useLarguraPainel() {
  const [largura, setLargura] = useState(() => {
    try {
      const v = Number(localStorage.getItem(CHAVE));
      return v ? limitar(v) : LARGURA_PADRAO;
    } catch {
      return LARGURA_PADRAO;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(CHAVE, String(largura));
    } catch {
      /* armazenamento indisponível: só não lembra */
    }
  }, [largura]);
  // janela menor: não deixa o painel passar do limite
  useEffect(() => {
    const f = () => setLargura((w) => limitar(w));
    window.addEventListener("resize", f);
    return () => window.removeEventListener("resize", f);
  }, []);
  return [largura, (w: number) => setLargura(limitar(w))] as const;
}

/** Alça vertical entre o mapa e o painel: arraste para mudar a largura; duplo clique volta ao padrão; setas ajustam. */
export default function PanelResizer({ largura, onChange }: { largura: number; onChange: (w: number) => void }) {
  const inicio = useRef<{ x: number; w: number } | null>(null);
  const [arrastando, setArrastando] = useState(false);

  const mover = useCallback(
    (e: PointerEvent) => inicio.current && onChange(inicio.current.w + (inicio.current.x - e.clientX)),
    [onChange],
  );
  const soltar = useCallback(() => {
    inicio.current = null;
    setArrastando(false);
    document.body.classList.remove("is-resizing");
  }, []);

  useEffect(() => {
    if (!arrastando) return;
    window.addEventListener("pointermove", mover);
    window.addEventListener("pointerup", soltar, { once: true });
    return () => {
      window.removeEventListener("pointermove", mover);
      window.removeEventListener("pointerup", soltar);
    };
  }, [arrastando, mover, soltar]);

  return (
    <div
      className={`panel-resizer ${arrastando ? "is-active" : ""}`}
      role="separator"
      aria-orientation="vertical"
      aria-label="Largura do painel"
      aria-valuenow={largura}
      aria-valuemin={MIN}
      aria-valuemax={max()}
      tabIndex={0}
      title="Arraste para mudar a largura do painel (duplo clique: tamanho padrão)"
      onPointerDown={(e) => {
        e.preventDefault();
        inicio.current = { x: e.clientX, w: largura };
        setArrastando(true);
        document.body.classList.add("is-resizing");
      }}
      onDoubleClick={() => onChange(LARGURA_PADRAO)}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft") onChange(largura + 20);
        if (e.key === "ArrowRight") onChange(largura - 20);
      }}
    />
  );
}
