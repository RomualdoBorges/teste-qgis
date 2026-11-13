import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import Icon from "./components/Icon";

/** Login simples (apps/api/app/auth.py): sessão em cookie HttpOnly; o front só sabe quem está logado. */
export interface Usuario {
  usuario: string;
  nome: string;
  admin: boolean;
}

const EXPIROU = "geomonitora:sessao-expirada";

/** Chamar com toda resposta da API/GeoServer: 401 = sessão acabou → volta para a tela de login. */
export function avisarSessao(res: Response) {
  if (res.status === 401) window.dispatchEvent(new Event(EXPIROU));
  return res;
}

const Ctx = createContext<{ usuario: Usuario; sair: () => void } | null>(null);
export const useAuth = () => useContext(Ctx)!;

export function AuthGate({ children }: { children: ReactNode }) {
  const [usuario, setUsuario] = useState<Usuario | null | undefined>(undefined);
  const [aviso, setAviso] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/eu")
      .then((r) => (r.ok ? r.json() : null))
      .then(setUsuario)
      .catch(() => setUsuario(null));
    const expirou = () =>
      setUsuario((u) => {
        if (u) setAviso("Sua sessão expirou. Entre novamente.");
        return null;
      });
    window.addEventListener(EXPIROU, expirou);
    return () => window.removeEventListener(EXPIROU, expirou);
  }, []);

  const sair = useCallback(async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    setAviso(null);
    setUsuario(null);
  }, []);

  if (usuario === undefined) return null;
  if (!usuario) return <Login aviso={aviso} onEntrar={(u) => (setAviso(null), setUsuario(u))} />;
  return <Ctx.Provider value={{ usuario, sair }}>{children}</Ctx.Provider>;
}

function Login({ aviso, onEntrar }: { aviso: string | null; onEntrar: (u: Usuario) => void }) {
  const [usuario, setUsuario] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const entrar = async (e: React.FormEvent) => {
    e.preventDefault();
    setEnviando(true);
    setErro(null);
    try {
      const r = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usuario, senha }),
      });
      const body = await r.json().catch(() => null);
      if (!r.ok) throw new Error(typeof body?.detail === "string" ? body.detail : `Erro ${r.status}`);
      onEntrar(body);
    } catch (e) {
      setErro((e as Error).message === "Failed to fetch" ? "Servidor indisponível. Tente de novo." : (e as Error).message);
      setSenha("");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <main className="login">
      <form className="login__card" onSubmit={entrar}>
        <div className="login__brand">
          <Icon name="layers" size={22} /> geomonitora
        </div>
        {aviso && <p className="login__aviso">{aviso}</p>}
        <label>
          Usuário
          <input autoFocus autoComplete="username" value={usuario} onChange={(e) => setUsuario(e.target.value)} required />
        </label>
        <label>
          Senha
          <input type="password" autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} required />
        </label>
        {erro && (
          <p className="error-text" role="alert">
            {erro}
          </p>
        )}
        <button type="submit" className="btn btn--primary" disabled={enviando || !usuario || !senha}>
          {enviando ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </main>
  );
}
