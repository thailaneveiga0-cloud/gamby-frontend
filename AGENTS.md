# GAMBY Frontend - Mapa tecnico e regras permanentes

## Escopo deste documento

Este arquivo orienta toda manutencao deste frontend. Antes de alterar codigo, confirme o comportamento no modulo afetado e preserve os fluxos existentes. O mapa abaixo descreve o estado real da versao atual; itens marcados como requisitos permanentes podem ainda nao estar implementados.

## Stack e execucao

- Aplicacao estatica, sem framework de UI: HTML5, CSS3 e JavaScript nativo com ES Modules.
- Linguagem: JavaScript sem TypeScript.
- Entrada unica: `index.html`; bootstrap: `assets/js/app.js` via `<script type="module">`.
- Nao existe `package.json`, lockfile, gerenciador de pacotes, bundler ou ferramenta de build nesta versao.
- Nao ha dependencias externas importadas pelo HTML ou pelos modulos.
- Como os modulos e o catalogo padrao usam requisicoes HTTP, servir a raiz por um servidor HTTP estatico; abrir apenas por `file://` pode falhar. Nao ha comando oficial de preview.
- Nao existem scripts de test, lint, typecheck, build, preview ou deploy. O botao de autotestes em Configuracoes executa verificacoes funcionais no navegador e nao substitui uma suite automatizada.

## Estrutura

- `index.html`: todo o markup das telas publica e autenticada, modal de cadastro e paineis internos.
- `assets/css/base.css`: tokens, tema escuro, controles, paineis, modal e regras responsivas gerais.
- `assets/css/auth.css`: login, planos e cadastro.
- `assets/css/dashboard.css`: topbar, sidebar, grids, tabelas e responsividade da area interna.
- `assets/js/app.js`: composicao, inicializacao e binding dos modulos.
- `assets/js/state.js`: estado em memoria e valores padrao.
- `assets/js/storage.js`: chaves e wrapper JSON de `localStorage`.
- `assets/js/ui.js`: alternancia login/app, etapas do cadastro, navegacao e visibilidade por perfil.
- `assets/js/auth.js`: login, logout, sessao e cadastro em etapas.
- `assets/js/roles.js`: matriz RBAC.
- `assets/js/backend-config.js`, `http.js` e `backend-status.js`: configuracao persistida da API, cliente HTTP e healthcheck.
- `assets/js/services/`: adaptadores de auth, produtos, vendas, pagamentos, empresa, usuarios, caixa e financeiro.
- Modulos de dominio: `products.js`, `backup.js`, `pdv.js`, `cash-session.js`, `finance.js`, `history.js`, `reports.js`, `payments.js`, `user-management.js`, `marketplace.js` e `settings.js`.
- `assets/js/utils.js`: formatacao, conversoes e downloads no navegador.
- `assets/data/default-products.json`: catalogo inicial/restauracao local; nao usar como substituto definitivo do backend.
- `docs/backend-readiness.md`: notas historicas da preparacao para API; valide-as contra os services, que sao a fonte operacional atual.

## Telas, layouts e navegacao

Nao ha rotas URL nem roteador. `index.html` contem uma SPA de pagina unica e `ui.js` troca secoes por `data-page`/`data-page-content` e pela classe `hidden`.

- Area publica: login, apresentacao e planos; modal de cadastro com etapas Cadastro, Verificacao por e-mail, Plano e Pagamento.
- Shell autenticado: topbar, sidebar e area de conteudo. A pagina inicial apos autenticar e Dashboard.
- Modulos internos: Dashboard, Produtos, PDV/Caixa, Financeiro, Historico, Relatorios, Marketplace, Usuarios, Configuracoes e Painel Desenvolvedora.
- Dashboard: metricas de produtos, estoque, perfil, vendas, saldo e caixa; estoque baixo; sessao de caixa; configuracao do backend visivel apenas para desenvolvedora.
- Produtos: cadastro, exclusao, ajuste de estoque, restauracao do catalogo e backup JSON.
- PDV/Caixa: abertura/fechamento, carrinho, pagamento, troco, finalizacao e cancelamento de vendas.
- Financeiro/Historico: resumos e movimentos operacionais/financeiros.
- Relatorios: resumo diario, impressao em nova janela e exportacao `.doc` gerada por `Blob`.
- Marketplace: canais e simulacao local de pedidos com baixa de estoque; nao e integracao real com marketplaces.
- Usuarios: modulo proprio para criar/listar/excluir usuarios internos; deve permanecer separado de Configuracoes.
- Configuracoes: dados da empresa e autotestes de consistencia. Esta versao nao implementa subabas; ao evoluir, preserve toda subaba aprovada existente no codigo/produto.
- Painel Desenvolvedora: meios de pagamento, lembretes, debito automatico e codigos de dispositivos.

