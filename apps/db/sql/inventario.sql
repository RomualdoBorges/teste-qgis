-- =====================================================================
-- Inventário de ativos (água, esgoto, drenagem)
--
-- inventario.itens      → o que é inventariado (1 linha por ativo; editável)
-- inventario.resumo()   → calcula o inventário do município inteiro ou de uma área
--
-- Exposto pela API (apps/api): POST /api/inventario/resumo  {"area": <GeoJSON EPSG:4326> | null}
-- Idempotente: pode ser executado de novo (recria função e itens).
-- =====================================================================

CREATE SCHEMA IF NOT EXISTS inventario;

-- ---------------------------------------------------------------------
-- Configuração dos itens
--   tabela  : tabela-base (geometria em "geometria", EPSG:31983)
--   linear  : true = soma extensão (m); false = conta unidades
--   grupos  : agrupamentos [{"rotulo","coluna","dominio","chave","ordem"}]
--             dominio = tabela auxiliar; o rótulo vem de "descricao" (ou "nome"/"valor")
--             chave   = coluna do domínio com o código (padrão "id"; ex.: "fid" em ses_sub_bacia)
--             ordem   = "numerica" | "quantidade"
--   filtro  : condição SQL opcional (ex.: "situacao_rede = 1")
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventario.itens (
  id       serial PRIMARY KEY,
  sistema  text NOT NULL,
  ordem    int  NOT NULL,
  ativo    text NOT NULL,
  tabela   regclass NOT NULL,
  linear   boolean NOT NULL DEFAULT false,
  grupos   jsonb NOT NULL DEFAULT '[]',
  filtro   text,
  camada   text  -- camada WMS correspondente (para o front destacar/ligar)
);

TRUNCATE inventario.itens RESTART IDENTITY;

INSERT INTO inventario.itens (sistema, ordem, ativo, tabela, linear, grupos, camada) VALUES
-- ÁGUA --------------------------------------------------------------
('Água', 10, 'Rede de água', 'agua.saa_rede', true, '[
   {"rotulo":"Diâmetro","coluna":"diametro","dominio":"agua.saa_adiametro","ordem":"numerica"},
   {"rotulo":"Material","coluna":"material","dominio":"agua.saa_amaterial"},
   {"rotulo":"Tipo de rede","coluna":"tipo_rede","dominio":"agua.saa_atipo_rede"},
   {"rotulo":"Situação","coluna":"situacao_rede","dominio":"agua.saa_asituacao_rede"},
   {"rotulo":"Posição","coluna":"posicao_rede","dominio":"agua.saa_aposicao_rede"},
   {"rotulo":"Classe de pressão","coluna":"classe_pressao","dominio":"agua.saa_aclasse_pressao"},
   {"rotulo":"DMC / VRP","coluna":"dmc_vrp","dominio":"agua.saa_setorabastecimento","chave":"fid"}]', 'geomonitora:agua_vw_geoserver_front_rede_agua'),
('Água', 20, 'Ramais de ligação', 'agua.saa_ramaldeligacao', true, '[]', NULL),
('Água', 30, 'Ligações', 'agua.saa_ligacoes', false, '[
   {"rotulo":"DMC / VRP","coluna":"dmc_vrp","dominio":"agua.saa_setorabastecimento","chave":"fid"}]', 'geomonitora:agua_geoserver_ligacoes_quant_client'),
('Água', 40, 'Válvulas', 'agua.saa_valvula', false, '[
   {"rotulo":"Tipo","coluna":"tipo_valvula","dominio":"agua.saa_atipo_valvula"},
   {"rotulo":"Posição","coluna":"posicao_valvula","dominio":"agua.saa_aposicao_valvula"},
   {"rotulo":"Diâmetro","coluna":"diametro","dominio":"agua.saa_adiametro","ordem":"numerica"},
   {"rotulo":"Função","coluna":"funcao_valvula","dominio":"agua.saa_afuncao_valvula"},
   {"rotulo":"DMC / VRP","coluna":"setor_abastecimento","dominio":"agua.saa_setorabastecimento","chave":"fid"}]', 'geomonitora:agua_saa_valvula'),
