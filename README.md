# teste-geoserver

Monorepo (pnpm workspaces) com:

| Pasta            | O que é                                                    |
|------------------|------------------------------------------------------------|
| `apps/web`       | Front React + Vite + TypeScript + OpenLayers               |
| `apps/geoserver` | GeoServer 2.27 (imagem oficial OSGeo) via Docker           |
| `apps/db`        | PostgreSQL 16 + PostGIS + pgRouting + http, e pgAdmin      |
| `apps/api`       | API FastAPI: inventário de ativos, clientes, consumo, arquivos, válvulas |

## Requisitos
- Node 22+ e pnpm
- Docker + Docker Compose

## Como rodar

```bash
pnpm install
cp .env.example .env      # credenciais/porta do GeoServer
pnpm infra:up             # Postgres, pgAdmin e GeoServer
pnpm dev                  # sobe o front em http://localhost:5173
```

Ou tudo de uma vez: `pnpm start`.

- Admin do GeoServer: http://localhost:8080/geoserver/web (admin / geoserver, por padrão)
- O front é um visualizador no estilo do QGIS (OpenLayers). Veja [Front](#front) abaixo.
- Em dev, o Vite faz proxy de `/geoserver` → `GEOSERVER_URL` (padrão `http://localhost:8080`), então não há problema de CORS.

## Front
`apps/web` (React + Vite + OpenLayers) lê as camadas pelo WMS `GetCapabilities`:

- **Painel de camadas**: árvore com um grupo por schema, checkbox em grupos e camadas (desligar o grupo preserva
  as marcações dos filhos), ícone de legenda (`GetLegendGraphic`), camadas vazias em itálico, busca e filtro "só ativas".
- **Ordem de desenho**: a camada mais acima na lista fica por cima no mapa. Reordene arrastando camadas (dentro do grupo)
  e grupos.
- **Botão direito**: zoom para camada/grupo, opacidade, mostrar só esta, mover para topo/fim, ativar/desativar o grupo.
  Duplo clique numa camada = zoom para ela.
- **Ferramentas**: navegar (`P`), identificar (`I`, GetFeatureInfo em todas as camadas ativas, com destaque),
  zoom, extensão total e mapa base (OSM, Carto, satélite Esri, nenhum).
- **Barra de status**: coordenadas em EPSG:31983 ou lat/lon, escala editável (digite e Enter) e camadas renderizando.
- O estado da árvore (ativas, ordem, opacidade, grupos abertos) fica salvo no navegador (localStorage).

## Inventário (como no sistema original)
**Clique num ativo no mapa (modo Navegar)** para abrir a ficha no painel lateral — mesmo roteamento do original:

| Camada clicada | Ficha |
|---|---|
| Ligações | Clientes do lote (IPTU) → ficha do cliente com abas **Cliente** (≈35 campos + alerta de hidrômetro duplicado), **Consumo** (gráfico mês a mês), **Histórico** (mês × ano) e **Arquivos**; botão **Imprimir** (A4 paisagem / salvar em PDF) |
| Cruzamentos | Nº / setor + **documentos** (croquis) |
| Conexões, redes de água e esgoto, poços/caixas de esgoto, peças e rede de drenagem | Atributos do ativo, com códigos traduzidos pelos domínios |
| Válvulas | Atributos + **edição da posição** (dispara os triggers de trace da rede) |

Se houver vários itens no ponto, aparece a lista para escolher. Prioridade do clique: pontos > linhas > polígonos;
no mesmo tipo, a camada de cima (o original preferia a de baixo, e a rede "roubava" o clique de poços e bocas de lobo).

- **Selecionar ligações por área** (botão na barra): desenhe um polígono → lista de todos os clientes das ligações na área.
- **Documentos**: listar, abrir, anexar PDF e excluir. Os 7.125 registros antigos apontam para PDFs do servidor de
  produção (`/src/app/tmp/...`); copie esses PDFs para `apps/api/storage/` para que abram aqui (a API procura pelo nome).
- **Inventário de ativos (resumo)** (botão na barra): totais por área de água, esgoto e drenagem —
  [apps/db/sql/inventario.sql](apps/db/sql/inventario.sql) (`inventario.itens` define o que entra; aplique com `pnpm db:inventario`).
- **Tabelas auxiliares (domínios)**: os códigos viram descrição pelas FKs (tabelas `*_a*` com `descricao` ou `nome`) e,
  nas colunas sem FK, por `DOMINIOS_EXTRA` em [apps/api/app/routers/ativos.py](apps/api/app/routers/ativos.py)
  (ex.: `bacia` → `esgoto.ses_sub_bacia.fid`, `setor_abastecimento` → `agua.saa_setorabastecimento.fid`, `estado` → `drenagem.sdu_aestado`).
  No resumo, cada agrupamento aceita `"chave"` quando o código não está em `id`. Código sem par no domínio aparece cru
  (ficha) ou como "Código N" (resumo).
- O endereço da página guarda a posição do mapa (`#map=zoom/lat/lon`), útil para compartilhar.

### Busca, dicas e relatórios
- **Busca** (barra superior): cliente por código, nome, endereço, IPTU, CPF/CNPJ ou nº do hidrômetro; logradouro;
  DMC/VRP, setor e bacias. Cliente → zoom na ligação do lote e ficha aberta; rua/área → zoom na extensão.
  Texto comparado sem acento (índice trigram em `relatorios.norm`).
- **Dica ao passar o mouse** (zoom ≥ 18, modo navegar): cursor de mão sobre o que abre ficha e resumo de 2–3 campos
  (ligação: número, clientes e IPTU; poço: tipo e cotas; rede: diâmetro e material…). Campos por camada em
  [apps/web/src/map/hover.ts](apps/web/src/map/hover.ts).
- **Relatórios** (botão de gráfico na barra): os 28 do original + 3 de qualidade do cadastro — clientes (customizado, por categoria de uso,
  faixa de consumo, ramo de atividade, tarifa, poço artesiano, hidrômetro, hidrômetros duplicados, ligações e
  economias), extensão de rede de água/esgoto/drenagem (por tipo, diâmetro, material, material × diâmetro e por
  diâmetro × material × idade), relatório customizado de rede, quantificação de peças e volume de esgoto lançado
  estimado. Priorização: município, DMC/VRP, setor, bacia de esgotamento, bacia de drenagem ou área desenhada.
  Tabela com ordenação, filtro, total, escolha de colunas, **CSV** e **impressão**; nas listas, clicar na linha
  abre a ficha no mapa. Definições em [apps/api/app/routers/relatorios.py](apps/api/app/routers/relatorios.py).
  - Diferenças do original: extensão de rede = **comprimento desenhado**, igual ao inventário de ativos (o original
    usava a extensão informada no cadastro, que diverge do desenho em centenas de trechos — ex.: 0,3 m desenhados
    com 2.018 m informados). Os relatórios **"Trechos com extensão divergente"** (água, esgoto, drenagem) listam
    esses casos para correção; o relatório customizado de rede mostra as duas medidas.
    Consumo = **últimos 12 meses** faturados (o original somava todo o histórico);
    contagens sem duplicação; rede sem data de implantação aparece como "Não informado" (o original somava em "> 20 anos").
  - O consumo de 12 meses vem da materialized view `relatorios.consumo_cliente`
    ([apps/db/sql/relatorios.sql](apps/db/sql/relatorios.sql), `pnpm db:relatorios`). Depois de importar faturamento,
    atualize com `POST /api/relatorios/consumo/atualizar`.
- **Seleção por área**: botão **CSV** exporta a lista de clientes (ou só os filtrados).

### API (`apps/api`)
FastAPI + psycopg, acessada pelo front em `/api` (proxy do Vite e do nginx). Documentação interativa em
http://localhost:3000/docs. Rotas: `/ligacoes/{fid}/clientes`, `/ligacoes/clientes-na-area`, `/clientes/{id}`,
`/clientes/{codigo}/consumo-mensal`, `/arquivos` (GET/POST/DELETE, `/{id}/download`), `/ativos/{camada}/{fid}`,
`/valvulas/{fid}/posicao`, `/inventario/resumo`, `/busca?q=`, `/relatorios` (catálogo), `/relatorios/escopos`,
`POST /relatorios/{id}`. As consultas reproduzem as do `geomonitora_api` original.

### Login
Usuário e senha próprios (o original usava um serviço de login externo). Senhas com scrypt; sessão de 12 h
(renovada com o uso) em cookie HttpOnly — `Secure` no HTTPS. Sem sessão, a API responde 401 em tudo (exceto
`/health` e `/docs`) e o front mostra a tela de login. No front de produção (8443) o nginx também bloqueia o
GeoServer (`auth_request`, verificação em cache por 30 s). Código: [apps/api/app/auth.py](apps/api/app/auth.py).

**Usuários do sistema original**: quem tem cadastro no `monitora-login-api` (tabela `sso.sso_users` do dump)
entra com o mesmo usuário **ou e-mail** e a mesma senha (bcrypt); só contas com status `ativo`. As tabelas `sso.*`
são apenas lidas: inativar alguém lá derruba as sessões aqui. Para bloquear só neste sistema:
`pnpm usuarios desativar <usuario>` (depois do primeiro login da pessoa). O nível (`level_id`) é guardado, mas
ainda não restringe nada.

Também dá para criar usuários **locais** (só deste sistema; têm prioridade sobre um homônimo do original).
A senha é pedida sem aparecer na tela:

```bash
pnpm usuarios criar maria --nome "Maria Souza"   # --gerar-senha cria uma aleatória
pnpm usuarios senha maria                         # troca a senha e encerra as sessões
pnpm usuarios desativar maria                     # bloqueia e encerra as sessões (ativar reverte)
pnpm usuarios listar
```

Limites: todos os usuários têm o mesmo acesso (ver clientes, anexar/excluir documentos, alterar válvulas);
não há tela para gerenciar usuários nem para trocar a própria senha. No modo desenvolvimento (5173) o proxy do
Vite não protege o GeoServer, e as portas 8080 (GeoServer), 3000 (API) e 5432 (Postgres) seguem abertas no
host — para uso real, publique só a 8443.

## Desempenho
| Onde | O que foi feito |
|---|---|
| Front | Camadas WMS consecutivas do mesmo grupo vão numa só requisição (`LAYERS=a,b,c`); tiles de 512 px em PNG 8 bits; até 96 tiles simultâneos (padrão do OpenLayers: 16). |
| Front | Escala mínima por camada (`MIN_ZOOM` em [layers.ts](apps/web/src/config/layers.ts)); fora da escala a camada fica acinzentada e não é requisitada. |
| Cache | Camadas estáticas (`CACHED_LAYERS`) servidas por WMTS do GeoWebCache, pré-geradas do zoom 10 ao 18. |
| Banco | Índices espaciais que faltavam + `ANALYZE` ([30-performance.sh](apps/db/init/30-performance.sh), roda após o restore). |
| GeoServer | JVM com 2 GB (`GEOSERVER_JAVA_OPTS`). |
| Produção | nginx com HTTP/2 ([apps/web/docker](apps/web/docker)): todos os tiles numa só conexão. |

### Cache de tiles (camadas estáticas)
```bash
pnpm geoserver:cache seed --wait            # pré-gera z10–z18 de todas as CACHED_LAYERS (~1 min)
pnpm geoserver:cache truncate               # limpa tudo (quando os dados mudarem)
pnpm geoserver:cache truncate cartografia.cart_lotes   # limpa uma camada
pnpm geoserver:cache status
```
Atenção: alterou dados de uma camada em cache? Rode `truncate` nela, senão o mapa mostra a versão antiga.

### Front de produção (HTTP/2)
```bash
docker compose up -d --build web    # https://localhost:8443
```
Usa um certificado autoassinado (o navegador pede confirmação na primeira vez). Para um certificado real,
monte `server.crt`/`server.key` no volume `webcerts` (`/etc/nginx/certs`).

## Banco (PostGIS) e pgAdmin
- Postgres: `localhost:5432` (postgres / postgres)
- pgAdmin: http://localhost:5050 — o servidor "PostGIS (docker)" já vem cadastrado (senha: `postgres`).

### Restaurando dumps
Coloque os arquivos em `apps/db/dumps/` (ignorados pelo git). Na **primeira** subida do
container, cada `<nome>.dump` / `.backup` / `.sql` vira um banco `<nome>`, por exemplo
`geomonitora.dump` → banco `geomonitora`. São aceitos SQL texto e formato custom (`pg_dump -Fc`).
A role `docker` (dona dos objetos do dump) é criada automaticamente.

A restauração só roda com o volume vazio. Para restaurar de novo, apague o volume
`teste-geoserver_pgdata` (por exemplo, com `docker compose down -v`, que **apaga o banco**) e suba outra vez.

### Publicando o banco no GeoServer
```bash
docker exec postgis psql -U postgres -d geomonitora -c "ANALYZE;"   # após um restore
pnpm geoserver:publish            # cria o que falta (idempotente)
pnpm geoserver:publish --recalc   # também recalcula os bboxes
```
O script [publish_postgis.py](apps/geoserver/scripts/publish_postgis.py) cria o workspace
`geomonitora`, um store PostGIS por schema (o schema `tiger` fica de fora) e publica cada tabela com geometria como
`geomonitora:<schema>_<tabela>`. Tabelas com SRID 0 ou incomum recebem `EPSG:31983`.

Hoje não publicam: `agua.flow_trace_network`, `agua.vw_trace_flow_main` e `agua.__apagar`, porque dependem
de tabelas temporárias criadas em tempo de execução pelo sistema original.

### Estilos do GeoServer antigo
```bash
pnpm geoserver:styles                                   # lê ~/.workdir/geoserver/geoserver_data
pnpm geoserver:styles --old-data-dir /caminho/data_dir  # outro local
pnpm geoserver:cache truncate && pnpm geoserver:cache seed --wait   # refaz o cache depois
```
O script [import_styles.py](apps/geoserver/scripts/import_styles.py) lê o data_dir antigo, acha cada camada aqui
pelo schema do datastore + tabela de origem, envia os SLDs para o workspace `geomonitora` (estilos de workspace
ganham prefixo: `drenagem:boca_de_lobo` → `drenagem_boca_de_lobo`) e define o estilo padrão de cada camada.
Os ícones SVG vão para `workspaces/geomonitora/styles/svg/` e as referências `file:///opt/geoserver_data/svg/...`
dos SLDs viram `svg/...`: o GeoServer 2.27 só carrega gráficos de dentro da pasta de estilos.

No front, camadas com várias regras de estilo mostram a legenda em árvore (como no QGIS).

## Dados do GeoServer
O `data_dir` do GeoServer fica em `apps/geoserver/data_dir` (ignorado pelo git).
Os dados de demonstração estão desligados (`SKIP_DEMO_DATA: "true"`) e já foram removidos do data_dir.

## Scripts (raiz)
| Script              | Ação                         |
|---------------------|------------------------------|
| `pnpm dev`          | Front em modo dev            |
| `pnpm build`        | Build de todos os pacotes    |
| `pnpm infra:up`     | Sobe Postgres, pgAdmin e GeoServer |
| `pnpm db:up`        | Sobe só Postgres e pgAdmin   |
| `pnpm db:logs`      | Logs do Postgres             |
| `pnpm db:inventario` | (Re)aplica o SQL do inventário |
| `pnpm db:relatorios` | (Re)aplica o SQL de apoio aos relatórios e à busca |
| `pnpm api:logs`     | Logs da API                  |
| `pnpm usuarios …`   | Cria/lista/desativa usuários do login |
| `pnpm geoserver:up` | Sobe o GeoServer             |
| `pnpm geoserver:cache` | Seed/limpeza do cache de tiles |
| `pnpm geoserver:styles` | Importa estilos do GeoServer antigo |
| `pnpm geoserver:down` | Derruba os containers      |
| `pnpm geoserver:logs` | Logs do GeoServer          |