## Autenticacao, sessao e acesso

- A tela publica e `#authRoot`; a area protegida e `#appRoot`. A protecao atual e client-side por ocultacao/exibicao e restauracao da sessao.
- Com backend habilitado, login usa token e refresh token retornados pela API, guarda a sessao no `localStorage` e envia `Authorization: Bearer` nas requisicoes. Nao ha fluxo de refresh automatico nem interceptacao global de 401 nesta versao.
- Sem backend, ha cadastro e login locais, inclusive contas internas de demonstracao definidas no codigo. Trate quaisquer credenciais embutidas como dado sensivel: nao as replique em documentacao, logs ou respostas e nao amplie esse mecanismo para producao.
- A sessao so e restaurada quando corresponde a usuario local/interno ou contem token e empresa do backend. Logout remove a chave de sessao.
- Perfis: `desenvolvedora`, `administrador`, `gerente` e `operador`. `roles.js` define os limites locais do RBAC; permissoes fornecidas pelo backend devem restringir esses limites.
- Desenvolvedora possui acesso global e aos paineis de backend/pagamentos; administradora gerencia operacao, usuarios, marketplace e configuracoes, sem pagamentos da matriz; operador nao possui privilegios financeiros, backup, usuarios, marketplace ou configuracoes.
- `access-control.js` valida na ordem usuario, tenant, perfil, assinatura e permissoes. A assinatura pertence ao tenant; `trial`, `active` e `pending_payment` permitem acesso, enquanto `past_due`, `expired`, `cancelled`, `blocked` e `suspended` bloqueiam perfis de clientes.
- Desenvolvedora e um perfil de plataforma e possui bypass exclusivo de tenant/assinatura. `development-config.js` centraliza e persiste o modo de desenvolvimento e a simulacao de assinatura; nao crie outros bypasses ou condicionais dispersos.
- Operador possui somente a pagina PDV. Gerente respeita o teto local e as paginas/permissoes mais restritivas recebidas do backend.
- A interface aplica classes como `dev-only`, `admin-or-dev`, `financial-only`, `backup-only`, `product-manage-only`, `payments-only`, `marketplace-only` e `settings-only`. Algumas operacoes tambem chamam `can()`; ocultar DOM nunca substitui autorizacao no backend.
- Requisito permanente: operador deve ficar restrito ao PDV conforme permissoes fornecidas pelo backend. Ao integrar RBAC real, a resposta do backend e a autoridade; nao conceda acesso por defaults locais.
- Preserve isolamento por empresa. O tenant vem de `backend.tenantId`, `currentUser.companyId` ou `activeCompanyId` e e enviado no header configurado. Nunca permita que dados de uma empresa contaminem cache, estado ou chamadas de outra.

## Estado e armazenamento local

- `state.js` mantem estado mutavel compartilhado em memoria: usuario, backend, cobranca, empresa, marketplace, historico, produtos, vendas, carrinho, caixa, cadastro e usuarios internos.
- `storage.js` serializa JSON no `localStorage` e usa fallback quando a leitura falha. Nao ha Redux, Context, IndexedDB, cookies ou `sessionStorage`.
- Chaves persistidas por dominio: usuarios de autenticacao, sessao, produtos, vendas, sessao de caixa, pagamentos, usuarios internos, empresa, marketplace, historico e configuracao do backend.
- Tokens, dados cadastrais e configuracao de tenant atualmente podem residir no `localStorage`; considere o risco de XSS antes de expandir essa estrategia.
- Carrinho e parte do estado em memoria. Catalogo padrao vem de `assets/data/default-products.json` quando necessario.
- Varios services usam fallback local quando o backend esta desligado ou falha. Nao introduza novos fallbacks silenciosos para operacoes criticas e nao transforme dados simulados em solucao definitiva.