('Água', 50, 'Conexões', 'agua.saa_conexoes', false, '[
   {"rotulo":"Tipo de peça","coluna":"tipo_peca","dominio":"agua.saa_atipo_peca_conexoes"},
   {"rotulo":"Diâmetro","coluna":"diametro1","dominio":"agua.saa_adiametro","ordem":"numerica"}]', 'geomonitora:agua_saa_conexoes'),
('Água', 60, 'Hidrantes', 'agua.saa_hidrante', false, '[
   {"rotulo":"Tipo","coluna":"tipo_hidrante","dominio":"agua.saa_atipo_hidrante"}]', NULL),
('Água', 70, 'Ventosas', 'agua.saa_ventosa', false, '[
   {"rotulo":"Tipo","coluna":"tipo_ventosa","dominio":"agua.saa_atipo_ventosa"}]', NULL),
('Água', 80, 'Macromedidores', 'agua.saa_macromedidor', false, '[
   {"rotulo":"Tipo","coluna":"tipo_medidor","dominio":"agua.saa_atipo_medidor_macro"}]', NULL),
('Água', 90, 'Reservatórios', 'agua.saa_reservatorio', false, '[
   {"rotulo":"Tipo","coluna":"tipo_reservatorio","dominio":"agua.saa_atipo_reservatorio"}]', NULL),
-- ESGOTO ------------------------------------------------------------
('Esgoto', 10, 'Rede de esgoto', 'esgoto.ses_rede', true, '[
   {"rotulo":"Diâmetro","coluna":"diametro","dominio":"esgoto.ses_adiametro","ordem":"numerica"},
   {"rotulo":"Material","coluna":"material","dominio":"esgoto.ses_amaterial"},
   {"rotulo":"Tipo de rede","coluna":"tipo_rede","dominio":"esgoto.ses_atipo_rede"},
   {"rotulo":"Situação","coluna":"situacao_rede","dominio":"esgoto.ses_asituacao_rede"},
   {"rotulo":"Posição","coluna":"posicao_rede","dominio":"esgoto.ses_aposicao_rede"},
   {"rotulo":"Sub-bacia","coluna":"bacia_m","dominio":"esgoto.ses_sub_bacia","chave":"fid"}]', 'geomonitora:esgoto_ses_geoserver_rede'),
('Esgoto', 20, 'Ramais de ligação', 'esgoto.ses_ramaldeligacao', true, '[]', NULL),
('Esgoto', 30, 'Poços', 'esgoto.ses_poco', false, '[
   {"rotulo":"Tipo","coluna":"tipo_poco","dominio":"esgoto.ses_atipo_poco"},
   {"rotulo":"Sub-bacia","coluna":"bacia","dominio":"esgoto.ses_sub_bacia","chave":"fid"}]', 'geomonitora:esgoto_ses_geoserver_poco'),
('Esgoto', 40, 'Caixas de passagem', 'esgoto.ses_caixa_passagem', false, '[
   {"rotulo":"Sub-bacia","coluna":"bacia","dominio":"esgoto.ses_sub_bacia","chave":"fid"}]', 'geomonitora:esgoto_ses_geoserver_caixa_passagem'),
('Esgoto', 50, 'Pontas secas', 'esgoto.ses_rede_ponta_seca', false, '[]', 'geomonitora:esgoto_ses_view_ponta_seca'),
('Esgoto', 60, 'Estações elevatórias', 'esgoto.ses_eee', false, '[
   {"rotulo":"Tipo","coluna":"tipo_eee","dominio":"esgoto.ses_atipo_eee"}]', 'geomonitora:esgoto_ses_geoserver_eee'),
-- DRENAGEM ----------------------------------------------------------
('Drenagem', 10, 'Rede de drenagem', 'drenagem.sdu_rede_drenagem', true, '[
   {"rotulo":"Diâmetro","coluna":"diametro","dominio":"drenagem.sdu_adiametro","ordem":"numerica"},
   {"rotulo":"Material","coluna":"material","dominio":"drenagem.sdu_amaterial_rede"},
   {"rotulo":"Tipo de rede","coluna":"tipo_rede","dominio":"drenagem.sdu_atipo_rede"},
   {"rotulo":"Seção","coluna":"secao","dominio":"drenagem.sdu_asecao"},
   {"rotulo":"Posição","coluna":"posicao_rede","dominio":"drenagem.sdu_aposicao"}]', 'geomonitora:drenagem_sdu_geoserver_rede'),
