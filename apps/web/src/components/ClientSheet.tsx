import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fmtDate, getCliente, getConsumoMensal, type Cliente, type ConsumoAno } from "../api";
import ConsumptionChart, { MESES, MESES_CURTO } from "./ConsumptionChart";
import FilesTab from "./FilesTab";
import Icon from "./Icon";

type Tab = "cliente" | "consumo" | "historico" | "arquivos";
const TABS: { id: Tab; label: string }[] = [
  { id: "cliente", label: "Cliente" },
  { id: "consumo", label: "Consumo" },
  { id: "historico", label: "Histórico" },
  { id: "arquivos", label: "Arquivos" },
];

const s = (v: unknown) => (v === null || v === undefined || v === "" ? null : String(v));
const sn = (v: unknown) => (v ? "Sim" : "Não");

/** Mesmos campos da ficha do original (mapResponseToClientData), com as descrições no lugar dos ids. */
export function camposCliente(c: Cliente): { rotulo: string; valor: string | null }[] {
  return [
    { rotulo: "Cód. Cliente", valor: s(c.codigo_cliente) },
    { rotulo: "Nome", valor: s(c.nome) },
    { rotulo: "Endereço", valor: [c.endereco_rua, c.endereco_numero].filter(Boolean).join(", ") || null },
    { rotulo: "Complemento", valor: s(c.endereco_complemento) },
    { rotulo: "Bairro", valor: s(c.endereco_bairro) },
    { rotulo: "Inscrição IPTU", valor: s(c.inscricao_iptu) },
    { rotulo: "Telefone", valor: s(c.telefone) },
    { rotulo: "CNPJ / CPF", valor: s(c.cnpj) ?? s(c.cpf) },
    { rotulo: "Categoria de Uso", valor: s(c.categoria_uso_descricao) },
    { rotulo: "Classificação Tarifária", valor: s(c.classificacao_tarifaria_descricao) },
    { rotulo: "Tipo de Ligação", valor: s(c.tipo_ligacao_descricao) },
    { rotulo: "Status da Ligação", valor: s(c.status_ligacao_descricao) },
    { rotulo: "Data Ligação", valor: fmtDate(c.data_ligacao) },
    { rotulo: "Quantidade Economias", valor: s(c.qtde_economias) },
    { rotulo: "Grupo de Leitura", valor: s(c.grupo_leitura_descricao) },
    { rotulo: "Código de Lançamento", valor: s(c.codigo_lancamento) },
    { rotulo: "Data da Última Leitura", valor: fmtDate(c.data_ultima_leitura) },
    { rotulo: "Cód. Hidrômetro", valor: s(c.codigo_hidrometro) },
    { rotulo: "Marca / Modelo", valor: [c.marca_hidrometro, c.modelo_hidrometro].filter(Boolean).join(" / ") || null },
    { rotulo: "Classe do Hidrômetro", valor: s(c.classe_hidrometro) },
    { rotulo: "Data Instalação Hidrômetro", valor: fmtDate(c.hidrometro_data_instalacao) },
    { rotulo: "Hidrômetro Novo (< 1 ano)", valor: sn(c.hidrometro_novo) },
    { rotulo: "Vazão", valor: s(c.vazao_hidrometro) },
    { rotulo: "Diâmetro", valor: s(c.hidrometro_diametro) },
    { rotulo: "Cavalete", valor: s(c.cavalete) },
    { rotulo: "Abrigo", valor: s(c.abrigo) },
    { rotulo: "Tipo de Caixa", valor: s(c.tipo_caixa_id) },
    { rotulo: "Poço Artesiano", valor: sn(c.poco_artesiano) },
    { rotulo: "Cód. VRP", valor: [c.codigo_vrp, c.vrp].filter(Boolean).join(" | ") || null },
    { rotulo: "Reservatório", valor: s(c.reservatorio) },
    { rotulo: "Data de Criação", valor: fmtDate(c.data_criacao) },
    { rotulo: "Data de Atualização", valor: fmtDate(c.data_atualizacao) },
    { rotulo: "ID do Bairro", valor: s(c.cart_bairro_id) },
    { rotulo: "ID do Logradouro", valor: s(c.cart_logr_id) },
  ];
}