## Backend e cliente HTTP

- A configuracao da API e feita na propria interface, persistida no navegador; nao ha `.env` nem nomes de variaveis de ambiente no projeto atual.
- `httpRequest()` usa `fetch`, `AbortController`, timeout configuravel, JSON por padrao, `FormData` para importacao, Bearer token e header de tenant configuravel.
- Respostas JSON ou texto sao lidas conforme `content-type`; status nao-2xx geram `Error` com `payload.message` ou codigo HTTP. Timeout/erros de rede propagam. Nao existe camada global de toast, retry ou normalizacao de erros.
- Backend pronto significa `enabled` e base URL preenchida. A estrategia registrada pode ser `fallback-local`, `backend-preferred` ou `local-only`, mas a maior parte dos services decide apenas por `isBackendReady()`; nao presuma que o seletor implementa toda a semantica.
- Endpoints base configuraveis: `health`, `auth`, `products`, `sales`, `payments`, `companies`, `users`, `cashSessions`, `finance`, `reports`, `marketplace` e `developer`.
- Chamadas implementadas: auth `POST login`, `POST register`, `POST resend-verification`, `POST verify-email`; produtos `GET/POST`, `PUT/DELETE :id`, `GET export?format=...`, `POST import`; vendas `GET/POST`, `POST :id/cancel`; pagamentos `GET/PUT settings`, `POST methods`; empresa `GET/PUT me`; usuarios `GET/POST`, `DELETE :id`; caixa `GET current`, `POST open`, `POST :id/close`; financeiro `GET summary` e `GET entries`; healthcheck no endpoint `health`.
- Os endpoints de relatorios, marketplace e developer estao apenas configurados, sem chamadas de service nesta versao.
- Produtos, vendas, pagamentos e empresa possuem graus diferentes de fallback local. Auth com backend ativo nao faz fallback; usuarios e caixa retornam `null` sem backend. Analise cada service antes de mudar comportamento.
- Nunca altere URL, metodo, payload, resposta, headers, tenant ou semantica de erro sem analisar frontend e backend. Mantenha normalizadores de fronteira para separar o modelo da UI do contrato da API.

## UI, temas e responsividade

- Tema atual: escuro GAMBY Tech, definido por custom properties em `base.css`, com fundo escuro, superficies translucidas, acentos violeta/ciano e estados success/warning/danger.
- O tema claro ainda nao esta implementado. Ao implementa-lo, preserve o escuro como padrao e use no claro: fundo `#F8FAFC`, superficies `#FFFFFF`, bordas `#E5E7EB`, texto `#111827`, menus `#EFF6FF` e acoes `#2563EB`.
- Componentes visuais sao HTML/CSS locais: paineis, botoes, campos, tags/pills, notices, cards de plano/metrica, tabelas, modal, topbar e sidebar. Nao ha biblioteca de componentes ou icones.
- Breakpoints atuais: 900px e 980px. Grids viram uma coluna; layout interno remove a coluna lateral e coloca sidebar acima do conteudo; tabelas usam overflow horizontal.
- A sidebar atual e fixa em 260px no desktop e ainda nao recolhe. Requisito permanente: deve recolher, expandir por hover, permitir fixacao e liberar toda a largura do conteudo quando recolhida.
- Preserve acessibilidade, foco, labels, semantica, contraste, navegacao por teclado e responsividade. Modais devem controlar foco e fechamento de modo acessivel quando forem evoluidos.
- Operacoes importantes devem apresentar estados explicitos de carregamento, sucesso, erro e vazio. Hoje ha notices, alerts e estados vazios em tabelas, mas cobertura incompleta; nao remova os existentes.