('Drenagem', 20, 'Galerias pré-moldadas', 'drenagem.sdu_galeria_pre_moldada', true, '[
   {"rotulo":"Material","coluna":"material","dominio":"drenagem.sdu_amaterial_rede"}]', NULL),
('Drenagem', 30, 'Sarjetões', 'drenagem.sdu_sarjetao', true, '[
   {"rotulo":"Material","coluna":"material","dominio":"drenagem.sdu_amaterial"}]', 'geomonitora:drenagem_sdu_geoserver_sarjetao'),
('Drenagem', 40, 'Bocas de lobo', 'drenagem.sdu_boca_lobo', false, '[
   {"rotulo":"Tipo","coluna":"tipo","dominio":"drenagem.sdu_atipo_bocalobo"},
   {"rotulo":"Encaixe","coluna":"tipo_encaixe","dominio":"drenagem.sdu_atipo_encaixe"},
   {"rotulo":"Estado","coluna":"estado","dominio":"drenagem.sdu_aestado"}]', 'geomonitora:drenagem_sdu_geoserver_boca_lobo'),
('Drenagem', 50, 'Bocas de leão', 'drenagem.sdu_boca_leao', false, '[
   {"rotulo":"Tipo","coluna":"tipo","dominio":"drenagem.sdu_atipo_bocaleao"}]', 'geomonitora:drenagem_sdu_geoserver_boca_leao'),
('Drenagem', 60, 'Poços de visita', 'drenagem.sdu_poco_visita', false, '[
   {"rotulo":"Estrutura","coluna":"tp_estrut","dominio":"drenagem.sdu_atipo_estrutura"},
   {"rotulo":"Tampa","coluna":"tipo_tampa","dominio":"drenagem.sdu_atipo_tampa"},
   {"rotulo":"Estado","coluna":"estado","dominio":"drenagem.sdu_aestado"}]', 'geomonitora:drenagem_sdu_geoserver_poco_visita'),
('Drenagem', 70, 'Caixas', 'drenagem.sdu_caixa', false, '[]', 'geomonitora:drenagem_sdu_geoserver_caixa'),
('Drenagem', 80, 'Caixas coletoras c/ grelha', 'drenagem.sdu_caixa_coletora_grelha', false, '[
   {"rotulo":"Encaixe","coluna":"tipo_encaixe","dominio":"drenagem.sdu_atipo_encaixe"}]', NULL),
('Drenagem', 90, 'Lançamentos', 'drenagem.sdu_lancamento', false, '[
   {"rotulo":"Estado","coluna":"estado","dominio":"drenagem.sdu_aestado"}]', 'geomonitora:drenagem_sdu_lancamento_fluxo'),
('Drenagem', 100, 'Válvulas flap', 'drenagem.sdu_valvula_flap', false, '[
   {"rotulo":"Diâmetro","coluna":"diametro","dominio":"drenagem.sdu_adiametro","ordem":"numerica"},
   {"rotulo":"Implantação","coluna":"implantacao","dominio":"drenagem.sdu_aimplantacao"}]', 'geomonitora:drenagem_sdu_geoserver_valvula_flap');

-- ---------------------------------------------------------------------
-- Cálculo de um item: total + cada agrupamento
-- area NULL = município inteiro. Redes são cortadas na borda da área (ST_Intersection).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION inventario._item(it inventario.itens, area geometry)
RETURNS jsonb LANGUAGE plpgsql STABLE AS $$
DECLARE
  medida text := CASE WHEN it.linear
                   THEN CASE WHEN area IS NULL THEN 'ST_Length(t.geometria)'
                             ELSE 'ST_Length(ST_Intersection(t.geometria, $1))' END
                   ELSE 'NULL::float8' END;
  onde   text := concat_ws(' AND ', 't.geometria IS NOT NULL',
                   CASE WHEN area IS NOT NULL THEN 't.geometria && $1 AND ST_Intersects(t.geometria, $1)' END,
                   nullif(it.filtro, ''));
  total  jsonb;
  grupos jsonb := '[]';
  g      jsonb;
  linhas jsonb;
