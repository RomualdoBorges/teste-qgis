import { useEffect, useRef, useState } from "react";
import { buscar, type ResultadoBusca } from "../api";
import Icon from "./Icon";

const GRUPOS: Record<ResultadoBusca["tipo"], string> = { cliente: "Clientes", logradouro: "Logradouros", area: "Áreas" };

/**
 * Busca do mapa: cliente (código, nome, endereço, IPTU, CPF/CNPJ, hidrômetro), logradouro ou área (DMC, setor, bacia).
 * ↑/↓ escolhe, Enter abre, Esc fecha.
 */
export default function SearchBox({ onPick }: { onPick: (r: ResultadoBusca) => void }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<ResultadoBusca[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aberto, setAberto] = useState(false);
  const [sel, setSel] = useState(0);
  const caixa = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = q.trim();
    if (t.length < 2) {
      setRes(null);
      setErro(null);
      return;
    }
    const ctrl = new AbortController();
    const h = setTimeout(() => {
      buscar(t, ctrl.signal)
        .then((r) => (setRes(r), setErro(null), setSel(0)))
        .catch((e) => e.name !== "AbortError" && setErro(e.message));
    }, 250);
    return () => (clearTimeout(h), ctrl.abort());
  }, [q]);

  // fecha ao clicar fora
  useEffect(() => {
    const f = (e: MouseEvent) => !caixa.current?.contains(e.target as Node) && setAberto(false);
    document.addEventListener("mousedown", f);
    return () => document.removeEventListener("mousedown", f);
  }, []);

  const escolher = (r: ResultadoBusca) => {
    onPick(r);
    setAberto(false);
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") return setAberto(false);
    if (!res?.length) return;
    if (e.key === "ArrowDown") (e.preventDefault(), setSel((s) => Math.min(res.length - 1, s + 1)), setAberto(true));
    if (e.key === "ArrowUp") (e.preventDefault(), setSel((s) => Math.max(0, s - 1)));
    if (e.key === "Enter") escolher(res[sel]);
  };

  let ultimoGrupo = "";
  return (
    <div className="search" ref={caixa}>
      <Icon name="search" size={15} />
      <input
        type="search"
        placeholder="Buscar cliente, endereço, IPTU, hidrômetro, rua, DMC…"
        aria-label="Buscar no mapa"
        role="combobox"
        aria-expanded={aberto && !!res}
        aria-controls="search-results"
        value={q}
        onChange={(e) => (setQ(e.target.value), setAberto(true))}
        onFocus={() => setAberto(true)}
        onKeyDown={onKey}
      />
      {aberto && q.trim().length >= 2 && (
        <div className="search__results" id="search-results" role="listbox">
          {erro && <p className="error-text">{erro}</p>}
          {!erro && !res && <p className="muted">Buscando…</p>}
          {res && !res.length && <p className="muted">Nada encontrado para “{q.trim()}”.</p>}
          {res?.map((r, i) => {
            const grupo = GRUPOS[r.tipo];
            const cab = grupo !== ultimoGrupo ? ((ultimoGrupo = grupo), <h4 key={`g-${grupo}`}>{grupo}</h4>) : null;
            return [
              cab,
              <button
                key={`${r.tipo}-${i}`}
                type="button"
                role="option"
                aria-selected={i === sel}
                className={`search__item ${i === sel ? "search__item--sel" : ""}`}
                onMouseEnter={() => setSel(i)}
                onClick={() => escolher(r)}
              >
                <span className="search__title">{r.titulo || "(sem nome)"}</span>
                <span className="search__detail">
                  {r.detalhe}
                  {r.tipo === "cliente" && !r.ponto && " · sem ligação no mapa"}
                </span>
              </button>,
            ];
          })}
        </div>
      )}
    </div>
  );
}
