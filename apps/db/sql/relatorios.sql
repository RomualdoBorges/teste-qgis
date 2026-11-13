-- =====================================================================
-- Apoio aos relatórios (apps/api/app/routers/relatorios.py)
--
-- relatorios.consumo_cliente: consumo faturado por cliente nos 12 meses que terminam no último mês
-- faturado da base (comercial.com_consumo_faturado tem ~3,4 milhões de linhas; agregar a cada relatório
-- custaria segundos). Atualize depois de importar faturamento:
--   REFRESH MATERIALIZED VIEW CONCURRENTLY relatorios.consumo_cliente;
-- (ou POST /api/relatorios/consumo/atualizar)
-- Idempotente.
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS relatorios;

CREATE MATERIALIZED VIEW IF NOT EXISTS relatorios.consumo_cliente AS
WITH ref AS (
  SELECT max(ano_at * 100 + mes_at) AS ultimo FROM comercial.com_consumo_faturado
), lim AS (
  -- 12 meses: do mês seguinte ao mesmo mês do ano anterior até o último faturado
  SELECT ultimo,
         ((ultimo / 100 - 1) * 100 + ultimo % 100) AS inicio_excl
    FROM ref
), cf AS (
  SELECT c.codigo_dae, c.ano_at * 100 + c.mes_at AS am, c.consumo
    FROM comercial.com_consumo_faturado c, lim
   WHERE c.ano_at * 100 + c.mes_at > lim.inicio_excl AND c.ano_at * 100 + c.mes_at <= lim.ultimo
     AND c.consumo IS NOT NULL
)
SELECT codigo_dae,
       sum(consumo)::bigint                              AS consumo_12m,
       count(DISTINCT am)                                AS meses_12m,
       round(sum(consumo)::numeric / count(DISTINCT am), 1) AS media_mensal,
       max(am)                                           AS ultimo_mes,
       sum(consumo) FILTER (WHERE am = (SELECT ultimo FROM lim))::bigint AS consumo_ultimo_mes
  FROM cf
 GROUP BY codigo_dae;

CREATE UNIQUE INDEX IF NOT EXISTS consumo_cliente_pk ON relatorios.consumo_cliente (codigo_dae);

-- período de referência (para o cabeçalho dos relatórios)
CREATE OR REPLACE VIEW relatorios.periodo_consumo AS
SELECT max(ano_at * 100 + mes_at) AS ultimo_mes FROM comercial.com_consumo_faturado;

-- busca textual (pg_trgm + unaccent já instalados no banco)
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS unaccent;
-- texto normalizado (minúsculas, sem acento) das partes informadas, separadas por espaço.
-- unaccent e concat_ws são STABLE; o wrapper IMMUTABLE (sem inlining, por causa do SET) é o padrão para indexar.
CREATE OR REPLACE FUNCTION relatorios.norm(VARIADIC partes text[]) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE SET search_path = public
  AS $$ SELECT lower(public.unaccent('public.unaccent'::regdictionary, array_to_string(partes, ' '))) $$;
CREATE INDEX IF NOT EXISTS com_clientes_busca_trgm ON comercial.com_clientes
  USING gin (relatorios.norm(nome, endereco_rua, endereco_numero, endereco_bairro) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS com_hidrometros_cliente ON comercial.com_hidrometros (cliente_id);
CREATE INDEX IF NOT EXISTS com_hidrometros_codigo_up ON comercial.com_hidrometros (upper(codigo_hidrometro));

-- volume lançado estimado: filtra o faturamento por mês (ano*100+mês)
CREATE INDEX IF NOT EXISTS com_consumo_faturado_anomes ON comercial.com_consumo_faturado ((ano_at * 100 + mes_at));
ANALYZE comercial.com_consumo_faturado;
