/**
 * Camadas exibidas no painel.
 *
 * - Lista vazia  → mostra todas as camadas publicadas no GeoServer.
 * - Com itens    → mostra apenas as camadas listadas.
 *
 * Cada item pode ser escrito de qualquer uma destas formas:
 *   "agua.saa_ramaldeligacao"               (schema.tabela — como aparece no painel)
 *   "geomonitora:agua_saa_ramaldeligacao"   (nome WMS completo)
 *   "agua_saa_ramaldeligacao"               (nome WMS sem o workspace)
 *
 * Maiúsculas/minúsculas e espaços nas pontas são ignorados.
 * Itens que não existirem no GeoServer geram um aviso no console do navegador.
 *
 * Lista extraída da configuração do sistema original (cópia em layers.original.txt).
 * Os comentários indicam o título original e, quando o nome mudou, o nome antigo.
 */
export const VISIBLE_LAYERS: string[] = [
  // ---- Cartografia ----
  "cartografia.cart_logradouros", //       Logradouros            (original: cartografia:logradouros)
  "cartografia.cart_lotes", //             Lotes                  (original: cartografia:lotes)
  "cartografia.cart_quadras", //           Quadras                (original: cartografia:quadras)
  "cartografia.cart_edificacoes", //       Edificações
  "cartografia.cart_curvanivel", //        Curva de Nível         (original: cartografia:curva_de_nivel)
  "cartografia.geoserver_cruzamentos", //  Cruzamentos
  "cartografia.cart_quadra_centroid", //   Centroide da Quadra
  "cartografia.cart_intercesao_vias", //   Intercesão Vias

  // ---- Drenagem ----
  "drenagem.sdu_lim_bacias_drenagem", //         Bacias
  "drenagem.sdu_lim_sub_bacia_drenagem", //      Sub Bacia
  "drenagem.sdu_geoserver_rede", //              Rede de Drenagem
  "drenagem.sdu_rede_drenagem_fluxo", //         Rede de Drenagem - Fluxo
  "drenagem.sdu_geoserver_boca_leao", //         Boca de Leão
  "drenagem.sdu_geoserver_boca_lobo", //         Boca de Lobo
  "drenagem.sdu_geoserver_caixa", //             Caixa
  "drenagem.sdu_geoserver_caixa_acoplada_pv", // Caixa Acoplada
  "drenagem.sdu_geoserver_poco_visita", //       Poço de Visita
  "drenagem.sdu_geoserver_sarjetao", //          Sarjetão
  "drenagem.sdu_geoserver_valvula_flap", //      Válvula Flap
  "drenagem.sdu_lancamento_fluxo", //            Lançamento

  // ---- Setores ----
  "agua.vw_geoserver_front_setor_reservatorios", // Setor de Abastecimento  (original: agua:setor_reservatorio)
  "agua.saa_setorreservatorios", //                 Zonas de Abastecimento
  "agua.saa_setorabastecimento", //                 Distrito de medição e controle (original: agua:setor_dmc)
  "cartografia.cart_bairros", //                    Bairros

  // ---- Esgoto ----
  "esgoto.ses_sub_bacia", //                  Bacia de Esgotamento
  "esgoto.ses_geoserver_rede", //             Rede de Esgoto
  "esgoto.ses_rede_fluxo", //                 Fluxo de Rede
  "esgoto.ses_geoserver_caixa_passagem", //   Caixa de Passagem
  "esgoto.ses_geoserver_poco", //             Poço
  "esgoto.ses_view_ponta_seca", //            Ponta Seca  (original: esgoto:ses_geoserver_ponta_seca → tabela ses_view_ponta_seca)
  "esgoto.ses_geoserver_caixa_ligacao", //    Caixa de Ligação
  "esgoto.ses_geoserver_eee", //              Estação Elevatória de Esgoto

  // ---- Temáticos ----
  "comercial.vw_geoserver_erro_hidrometros_duplicados", //     Hidrômetros Duplicados
  "comercial.tematicos_cliente_grupo_proprio_municipais", //   Próprios Municipais
  "comercial.tematicos_cliente_grupo_grandes_consumidores", // Grandes Consumidores
  "comercial.tematicos_cliente_grupo_pocos", //                Clientes c/ Poço Artesiano
  // "agua:tematicos_tipo_de_cavalete",                        ULMC — não existe no banco nem no GeoServer antigo
  "comercial.tematicos_hidrometro_class", //                   Classe de Hidrômetro
  "agua.vw_consumo_medio", //                    Faixa de Consumo     (original: agua:consumo_medio)
  "agua.vw_geoserver_media_idade_hidrometros", // Idade Hidrômetro     (original: agua:hidrometros_idade_media)
  "comercial.vw_ligacoes_categorias_uso", //     Categoria de Uso

  // ---- Água / Comercial ----
  "agua.geoserver_ligacoes_quant_client", // Ligações*      (original: agua:ligacoes_custom)
  "agua.vw_geoserver_front_rede_agua", //   Redes de Água* (original: agua:redes_agua)
  "agua.saa_conexoes", // Conexões         (original: agua:conexoes)
  "agua.saa_valvula", //  Válvulas*        (original: agua:valvulas)
];