## PDV, relatorios, impressao e atalhos

- O PDV valida caixa aberto, produto/estoque, quantidade, forma de pagamento e valor recebido; atualiza estoque, vendas, historico, financeiro e relatorios. Cancelamento exige permissao financeira e devolve estoque.
- Caixa registra abertura, fechamento, duracao e saldo; fechamento aciona impressao do relatorio diario. Reset e exclusivo da desenvolvedora.
- Relatorio diario e composto no navegador com dados locais, aberto em nova janela para `window.print()` e exportado como HTML com MIME Word. Nao ha PDF ou gerador de relatorios externo.
- Nao existem graficos ou biblioteca de charts; Dashboard e Financeiro usam metricas e tabelas.
- Atalho implementado: `Enter` no campo de senha executa login. Os demais controles dependem da navegacao nativa do navegador; nao ha mapa global de atalhos.
- Preserve ergonomia de teclado do PDV e nao capture atalhos do navegador sem justificativa e alternativa acessivel.

## Integracoes externas

- API GAMBY configuravel e unica integracao de rede implementada, alem da leitura do JSON estatico.
- Brevo/SMTP aparece apenas como dependencia futura textual para verificacao por e-mail; nao ha SDK ou chamada implementada.
- Marketplace e pagamentos sao estruturais/simulados localmente; nao ha gateway, adquirente ou canal externo real nesta versao.
- Nao ha analytics, mapas, CDN, fontes remotas ou servicos de deploy configurados.

## Validacao, Git e entrega

- Antes de mudancas grandes, crie checkpoint no Git e registre claramente o escopo. Nunca descarte alteracoes preexistentes nem arquivos nao rastreados.
- Antes de validar, leia `package.json` se ele passar a existir. Execute somente os scripts existentes de test, lint, typecheck e build; nao invente comandos e nao instale dependencias sem informar primeiro.
- Depois de alterar, execute todas as validacoes disponiveis proporcionais ao risco. Em mudancas desta versao estatica, tambem valide os fluxos no navegador por servidor HTTP quando possivel.
- Nao modifique codigo para mascarar falhas de validacao solicitadas apenas para diagnostico; relate comando, saida relevante e impacto.
- Nao publique, faca deploy, push, altere infraestrutura remota ou exponha artefatos sem autorizacao expressa.
- Estado observado na criacao deste arquivo: a pasta de trabalho estava vazia e foi restaurada a partir do arquivo irmao `gamby_modular_stage10.zip`; o pacote nao continha `.git`, `AGENTS.md` nem `package.json`. Portanto nao havia branch, historico, alteracoes rastreadas ou arquivos nao rastreados classificaveis pelo Git, e um commit local nao e possivel sem inicializar um repositorio.

## Regras permanentes de produto e seguranca

- Preserve todas as funcionalidades existentes e confirme fluxos dependentes antes de refatorar.
- Nao altere contratos do backend sem analisar e validar os dois lados.
- Nunca exponha senhas, tokens, chaves, segredos ou valores de `.env`; documente apenas nomes de variaveis.
- Nao use dados simulados como solucao definitiva.
- Preserve autenticacao, isolamento por empresa, RBAC e restricoes dos operadores em UI e backend.
- Mantenha o tema escuro GAMBY Tech como padrao e o tema claro corporativo conforme a paleta definida acima.
- Implemente e preserve o comportamento exigido da sidebar ao tocar no layout.
- Mantenha Usuarios separado de Configuracoes e preserve as subabas aprovadas de Configuracoes.
- Mantenha o operador restrito ao PDV segundo permissoes fornecidas pelo backend.
- Toda operacao importante deve ter carregamento, sucesso, erro e vazio.
- Preserve acessibilidade, navegacao por teclado e responsividade.
- Nao registre dados sensiveis no console, DOM, fixtures, screenshots, commits ou mensagens de erro.
- Trate conteudo inserido por usuario/API antes de usa-lo em `innerHTML`; varios renders atuais interpolam dados e exigem cuidado contra XSS.
- Nao faca push nem deploy sem autorizacao expressa.