BEGIN
  EXECUTE format('SELECT jsonb_build_object(''quantidade'', count(*), ''extensao_m'', round(sum(%s)::numeric, 1))
                    FROM %s t WHERE %s', medida, it.tabela, onde)
    INTO total USING area;

  FOR g IN SELECT * FROM jsonb_array_elements(it.grupos) LOOP
    EXECUTE format($q$
      SELECT coalesce(jsonb_agg(jsonb_build_object('rotulo', rotulo, 'quantidade', qtd, 'extensao_m', ext)
                               ORDER BY %s), '[]')
      FROM (
        SELECT coalesce(d.rotulo, CASE WHEN t.%2$I IS NULL THEN 'Não informado' ELSE 'Código ' || t.%2$I END) AS rotulo,
               min(nullif(regexp_replace(coalesce(d.rotulo, ''), '[^0-9.]', '', 'g'), '')::numeric) AS num,
               count(*) AS qtd,
               round(sum(%3$s)::numeric, 1) AS ext
          FROM %4$s t
          LEFT JOIN (SELECT to_jsonb(x)->>%7$L AS chave,
                            coalesce(nullif(btrim(to_jsonb(x)->>'descricao'), ''), nullif(btrim(to_jsonb(x)->>'nome'), ''),
                                     nullif(btrim(to_jsonb(x)->>'valor'), '')) AS rotulo
                       FROM %5$s x) d ON d.chave = t.%2$I::text
         WHERE %6$s
         GROUP BY 1
      ) s$q$,
      CASE WHEN g->>'ordem' = 'numerica' THEN 'num NULLS LAST, rotulo' ELSE 'coalesce(ext, qtd) DESC, rotulo' END,
      g->>'coluna', medida, it.tabela, (g->>'dominio')::regclass, onde, coalesce(g->>'chave', 'id'))
      INTO linhas USING area;
    grupos := grupos || jsonb_build_object('rotulo', g->>'rotulo', 'linhas', linhas);
  END LOOP;

  RETURN jsonb_build_object(
    'id', it.id, 'ativo', it.ativo, 'linear', it.linear, 'camada', it.camada,
    'quantidade', total->'quantidade', 'extensao_m', total->'extensao_m', 'grupos', grupos);
END $$;

-- ---------------------------------------------------------------------
-- API: inventário do município (area = null) ou de uma área em GeoJSON (EPSG:4326)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION inventario.resumo(area json DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE
SET search_path = public, pg_temp AS $$
DECLARE
  geom geometry;
  out  jsonb := '[]';
  s    text;
BEGIN
  IF area IS NOT NULL AND area::text <> 'null' THEN
    geom := ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(area::text), 4326), 31983);
    IF NOT ST_IsValid(geom) THEN geom := ST_MakeValid(geom); END IF;
    IF ST_Area(geom) > 5e9 THEN RAISE EXCEPTION 'Área muito grande para o inventário (%.0f km²)', ST_Area(geom) / 1e6; END IF;
  END IF;

  FOR s IN SELECT sistema FROM inventario.itens GROUP BY sistema ORDER BY min(id) LOOP
    out := out || jsonb_build_object('sistema', s, 'itens',
      (SELECT jsonb_agg(inventario._item(i, geom) ORDER BY i.ordem) FROM inventario.itens i WHERE i.sistema = s));
  END LOOP;

  RETURN jsonb_build_object(
    'area_m2', CASE WHEN geom IS NULL THEN NULL ELSE round(ST_Area(geom)::numeric) END,
    'gerado_em', now(),
    'sistemas', out);
END $$;

COMMENT ON FUNCTION inventario.resumo(json) IS
  'Inventário de ativos de água, esgoto e drenagem. area: GeoJSON (EPSG:4326) ou null para o município.';

-- _item() é interna: chamada só por resumo()
REVOKE ALL ON FUNCTION inventario._item(inventario.itens, geometry) FROM PUBLIC;