/**
 * Zoom mínimo para exibir a camada (abaixo disso ela não é desenhada nem requisitada).
 * Valores do sistema original (minZoom: 19.5 ≈ escala 1:730 nesta latitude).
 * Mesmos formatos de nome aceitos em VISIBLE_LAYERS.
 */
export const MIN_ZOOM: Record<string, number> = {
  "drenagem.sdu_rede_drenagem_fluxo": 19.5,
  "drenagem.sdu_geoserver_boca_leao": 19.5,
  "drenagem.sdu_geoserver_boca_lobo": 19.5,
  "drenagem.sdu_geoserver_caixa": 19.5,
  "drenagem.sdu_geoserver_caixa_acoplada_pv": 19.5,
  "drenagem.sdu_geoserver_poco_visita": 19.5,
  "drenagem.sdu_geoserver_sarjetao": 19.5,
  "drenagem.sdu_geoserver_valvula_flap": 19.5,
  "drenagem.sdu_lancamento_fluxo": 19.5,
  "esgoto.ses_rede_fluxo": 19.5,
  "esgoto.ses_geoserver_caixa_passagem": 19.5,
  "esgoto.ses_geoserver_poco": 19.5,
  "esgoto.ses_view_ponta_seca": 19.5,
  "esgoto.ses_geoserver_caixa_ligacao": 19.5,
  "esgoto.ses_geoserver_eee": 19.5,
};

/**
 * Camadas estáticas (mudam raramente) servidas por WMTS a partir do cache do GeoWebCache.
 * São muito mais rápidas, mas o cache precisa ser limpo quando os dados mudarem:
 *   pnpm geoserver:cache truncate <camada>   (ou "all")
 * As demais camadas são renderizadas na hora via WMS, agrupadas em poucas requisições.
 */
export const CACHED_LAYERS: string[] = [
  "cartografia.cart_logradouros",
  "cartografia.cart_lotes",
  "cartografia.cart_quadras",
  "cartografia.cart_edificacoes",
  "cartografia.cart_curvanivel",
  "cartografia.geoserver_cruzamentos",
  "cartografia.cart_quadra_centroid",
  "cartografia.cart_intercesao_vias",
  "cartografia.cart_bairros",
  "drenagem.sdu_lim_bacias_drenagem",
  "drenagem.sdu_lim_sub_bacia_drenagem",
  "esgoto.ses_sub_bacia",
  "agua.saa_setorreservatorios",
  "agua.vw_geoserver_front_setor_reservatorios",
  "agua.saa_setorabastecimento",
];

/**
 * Nomes amigáveis exibidos no painel, no menu e no identificar (títulos do sistema original).
 * Camadas sem nome aqui aparecem com o nome da tabela. Mesmos formatos de chave de VISIBLE_LAYERS.
 */