export default function ClientSheet({ clienteId, fidLigacao }: { clienteId: number; fidLigacao?: number | null }) {
  const [tab, setTab] = useState<Tab>("cliente");
  const [c, setC] = useState<Cliente | null>(null);
  const [consumo, setConsumo] = useState<ConsumoAno[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  const [expandido, setExpandido] = useState(false);

  useEffect(() => {
    let alive = true;
    setC(null);
    setConsumo(null);
    setErro(null);
    getCliente(clienteId)
      .then((cli) => {
        if (!alive) return;
        setC(cli);
        return getConsumoMensal(cli.codigo_cliente).then((d) => alive && setConsumo(d));
      })
      .catch((e) => alive && setErro(e.message));
    return () => {
      alive = false;
    };
  }, [clienteId]);

  // impressão: monta a folha, chama o diálogo do navegador e desmonta depois
  useEffect(() => {
    if (!printing) return;
    const done = () => setPrinting(false);
    window.addEventListener("afterprint", done, { once: true });
    const t = setTimeout(() => window.print(), 50);
    return () => {
      clearTimeout(t);
      window.removeEventListener("afterprint", done);
    };
  }, [printing]);

  if (erro) return <p className="error-text">{erro}</p>;
  if (!c) return <p className="muted">Carregando cliente…</p>;
  const ligacao = fidLigacao ?? c.fid_ligacao;

  return (
    <div className="client">
      <div className="client__head">
        <div>
          <div className="client__code">{c.codigo_cliente}</div>
          <div className="muted">{s(c.nome) ?? "Nome não informado"}</div>
        </div>
        <span className="client__actions">
          <button type="button" className="btn" onClick={() => setExpandido(true)} title="Abrir a ficha completa numa janela grande">
            <Icon name="expandView" size={14} /> Expandir
          </button>
          <button type="button" className="btn" onClick={() => setPrinting(true)} title="Imprimir ou salvar em PDF">
            <Icon name="print" size={14} /> Imprimir
          </button>
        </span>
      </div>

      {c.flag_erro_duplicado !== null && c.flag_erro_duplicado !== undefined && (
        <div className="alert alert--warn" role="alert">
          Este cliente possui um hidrômetro duplicado com o cliente de código <b>{s(c.erro_cliente_duplicado)}</b>.
          <br />
          Código do hidrômetro duplicado: <b>{s(c.hidrometro_duplicado)}</b>.
        </div>
      )}

      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={tab === t.id ? "is-on" : ""} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "cliente" && <FieldTable campos={camposCliente(c)} />}
      {tab === "consumo" && (consumo ? <Consumo dados={consumo} /> : <p className="muted">Carregando consumo…</p>)}
      {tab === "historico" && (consumo ? <Historico dados={consumo} /> : <p className="muted">Carregando consumo…</p>)}
      {tab === "arquivos" &&
        (ligacao ? <FilesTab vinculo={{ ligacao }} /> : <p className="muted">Cliente sem ligação geográfica associada.</p>)}

      {expandido &&
        createPortal(
          <ClientModal c={c} consumo={consumo} ligacao={ligacao ?? null} onPrint={() => setPrinting(true)} onClose={() => setExpandido(false)} />,
          document.body,
        )}
      {printing && createPortal(<PrintSheet c={c} consumo={consumo ?? []} />, document.body)}
    </div>
  );
}