export const LAYER_NAMES: Record<string, string> = {
  // Cartografia
  "cartografia.cart_logradouros": "Logradouros",
  "cartografia.cart_lotes": "Lotes",
  "cartografia.cart_quadras": "Quadras",
  "cartografia.cart_edificacoes": "Edificações",
  "cartografia.cart_curvanivel": "Curva de Nível",
  "cartografia.geoserver_cruzamentos": "Cruzamentos",
  "cartografia.cart_quadra_centroid": "Centroide da Quadra",
  "cartografia.cart_intercesao_vias": "Interseção de Vias",
  "cartografia.cart_bairros": "Bairros",
  // Drenagem
  "drenagem.sdu_lim_bacias_drenagem": "Bacias",
  "drenagem.sdu_lim_sub_bacia_drenagem": "Sub Bacia",
  "drenagem.sdu_geoserver_rede": "Rede de Drenagem",
  "drenagem.sdu_rede_drenagem_fluxo": "Rede de Drenagem - Fluxo",
  "drenagem.sdu_geoserver_boca_leao": "Boca de Leão",
  "drenagem.sdu_geoserver_boca_lobo": "Boca de Lobo",
  "drenagem.sdu_geoserver_caixa": "Caixa",
  "drenagem.sdu_geoserver_caixa_acoplada_pv": "Caixa Acoplada",
  "drenagem.sdu_geoserver_poco_visita": "Poço de Visita",
  "drenagem.sdu_geoserver_sarjetao": "Sarjetão",
  "drenagem.sdu_geoserver_valvula_flap": "Válvula Flap",
  "drenagem.sdu_lancamento_fluxo": "Lançamento",
  // Setores
  "agua.vw_geoserver_front_setor_reservatorios": "Setor de Abastecimento",
  "agua.saa_setorabastecimento": "Distrito de Medição e Controle",
  "agua.saa_setorreservatorios": "Zonas de Abastecimento",
  // Esgoto
  "esgoto.ses_sub_bacia": "Bacia de Esgotamento",
  "esgoto.ses_geoserver_rede": "Rede de Esgoto",
  "esgoto.ses_rede_fluxo": "Fluxo de Rede",
  "esgoto.ses_geoserver_caixa_passagem": "Caixa de Passagem",
  "esgoto.ses_geoserver_poco": "Poço",
  "esgoto.ses_view_ponta_seca": "Ponta Seca",
  "esgoto.ses_geoserver_caixa_ligacao": "Caixa de Ligação",
  "esgoto.ses_geoserver_eee": "Estação Elevatória de Esgoto",
  // Temáticos
  "comercial.vw_geoserver_erro_hidrometros_duplicados": "Hidrômetros Duplicados",
  "comercial.tematicos_cliente_grupo_proprio_municipais": "Próprios Municipais",
  "comercial.tematicos_cliente_grupo_grandes_consumidores": "Grandes Consumidores",
  "comercial.tematicos_cliente_grupo_pocos": "Clientes c/ Poço Artesiano",
  "comercial.tematicos_hidrometro_class": "Classe de Hidrômetro",
  "agua.vw_consumo_medio": "Faixa de Consumo",
  "agua.vw_geoserver_media_idade_hidrometros": "Idade do Hidrômetro",
  "comercial.vw_ligacoes_categorias_uso": "Categoria de Uso",
  // Água
  "agua.geoserver_ligacoes_quant_client": "Ligações",
  "agua.vw_geoserver_front_rede_agua": "Redes de Água",
  "agua.saa_conexoes": "Conexões",
  "agua.saa_valvula": "Válvulas",
};

/** Nomes amigáveis dos grupos (schemas do banco). */
export const GROUP_NAMES: Record<string, string> = {
  agua: "Água",
  cartografia: "Cartografia",
  comercial: "Comercial",
  drenagem: "Drenagem",
  esgoto: "Esgoto",
  apontamentos: "Apontamentos",
  epanet: "EPANET",
  infraestrutura: "Infraestrutura",
  interferencias: "Interferências",
  layouts: "Layouts",
  manobra: "Manobra",
  mtd: "MTD",
  public: "Público",
  sad: "SAD",
};

/**
 * Camadas que já começam ligadas ao abrir o mapa (as demais da lista começam desligadas).
 * Valores do sistema original (visible: true). Lista vazia = todas as de VISIBLE_LAYERS começam ligadas.
 * Depois da primeira visita, vale o que o usuário deixou ligado (salvo no navegador).
 */
export const START_ACTIVE: string[] = [
  "cartografia.cart_logradouros", // Logradouros
  "cartografia.cart_lotes", // Lotes
  "cartografia.cart_quadras", // Quadras
  "cartografia.cart_edificacoes", // Edificações
  "cartografia.geoserver_cruzamentos", // Cruzamentos
  "cartografia.cart_quadra_centroid", // Centroide da Quadra
  "drenagem.sdu_geoserver_rede", // Rede de Drenagem
  "drenagem.sdu_rede_drenagem_fluxo", // Rede de Drenagem - Fluxo
  "drenagem.sdu_geoserver_boca_leao", // Boca de Leão
  "drenagem.sdu_geoserver_boca_lobo", // Boca de Lobo
  "drenagem.sdu_geoserver_caixa", // Caixa
  "drenagem.sdu_geoserver_caixa_acoplada_pv", // Caixa Acoplada
  "drenagem.sdu_geoserver_poco_visita", // Poço de Visita
  "drenagem.sdu_geoserver_sarjetao", // Sarjetão
  "drenagem.sdu_geoserver_valvula_flap", // Válvula Flap
  "drenagem.sdu_lancamento_fluxo", // Lançamento
  "esgoto.ses_geoserver_rede", // Rede de Esgoto
  "esgoto.ses_rede_fluxo", // Fluxo de Rede
  "esgoto.ses_geoserver_caixa_passagem", // Caixa de Passagem
  "esgoto.ses_geoserver_poco", // Poço
  "esgoto.ses_view_ponta_seca", // Ponta Seca
  "esgoto.ses_geoserver_caixa_ligacao", // Caixa de Ligação
  "esgoto.ses_geoserver_eee", // Estação Elevatória de Esgoto
  "agua.geoserver_ligacoes_quant_client", // Ligações
  "agua.vw_geoserver_front_rede_agua", // Redes de Água
  "agua.saa_conexoes", // Conexões
  "agua.saa_valvula", // Válvulas
  "cartografia.cart_intercesao_vias", // Interseção de Vias
];