export function FieldTable({ campos }: { campos: { rotulo: string; valor: string | number | null }[] }) {
  return (
    <table className="attr-table">
      <tbody>
        {campos.map((f) => (
          <tr key={f.rotulo}>
            <th scope="row">{f.rotulo}</th>
            <td>{f.valor ?? "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Ficha completa numa janela grande: dados em colunas, consumo, histórico e arquivos na mesma tela. */
function ClientModal(p: { c: Cliente; consumo: ConsumoAno[] | null; ligacao: number | null; onPrint: () => void; onClose: () => void }) {
  const fechar = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const antes = document.activeElement as HTMLElement | null;
    fechar.current?.focus();
    const esc = (e: KeyboardEvent) => e.key === "Escape" && p.onClose();
    window.addEventListener("keydown", esc);
    return () => (window.removeEventListener("keydown", esc), antes?.focus());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const { c, consumo } = p;

  return (
    <div className="modal" onMouseDown={(e) => e.target === e.currentTarget && p.onClose()}>
      <section className="modal__box client-modal" role="dialog" aria-modal="true" aria-labelledby="client-modal-title">
        <header className="modal__head">
          <div>
            <h2 id="client-modal-title">
              {c.codigo_cliente} <span className="muted">· {s(c.nome) ?? "Nome não informado"}</span>
            </h2>
            <div className="muted small">
              {[c.endereco_rua, c.endereco_numero].filter(Boolean).join(", ")}
              {s(c.endereco_bairro) && ` · ${s(c.endereco_bairro)}`}
              {p.ligacao != null && ` · Ligação #${p.ligacao}`}
            </div>
          </div>
          <span className="client__actions">
            <button type="button" className="btn" onClick={p.onPrint}>
              <Icon name="print" size={14} /> Imprimir
            </button>
            <button ref={fechar} type="button" className="icon-btn" title="Fechar (Esc)" onClick={p.onClose}>
              <Icon name="close" size={18} />
            </button>
          </span>
        </header>

        <div className="modal__body">
          {c.flag_erro_duplicado !== null && c.flag_erro_duplicado !== undefined && (
            <div className="alert alert--warn" role="alert">
              Este cliente possui um hidrômetro duplicado com o cliente de código <b>{s(c.erro_cliente_duplicado)}</b>. Código do
              hidrômetro duplicado: <b>{s(c.hidrometro_duplicado)}</b>.
            </div>
          )}

          <h3 className="client-modal__h">Dados do cliente</h3>
          <dl className="field-grid">
            {camposCliente(c).map((f) => (
              <div key={f.rotulo}>
                <dt>{f.rotulo}</dt>
                <dd>{f.valor ?? "—"}</dd>
              </div>
            ))}
          </dl>

          <div className="client-modal__cols">
            <section>
              <h3 className="client-modal__h">Consumo</h3>
              {consumo ? <Consumo dados={consumo} largo /> : <p className="muted">Carregando consumo…</p>}
            </section>
            <section>
              <h3 className="client-modal__h">Histórico (m³)</h3>
              {consumo ? <Historico dados={consumo} /> : <p className="muted">Carregando consumo…</p>}
            </section>
          </div>

          <h3 className="client-modal__h">Arquivos da ligação</h3>
          {p.ligacao ? <FilesTab vinculo={{ ligacao: p.ligacao }} /> : <p className="muted">Cliente sem ligação geográfica associada.</p>}
        </div>
      </section>
    </div>
  );
}

function Consumo({ dados, largo }: { dados: ConsumoAno[]; largo?: boolean }) {
  const ultimos = dados.flatMap((a) => MESES.map((m) => Number(a[m] ?? 0)));
  let fim = ultimos.length;
  while (fim > 0 && ultimos[fim - 1] === 0) fim--;
  const janela = ultimos.slice(Math.max(0, fim - 12), fim);
  const media = janela.length ? janela.reduce((a, b) => a + b, 0) / janela.length : 0;
  return (
    <div>
      <div className="stats">
        <div>
          <span className="muted">Último mês faturado</span>
          <b>{fim ? `${ultimos[fim - 1].toLocaleString("pt-BR")} m³` : "—"}</b>
        </div>
        <div>
          <span className="muted">Média dos últimos 12 meses</span>
          <b>{media.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} m³</b>
        </div>
      </div>
      <h4 className="chart__title">Consumo faturado mensal (m³)</h4>
      {largo ? <ConsumptionChart dados={dados} width={640} height={260} /> : <ConsumptionChart dados={dados} />}
    </div>
  );
}

export function Historico({ dados }: { dados: ConsumoAno[] }) {
  if (!dados.length) return <p className="muted">Sem consumo faturado registrado.</p>;
  const anos = dados.slice().sort((a, b) => b.ano_at - a.ano_at);
  return (
    <div className="hist">
      <table className="attr-table hist__table">
        <thead>
          <tr>
            <th scope="col">Mês</th>
            {anos.map((a) => (
              <th key={a.ano_at} scope="col" className="num">
                {a.ano_at}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {MESES.map((m, i) => (
            <tr key={m}>
              <th scope="row">{MESES_CURTO[i]}</th>
              {anos.map((a) => (
                <td key={a.ano_at} className="num">
                  {Number(a[m] ?? 0).toLocaleString("pt-BR")}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Folha de impressão (A4 paisagem): ficha do cliente + gráfico + histórico. */
function PrintSheet({ c, consumo }: { c: Cliente; consumo: ConsumoAno[] }) {
  return (
    <div className="print-root">
      <header className="print-root__head">
        <div>
          <h1>Inventário do cliente</h1>
          <div>
            Cód. Cliente <b>{c.codigo_cliente}</b> · {s(c.nome) ?? ""}
          </div>
        </div>
        <div className="muted">Emitido em {new Date().toLocaleString("pt-BR")}</div>
      </header>
      <div className="print-root__grid">
        {camposCliente(c).map((f) => (
          <div key={f.rotulo}>
            <span>{f.rotulo}</span>
            <b>{f.valor ?? "—"}</b>
          </div>
        ))}
      </div>
      <div className="print-root__charts">
        <section>
          <h2>Consumo faturado mensal (m³)</h2>
          <ConsumptionChart dados={consumo} width={520} height={220} />
        </section>
        <section>
          <h2>Histórico</h2>
          <Historico dados={consumo} />
        </section>
      </div>
    </div>
  );
}
