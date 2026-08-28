/**
 * suporte.js — Módulo de Suporte GAMBY
 *
 * Sub-tabs: Visão geral · Meus chamados · Abrir chamado · Aprendizado · FAQ
 * Dados reais via support-service.js (localStorage fallback quando sem backend).
 * Nenhum número inventado — KPIs mostram dados reais ou estado vazio.
 */

import {
  listTickets, createTicket, getTicket, addReply, updateTicketStatus,
  getTicketStats, uploadAttachment, TICKET_CATEGORIES, TICKET_PRIORITIES, TICKET_STATUSES,
} from './services/support-service.js';
import { initLearningPage } from './learning.js';

/* ─── XSS sanitizer ───────────────────────────────────────────────────────── */

function _esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function _safeUrl(url) {
  const v = String(url || '').trim();
  if (!v) return '';
  try {
    const p = new URL(v, window.location.origin);
    return ['http:', 'https:'].includes(p.protocol) ? p.href : '';
  } catch { return ''; }
}

/* ─── Static knowledge base ───────────────────────────────────────────────── */

const IA_RESPOSTAS = {
  'cancelar-venda': {
    q: 'Como faço para cancelar uma venda?',
    r: 'Para cancelar uma venda no Gamby, acesse o módulo <strong>Histórico</strong>, localize a venda pelo número ou data, clique em "Ver detalhes" e depois em "Cancelar venda". O estoque será restituído automaticamente e será gerada uma nota de cancelamento. Vendas com mais de 24h podem exigir autorização de gerente ou administrador.'
  },
  'fechar-caixa': {
    q: 'Como fechar o caixa corretamente?',
    r: 'Para fechar o caixa: (1) Acesse <strong>PDV / Caixa</strong>; (2) Clique em "Fechar caixa" no painel lateral; (3) Informe o valor em dinheiro em caixa; (4) Confira o resumo (vendas, sangrias, entradas); (5) Confirme o encerramento. Um relatório de fechamento será gerado automaticamente.'
  },
  'integrar-marketplace': {
    q: 'Como integrar meu marketplace?',
    r: 'Para integrar um marketplace: (1) Acesse <strong>Marketplace</strong> no menu; (2) Clique em "Vincular canal"; (3) Digite o nome do canal (ex.: Shopee, Mercado Livre); (4) Configure as credenciais de API fornecidas pelo marketplace; (5) Ative a sincronização automática de estoque. Pedidos online serão baixados automaticamente do seu estoque.'
  },
  'nota-fiscal': {
    q: 'Como emitir nota fiscal?',
    r: 'A emissão de NFC-e no Gamby funciona via integração fiscal. Configure em <strong>Configurações → Fiscal</strong> seus dados de CNPJ, certificado digital e ambiente (homologação/produção). Ao finalizar uma venda no PDV, escolha a opção "Emitir NFC-e". Em caso de rejeição, o Gamby exibirá o código do erro com orientações de correção.'
  }
};

const ARTIGOS = {
  'Primeiros passos': {
    icon: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><polyline points="9 11 12 14 22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>`,
    cor: '#60a5fa', corBg: 'rgba(37,99,235,0.15)',
    lista: [
      { titulo: 'Como criar minha conta no Gamby', tempo: '3 min', conteudo: 'Acesse a tela de cadastro e preencha nome, e-mail e senha. Confirme o e-mail recebido na sua caixa de entrada. Em seguida, informe os dados da sua empresa (CNPJ, nome fantasia, segmento). Pronto — seu ambiente estará configurado e pronto para uso.' },
      { titulo: 'Configurando sua empresa pela primeira vez', tempo: '5 min', conteudo: 'Em <strong>Configurações → Empresa</strong>, preencha Razão Social, CNPJ, endereço e logotipo. Esses dados aparecem nos relatórios e documentos fiscais. Salve e confirme. Recomendamos também configurar os horários de funcionamento para o relatório de turno.' },
      { titulo: 'Como cadastrar produtos rapidamente', tempo: '4 min', conteudo: 'Acesse <strong>Produtos</strong> e clique em "Novo produto". Preencha nome, categoria, preço de venda, custo e estoque inicial. Você pode importar produtos em massa via planilha CSV em <strong>Estoque → Importar</strong>. Use o campo de foto para adicionar a imagem do produto.' },
      { titulo: 'Entendendo o dashboard principal', tempo: '6 min', conteudo: 'O dashboard exibe faturamento do dia, itens com estoque crítico, últimas vendas e gráficos de desempenho. Os KPIs no topo mostram comparativos com o período anterior. Clique em qualquer card para navegar até o módulo correspondente.' },
      { titulo: 'Adicionando operadores e perfis de acesso', tempo: '4 min', conteudo: 'Em <strong>Usuários</strong>, clique em "Convidar usuário". Defina o perfil: Operador (acesso ao PDV), Gerente (estoque + relatórios) ou Administrador (acesso total). O usuário receberá um e-mail de convite para criar sua senha.' },
      { titulo: 'Configurando formas de pagamento', tempo: '3 min', conteudo: 'Acesse <strong>Configurações → Pagamentos</strong> para ativar ou desativar formas de pagamento (dinheiro, PIX, cartão, etc.). Você pode definir taxas de cartão por bandeira e configurar a integração com maquininhas de pagamento.' }
    ]
  },
  'PDV / Caixa': {
    icon: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>`,
    cor: '#4ade80', corBg: 'rgba(34,197,94,0.15)',
    lista: [
      { titulo: 'Como realizar uma venda completa no PDV', tempo: '5 min', conteudo: 'No PDV, busque o produto pelo nome, código de barras ou categoria. Clique para adicionar ao carrinho e ajuste a quantidade se necessário. Após montar o pedido, clique em "Finalizar venda", selecione a forma de pagamento e confirme. O recibo pode ser impresso ou enviado por e-mail/WhatsApp.' },
      { titulo: 'Abrindo e fechando o caixa corretamente', tempo: '4 min', conteudo: 'Para abrir: acesse PDV e clique em "Abrir caixa". Informe o valor de troco em dinheiro (fundo de caixa). Para fechar: clique em "Fechar caixa", informe o dinheiro em caixa e confira o resumo automático. Confirme para gerar o relatório de fechamento.' },
      { titulo: 'Sangria e suprimento de caixa', tempo: '3 min', conteudo: '<strong>Sangria</strong>: retirada de dinheiro do caixa durante o turno. <strong>Suprimento</strong>: adição de dinheiro ao caixa. Ambos são registrados no relatório de fechamento.' },
      { titulo: 'Cancelando uma venda no PDV', tempo: '3 min', conteudo: 'Vendas do turno atual podem ser canceladas diretamente no PDV. Para vendas de turnos anteriores, use o módulo <strong>Histórico</strong> com perfil de gerente ou administrador.' },
      { titulo: 'Formas de pagamento aceitas', tempo: '4 min', conteudo: 'O Gamby aceita: Dinheiro, PIX, Cartão de crédito/débito, Cheque, Vale refeição/alimentação, Crediário e Pagamento misto. Configure em <strong>Configurações → Pagamentos</strong>.' },
      { titulo: 'Como aplicar desconto na venda', tempo: '2 min', conteudo: 'No PDV, após montar o carrinho, clique no ícone "%" ao lado do total. Você pode aplicar desconto por valor fixo ou percentual. Pode ser necessária aprovação de gerente para descontos acima do limite configurado.' }
    ]
  },
  'Estoque': {
    icon: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>`,
    cor: '#fb923c', corBg: 'rgba(251,146,60,0.15)',
    lista: [
      { titulo: 'Como ajustar o estoque manualmente', tempo: '3 min', conteudo: 'Em <strong>Estoque → Ajuste manual</strong>, selecione o produto, escolha o tipo de ajuste (entrada, saída ou inventário), informe a quantidade e o motivo. O sistema registra o histórico de todas as movimentações.' },
      { titulo: 'Configurando alertas de estoque mínimo', tempo: '4 min', conteudo: 'Acesse <strong>Produtos</strong>, edite o produto e preencha o campo "Estoque mínimo". Quando o estoque atingir esse valor, um alerta será exibido no dashboard. Você pode receber também por e-mail em <strong>Configurações → Notificações</strong>.' },
      { titulo: 'Relatório de inventário completo', tempo: '5 min', conteudo: 'Em <strong>Estoque → Relatórios → Inventário</strong>, exporte o inventário completo em PDF ou CSV. O relatório inclui produto, categoria, quantidade, custo unitário e valor total em estoque.' },
      { titulo: 'Importando produtos em lote', tempo: '6 min', conteudo: 'Baixe o modelo CSV em <strong>Estoque → Importar → Baixar modelo</strong>. Preencha as colunas e faça o upload. O sistema validará os dados antes de confirmar a importação.' },
      { titulo: 'Categorias e organização de produtos', tempo: '4 min', conteudo: 'Em <strong>Produtos → Categorias</strong>, crie e edite as categorias. Você pode criar subcategorias e definir cor ou ícone para facilitar a identificação no PDV.' },
      { titulo: 'Rastreando movimentações de estoque', tempo: '3 min', conteudo: 'Em <strong>Estoque → Movimentações</strong>, você vê todo o histórico de entradas e saídas. Filtre por período, produto ou tipo de movimentação. Exporte para CSV para conferência.' }
    ]
  },
  'Financeiro': {
    icon: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="10"/><path d="M12 8v4l3 3"/></svg>`,
    cor: '#a78bfa', corBg: 'rgba(139,92,246,0.15)',
    lista: [
      { titulo: 'Como lançar uma conta a pagar', tempo: '4 min', conteudo: 'Em <strong>Financeiro → Contas a pagar</strong>, clique em "Nova conta". Informe fornecedor, descrição, valor, data de vencimento e categoria. Você pode parcelar o lançamento e receber lembrete antes do vencimento.' },
      { titulo: 'Registrando contas a receber', tempo: '4 min', conteudo: 'Em <strong>Financeiro → Contas a receber</strong>, clique em "Novo recebimento". Crediários e parcelamentos no cartão são criados automaticamente pelo PDV. Baixe cada parcela ao receber o pagamento.' },
      { titulo: 'Fechamento financeiro mensal', tempo: '6 min', conteudo: 'Em <strong>Financeiro → Relatórios → Fechamento mensal</strong>, selecione o mês. Você terá uma visão completa: receitas, despesas, resultado bruto e líquido, e comparativo com o mês anterior.' },
      { titulo: 'Fluxo de caixa e projeção', tempo: '5 min', conteudo: 'O painel de <strong>Fluxo de caixa</strong> exibe entradas e saídas dia a dia, com saldo projetado para os próximos 30 dias com base em contas programadas.' },
      { titulo: 'Como emitir um relatório DRE', tempo: '5 min', conteudo: 'Em <strong>Financeiro → DRE</strong>, selecione o período. O demonstrativo exibe: receita bruta, deduções, receita líquida, CMV, lucro bruto, despesas operacionais e resultado.' },
      { titulo: 'Conciliação bancária', tempo: '6 min', conteudo: 'Importe o extrato bancário em <strong>Financeiro → Conciliação</strong> (formatos OFX, CSV). O sistema cruzará automaticamente as transações com os lançamentos no Gamby.' }
    ]
  },
  'Marketplace': {
    icon: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
    cor: '#22d3ee', corBg: 'rgba(6,182,212,0.15)',
    lista: [
      { titulo: 'Vinculando a Shopee ao Gamby', tempo: '5 min', conteudo: 'Acesse <strong>Marketplace → Vincular canal → Shopee</strong>. Clique em "Autorizar" e faça login na Shopee. Após autorizar, o Gamby importará automaticamente seus produtos e pedidos.' },
      { titulo: 'Integrando o Mercado Livre', tempo: '5 min', conteudo: 'Em <strong>Marketplace → Vincular canal → Mercado Livre</strong>, clique em "Conectar conta ML". Após a conexão, seus anúncios serão sincronizados e o estoque será atualizado automaticamente.' },
      { titulo: 'Gerenciando pedidos de múltiplos canais', tempo: '6 min', conteudo: 'A tela <strong>Marketplace → Pedidos</strong> centraliza todos os pedidos de todos os canais integrados. Ao marcar como "enviado" ou "entregue", o status é atualizado no marketplace de origem automaticamente.' },
      { titulo: 'Sincronização de estoque entre canais', tempo: '4 min', conteudo: 'O Gamby atualiza o estoque em todos os canais automaticamente a cada venda. Configure o buffer de segurança em <strong>Marketplace → Configurações → Buffer de estoque</strong>.' },
      { titulo: 'Precificação diferenciada por canal', tempo: '4 min', conteudo: 'Em <strong>Produtos → Editar produto → Preços por canal</strong>, defina um preço diferente para cada marketplace.' },
      { titulo: 'Como tratar devoluções de marketplace', tempo: '5 min', conteudo: 'Devoluções aparecem em <strong>Marketplace → Devoluções</strong>. Clique em "Processar devolução" para confirmar o reingresso do produto no estoque e lançar o crédito no financeiro.' }
    ]
  },
  'Notas fiscais': {
    icon: `<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>`,
    cor: '#fbbf24', corBg: 'rgba(245,158,11,0.15)',
    lista: [
      { titulo: 'Configurando o certificado digital A1', tempo: '5 min', conteudo: 'Em <strong>Configurações → Fiscal → Certificado digital</strong>, clique em "Carregar certificado" e selecione o arquivo .pfx ou .p12. Informe a senha do certificado.' },
      { titulo: 'Emitindo NFC-e no PDV', tempo: '4 min', conteudo: 'Ao finalizar uma venda no PDV, clique em "Emitir NFC-e". O Gamby se comunicará com a SEFAZ, obterá a autorização e emitirá a nota. O XML e o DANFE são armazenados automaticamente.' },
      { titulo: 'O que fazer quando a NFC-e é rejeitada?', tempo: '4 min', conteudo: 'Rejeições da SEFAZ têm um código específico exibido pelo Gamby. <strong>Código 204</strong>: duplicidade de NF. <strong>Código 591</strong>: problema no certificado. <strong>Código 999</strong>: erro na SEFAZ — aguarde e tente novamente.' },
      { titulo: 'Emitindo NF-e para vendas B2B', tempo: '5 min', conteudo: 'Para emitir NF-e, acesse <strong>Fiscal → Emitir NF-e</strong>. Informe os dados do destinatário, produtos, CFOP, CST e tributos. Confira os dados e transmita à SEFAZ.' },
      { titulo: 'Cancelamento de nota fiscal', tempo: '3 min', conteudo: 'Uma nota fiscal pode ser cancelada em até 30 minutos após a emissão. Em <strong>Fiscal → Notas emitidas</strong>, localize a nota, clique em "Cancelar" e informe a justificativa.' },
      { titulo: 'Configurando NCM e tributos nos produtos', tempo: '6 min', conteudo: 'Cada produto deve ter o NCM, CSOSN/CST, CFOP padrão e alíquotas de ICMS, PIS, COFINS. Consulte seu contador e preencha em <strong>Produtos → Editar → Aba Fiscal</strong>.' }
    ]
  }
};

/* ─── State ───────────────────────────────────────────────────────────────── */

let _ctx = {};
let _activeTab = 'overview';
let _chatHistory = [];

/* ─── Entry point ─────────────────────────────────────────────────────────── */

export function renderSuporte(container, ctx = {}) {
  if (!container) return;
  _ctx = ctx;
  _activeTab = 'overview';
  _chatHistory = [];

  container.innerHTML = `
    <div class="sup-page">
      <div class="sup-header">
        <div class="sup-header-left">
          <div class="sup-header-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/></svg>
          </div>
          <div>
            <h2 class="sup-header-title">Suporte</h2>
            <p class="sup-header-sub">Conte com nossa equipe sempre que precisar.</p>
          </div>
        </div>
      </div>

      <nav class="sup-tabs-nav" role="tablist">
        <button class="sup-tab active" data-tab="overview"  type="button" role="tab">Visão geral</button>
        <button class="sup-tab"        data-tab="tickets"   type="button" role="tab">Meus chamados</button>
        <button class="sup-tab"        data-tab="new"       type="button" role="tab">Abrir chamado</button>
        <button class="sup-tab"        data-tab="learning"  type="button" role="tab">Central de Aprendizagem</button>
        <button class="sup-tab"        data-tab="faq"       type="button" role="tab">FAQ</button>
      </nav>

      <div class="sup-tab-content" id="supTabContent">
        <div class="sup-loading">Carregando...</div>
      </div>
    </div>
  `;

  container.querySelectorAll('.sup-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      container.querySelectorAll('.sup-tab').forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      _activeTab = btn.dataset.tab;
      _renderTab(container.querySelector('#supTabContent'), btn.dataset.tab);
    });
  });

  _renderTab(container.querySelector('#supTabContent'), 'overview');
}

/* ─── Tab router ──────────────────────────────────────────────────────────── */

function _renderTab(el, tab) {
  if (!el) return;
  switch (tab) {
    case 'overview':  _renderOverview(el);  break;
    case 'tickets':   _renderTickets(el);   break;
    case 'new':       _renderNewTicket(el); break;
    case 'learning':  _renderLearning(el);  break;
    case 'faq':       _renderFaq(el);       break;
    default: el.innerHTML = '<p class="sup-empty-msg">Aba não encontrada.</p>';
  }
}

/* ─── Tab: Visão geral ────────────────────────────────────────────────────── */

async function _renderOverview(el) {
  el.innerHTML = `<div class="sup-loading">Carregando resumo...</div>`;

  try {
    const stats = await getTicketStats({
      userId:    _ctx.userId,
      companyId: _ctx.companyId,
      role:      _ctx.role,
    });

    el.innerHTML = `
      <div class="sup-overview">
        <div class="sup-kpi-strip">
          ${_kpiCard({ label: 'Chamados abertos',     value: stats.open,       note: 'Aguardando atendimento', color: 'purple' })}
          ${_kpiCard({ label: 'Em atendimento',        value: stats.inProgress, note: 'Sendo respondidos',      color: 'blue' })}
          ${_kpiCard({ label: 'Resolvidos',            value: stats.resolved,   note: 'Solucionados',           color: 'green' })}
          ${_kpiCard({ label: 'Total de chamados',     value: stats.total,      note: 'Histórico completo',     color: 'muted' })}
        </div>

        ${stats.total === 0 ? `
          <div class="sup-empty-state">
            <div class="sup-empty-icon">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.61 3.5 2 2 0 0 1 3.59 1h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 8.91a16 16 0 0 0 6.08 6.08l.96-.96a2 2 0 0 1 2.11-.45c.9.322 1.847.52 2.81.7A2 2 0 0 1 22 16.92z"/></svg>
            </div>
            <h3>Nenhum chamado ainda</h3>
            <p>Você ainda não abriu nenhum chamado de suporte. Se precisar de ajuda, nossa equipe está pronta para te atender.</p>
            <button class="sup-btn-primary" data-goto-tab="new" type="button">Abrir primeiro chamado</button>
          </div>
        ` : `
          <div class="sup-overview-actions">
            <button class="sup-btn-primary" data-goto-tab="new" type="button">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Novo chamado
            </button>
            <button class="sup-btn-secondary" data-goto-tab="tickets" type="button">Ver meus chamados</button>
          </div>
        `}

        <div class="sup-contact-strip">
          <div class="sup-contact-card">
            <div class="sup-contact-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/></svg>
            </div>
            <div>
              <strong>E-mail</strong>
              <span>suporte@gamby.com.br</span>
            </div>
          </div>
          <div class="sup-contact-card">
            <div class="sup-contact-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413z"/></svg>
            </div>
            <div>
              <strong>WhatsApp</strong>
              <span>Seg–Sex · 9h às 18h</span>
            </div>
          </div>
        </div>
      </div>
    `;

    el.querySelectorAll('[data-goto-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        const tabName = btn.dataset.gotoTab;
        const tabBtn = el.closest('.sup-page')?.querySelector(`.sup-tab[data-tab="${tabName}"]`);
        if (tabBtn) tabBtn.click();
      });
    });
  } catch (err) {
    el.innerHTML = `<div class="sup-error-state"><p>Erro ao carregar dados: ${_esc(err?.message || 'Tente novamente.')}</p></div>`;
  }
}

function _kpiCard({ label, value, note, color }) {
  return `
    <div class="sup-kpi-card sup-kpi-${_esc(color)}">
      <span class="sup-kpi-label">${_esc(label)}</span>
      <strong class="sup-kpi-value">${value ?? 0}</strong>
      <small class="sup-kpi-note">${_esc(note)}</small>
    </div>
  `;
}

/* ─── Tab: Meus chamados ──────────────────────────────────────────────────── */

async function _renderTickets(el) {
  el.innerHTML = `<div class="sup-loading">Carregando chamados...</div>`;

  try {
    const tickets = await listTickets({
      userId:    _ctx.userId,
      companyId: _ctx.companyId,
      role:      _ctx.role,
    });

    if (tickets.length === 0) {
      el.innerHTML = `
        <div class="sup-empty-state">
          <div class="sup-empty-icon">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          </div>
          <h3>Nenhum chamado aberto</h3>
          <p>Você ainda não possui chamados de suporte. Clique abaixo para abrir seu primeiro chamado.</p>
          <button class="sup-btn-primary" data-goto-tab="new" type="button">Abrir chamado</button>
        </div>
      `;
      el.querySelector('[data-goto-tab]')?.addEventListener('click', () => {
        el.closest('.sup-page')?.querySelector('.sup-tab[data-tab="new"]')?.click();
      });
      return;
    }

    const statusMap = Object.fromEntries(TICKET_STATUSES.map(s => [s.value, s]));
    const catMap    = Object.fromEntries(TICKET_CATEGORIES.map(c => [c.value, c]));

    el.innerHTML = `
      <div class="sup-tickets-wrap">
        <div class="sup-tickets-toolbar">
          <input class="sup-search-input" id="supTicketSearch" placeholder="Buscar chamado..." type="search">
          <select class="sup-select" id="supTicketFilter">
            <option value="">Todos os status</option>
            ${TICKET_STATUSES.map(s => `<option value="${_esc(s.value)}">${_esc(s.label)}</option>`).join('')}
          </select>
        </div>

        <div class="sup-ticket-list" id="supTicketList">
          ${tickets.map(t => _ticketRow(t, statusMap, catMap)).join('')}
        </div>
      </div>
    `;

    const searchInput = el.querySelector('#supTicketSearch');
    const filterSel   = el.querySelector('#supTicketFilter');
    const list        = el.querySelector('#supTicketList');

    function applyFilter() {
      const q       = searchInput.value.toLowerCase();
      const status  = filterSel.value;
      list.querySelectorAll('.sup-ticket-row').forEach(row => {
        const matchQ  = !q || row.textContent.toLowerCase().includes(q);
        const matchSt = !status || row.dataset.status === status;
        row.classList.toggle('hidden', !(matchQ && matchSt));
      });
    }

    searchInput?.addEventListener('input', applyFilter);
    filterSel?.addEventListener('change', applyFilter);

    list.querySelectorAll('.sup-ticket-row').forEach(row => {
      row.addEventListener('click', () => _openTicketDetail(el, row.dataset.id));
    });

  } catch (err) {
    el.innerHTML = `<div class="sup-error-state"><p>Erro ao carregar chamados: ${_esc(err?.message || 'Tente novamente.')}</p></div>`;
  }
}

function _ticketRow(ticket, statusMap, catMap) {
  const s   = statusMap[ticket.status] || { label: ticket.status, cssClass: 'status-open' };
  const cat = catMap[ticket.category]?.label || ticket.category;
  const dt  = ticket.createdAt ? new Date(ticket.createdAt).toLocaleDateString('pt-BR') : '—';

  return `
    <div class="sup-ticket-row" data-id="${_esc(ticket.id)}" data-status="${_esc(ticket.status)}" role="button" tabindex="0">
      <div class="sup-ticket-main">
        <span class="sup-ticket-id">#${_esc(ticket.id.slice(-6).toUpperCase())}</span>
        <span class="sup-ticket-subject">${_esc(ticket.subject)}</span>
      </div>
      <div class="sup-ticket-meta">
        <span class="sup-ticket-cat">${_esc(cat)}</span>
        <span class="sup-ticket-status ${_esc(s.cssClass)}">${_esc(s.label)}</span>
        <span class="sup-ticket-date">${dt}</span>
      </div>
    </div>
  `;
}

async function _openTicketDetail(el, ticketId) {
  el.innerHTML = `<div class="sup-loading">Carregando chamado...</div>`;

  try {
    const [ticket, replies] = await Promise.all([
      getTicket(ticketId),
      import('./services/support-service.js').then(m => m.listReplies(ticketId)),
    ]);

    if (!ticket) throw new Error('Chamado não encontrado');

    const statusMap = Object.fromEntries(TICKET_STATUSES.map(s => [s.value, s]));
    const s = statusMap[ticket.status] || { label: ticket.status, cssClass: 'status-open' };
    const dt = ticket.createdAt ? new Date(ticket.createdAt).toLocaleString('pt-BR') : '—';

    el.innerHTML = `
      <div class="sup-ticket-detail">
        <button class="sup-back-btn" id="supBackToList" type="button">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
          Voltar
        </button>

        <div class="sup-td-header">
          <div class="sup-td-title-row">
            <span class="sup-ticket-id">#${_esc(ticket.id.slice(-6).toUpperCase())}</span>
            <span class="sup-ticket-status ${_esc(s.cssClass)}">${_esc(s.label)}</span>
          </div>
          <h3 class="sup-td-subject">${_esc(ticket.subject)}</h3>
          <span class="sup-td-meta">Aberto em ${dt}</span>
        </div>

        <div class="sup-td-description">
          <p class="sup-td-desc-label">Descrição original:</p>
          <div class="sup-td-desc-body">${_esc(ticket.description)}</div>
        </div>

        <div class="sup-td-replies" id="supTdReplies">
          ${replies.length === 0 ? '<p class="sup-td-no-replies">Nenhuma resposta ainda. Nossa equipe responderá em breve.</p>' :
            replies.map(r => `
              <div class="sup-reply ${r.isStaff ? 'sup-reply-staff' : 'sup-reply-user'}">
                <div class="sup-reply-author">${_esc(r.authorName || (r.isStaff ? 'Equipe Gamby' : 'Você'))}</div>
                <div class="sup-reply-body">${_esc(r.message)}</div>
                <div class="sup-reply-date">${r.createdAt ? new Date(r.createdAt).toLocaleString('pt-BR') : ''}</div>
              </div>
            `).join('')}
        </div>

        ${ticket.status !== 'fechado' && ticket.status !== 'resolvido' ? `
          <div class="sup-td-reply-form">
            <label class="sup-td-reply-label">Adicionar resposta:</label>
            <textarea class="sup-textarea" id="supReplyText" rows="4" placeholder="Descreva sua mensagem..."></textarea>
            <div class="sup-td-reply-actions">
              <button class="sup-btn-primary" id="supSendReply" type="button">Enviar resposta</button>
            </div>
            <p class="sup-td-reply-note" id="supReplyNote" hidden></p>
          </div>
        ` : `
          <div class="sup-td-closed-note">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            Este chamado está ${_esc(s.label.toLowerCase())} e não pode receber novas respostas.
          </div>
        `}
      </div>
    `;

    el.querySelector('#supBackToList')?.addEventListener('click', () => _renderTickets(el));

    const sendBtn    = el.querySelector('#supSendReply');
    const replyText  = el.querySelector('#supReplyText');
    const replyNote  = el.querySelector('#supReplyNote');
    const repliesDiv = el.querySelector('#supTdReplies');

    sendBtn?.addEventListener('click', async () => {
      const message = replyText?.value.trim();
      if (!message) return;
      sendBtn.disabled = true;
      sendBtn.textContent = 'Enviando...';
      try {
        const reply = await addReply(ticket.id, {
          message,
          authorId:   _ctx.userId || 'unknown',
          authorName: _ctx.userName || 'Você',
          isStaff:    false,
        });
        replyText.value = '';
        if (replyNote) { replyNote.textContent = 'Resposta enviada com sucesso!'; replyNote.hidden = false; }
        const newDiv = document.createElement('div');
        newDiv.className = 'sup-reply sup-reply-user';
        newDiv.innerHTML = `
          <div class="sup-reply-author">${_esc(reply.authorName || 'Você')}</div>
          <div class="sup-reply-body">${_esc(reply.message)}</div>
          <div class="sup-reply-date">${new Date(reply.createdAt).toLocaleString('pt-BR')}</div>
        `;
        repliesDiv?.querySelector('.sup-td-no-replies')?.remove();
        repliesDiv?.appendChild(newDiv);
        repliesDiv?.scrollTo(0, repliesDiv.scrollHeight);
      } catch (e) {
        if (replyNote) { replyNote.textContent = 'Erro ao enviar: ' + (e?.message || 'Tente novamente.'); replyNote.hidden = false; }
      } finally {
        sendBtn.disabled = false;
        sendBtn.textContent = 'Enviar resposta';
      }
    });

  } catch (err) {
    el.innerHTML = `
      <div class="sup-error-state">
        <p>Erro ao carregar chamado: ${_esc(err?.message || 'Tente novamente.')}</p>
        <button class="sup-btn-secondary" id="supBackToList2" type="button">Voltar</button>
      </div>`;
    el.querySelector('#supBackToList2')?.addEventListener('click', () => _renderTickets(el));
  }
}

/* ─── Tab: Abrir chamado ──────────────────────────────────────────────────── */

function _renderNewTicket(el) {
  el.innerHTML = `
    <div class="sup-new-ticket-wrap">
      <h3 class="sup-section-title">Novo chamado de suporte</h3>
      <p class="sup-section-sub">Descreva seu problema com detalhes para que possamos ajudá-lo mais rapidamente.</p>

      <form class="sup-ticket-form" id="supTicketForm" novalidate>
        <div class="sup-form-row">
          <div class="sup-field-group">
            <label class="sup-field-label" for="supTSubject">Assunto <span class="sup-required">*</span></label>
            <input class="sup-input" id="supTSubject" type="text" placeholder="Resumo do problema" maxlength="120" required>
          </div>
        </div>

        <div class="sup-form-2col">
          <div class="sup-field-group">
            <label class="sup-field-label" for="supTCategory">Categoria <span class="sup-required">*</span></label>
            <select class="sup-select" id="supTCategory" required>
              <option value="">Selecione...</option>
              ${TICKET_CATEGORIES.map(c => `<option value="${_esc(c.value)}">${_esc(c.label)}</option>`).join('')}
            </select>
          </div>
          <div class="sup-field-group">
            <label class="sup-field-label" for="supTPriority">Prioridade</label>
            <select class="sup-select" id="supTPriority">
              ${TICKET_PRIORITIES.map(p => `<option value="${_esc(p.value)}" ${p.value === 'normal' ? 'selected' : ''}>${_esc(p.label)}</option>`).join('')}
            </select>
          </div>
        </div>

        <div class="sup-field-group">
          <label class="sup-field-label" for="supTDesc">Descrição detalhada <span class="sup-required">*</span></label>
          <textarea class="sup-textarea" id="supTDesc" rows="6" placeholder="Descreva o problema com o máximo de detalhes possível: o que aconteceu, quando aconteceu e como reproduzir..." maxlength="2000" required></textarea>
          <span class="sup-char-count" id="supTDescCount">0 / 2000</span>
        </div>

        <div class="sup-field-group">
          <label class="sup-field-label" for="supTFile">Anexo (opcional)</label>
          <input class="sup-input-file" id="supTFile" type="file" accept="image/*,.pdf,.csv,.txt,.xls,.xlsx" multiple>
          <span class="sup-field-hint">Imagens, PDF, planilhas — máx. 10 MB por arquivo</span>
          <div class="sup-file-preview" id="supFilePreview"></div>
        </div>

        <p class="sup-form-error hidden" id="supFormError"></p>
        <p class="sup-form-success hidden" id="supFormSuccess"></p>

        <div class="sup-form-actions">
          <button class="sup-btn-primary" id="supSubmitTicket" type="submit">Abrir chamado</button>
          <button class="sup-btn-ghost" id="supCancelTicket" type="button">Cancelar</button>
        </div>
      </form>
    </div>
  `;

  const form       = el.querySelector('#supTicketForm');
  const subjectEl  = el.querySelector('#supTSubject');
  const catEl      = el.querySelector('#supTCategory');
  const prioEl     = el.querySelector('#supTPriority');
  const descEl     = el.querySelector('#supTDesc');
  const countEl    = el.querySelector('#supTDescCount');
  const fileEl     = el.querySelector('#supTFile');
  const previewEl  = el.querySelector('#supFilePreview');
  const errorEl    = el.querySelector('#supFormError');
  const successEl  = el.querySelector('#supFormSuccess');
  const submitBtn  = el.querySelector('#supSubmitTicket');

  descEl?.addEventListener('input', () => {
    if (countEl) countEl.textContent = `${descEl.value.length} / 2000`;
  });

  fileEl?.addEventListener('change', () => {
    if (!previewEl) return;
    previewEl.innerHTML = Array.from(fileEl.files).map(f =>
      `<div class="sup-file-chip">📎 ${_esc(f.name)} <span class="sup-file-size">(${(f.size/1024).toFixed(0)} KB)</span></div>`
    ).join('');
  });

  el.querySelector('#supCancelTicket')?.addEventListener('click', () => {
    el.closest('.sup-page')?.querySelector('.sup-tab[data-tab="tickets"]')?.click();
  });

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const subject  = subjectEl?.value.trim();
    const category = catEl?.value;
    const priority = prioEl?.value || 'medium';
    const desc     = descEl?.value.trim();

    if (!subject) { _showError(errorEl, 'Informe o assunto do chamado.'); return; }
    if (!category) { _showError(errorEl, 'Selecione uma categoria.'); return; }
    if (desc.length < 20) { _showError(errorEl, 'Descreva o problema com pelo menos 20 caracteres.'); return; }

    _hideEl(errorEl);
    submitBtn.disabled = true;
    submitBtn.textContent = 'Abrindo chamado...';

    try {
      const ticket = await createTicket({
        subject, category, priority,
        description: desc,
        userId:      _ctx.userId || null,
        companyId:   _ctx.companyId || null,
        userEmail:   _ctx.userEmail || null,
      });

      // Upload de anexos (se houver)
      const files = Array.from(fileEl?.files || []);
      if (files.length > 0 && ticket?.id) {
        submitBtn.textContent = 'Enviando anexos...';
        await Promise.allSettled(files.map(f => uploadAttachment(ticket.id, f)));
      }

      _showSuccess(successEl, 'Chamado aberto com sucesso! Nossa equipe responderá em breve.');
      form.reset();
      if (previewEl) previewEl.innerHTML = '';
      if (countEl) countEl.textContent = '0 / 2000';
      setTimeout(() => {
        el.closest('.sup-page')?.querySelector('.sup-tab[data-tab="tickets"]')?.click();
      }, 2500);
    } catch (err) {
      _showError(errorEl, err?.message || 'Erro ao abrir chamado. Tente novamente.');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Abrir chamado';
    }
  });
}

/* ─── Tab: Central de Aprendizagem ───────────────────────────────────────── */

function _renderLearning(el) {
  el.innerHTML = '';
  const role    = _ctx.role || '';
  const isDev   = role === 'desenvolvedora';
  initLearningPage(el, { isDeveloper: isDev, sessionRole: role });
}

/* ─── Tab: FAQ ────────────────────────────────────────────────────────────── */

function _renderFaq(el) {
  const cats = Object.keys(ARTIGOS);

  el.innerHTML = `
    <div class="sup-faq-wrap">
      <div class="sup-faq-left">
        <h3 class="sup-section-title">Base de conhecimento</h3>
        <div class="sup-knowledge-grid" id="supKnowledgeGrid">
          ${cats.map(cat => {
            const d = ARTIGOS[cat];
            return `
              <div class="sup-knowledge-card" data-cat="${_esc(cat)}" role="button" tabindex="0">
                <div class="sup-knowledge-icon">${d.icon}</div>
                <div class="sup-knowledge-info">
                  <strong>${_esc(cat)}</strong>
                  <span>${d.lista.length} artigos</span>
                </div>
              </div>
            `;
          }).join('')}
        </div>

        <div class="sup-articles-panel hidden" id="supArticlesPanel"></div>
      </div>

      <div class="sup-faq-right">
        <h3 class="sup-section-title">Assistente de dúvidas</h3>
        <div class="sup-ia-wrap">
          <div class="sup-ia-suggestions">
            ${Object.entries(IA_RESPOSTAS).map(([key, val]) => `
              <button class="sup-ia-suggest" data-question="${_esc(key)}" type="button">${_esc(val.q)}</button>
            `).join('')}
          </div>
          <div class="sup-ia-chat" id="supIaChat"></div>
          <div class="sup-ia-input-row">
            <input class="sup-ia-input" id="supIaInput" type="text" placeholder="Faça uma pergunta..." maxlength="300">
            <button class="sup-ia-send" id="supIaSend" type="button">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  `;

  _bindKnowledgeCards(el);
  _bindIaChat(el);
}

function _bindKnowledgeCards(el) {
  const grid  = el.querySelector('#supKnowledgeGrid');
  const panel = el.querySelector('#supArticlesPanel');

  grid?.querySelectorAll('.sup-knowledge-card').forEach(card => {
    card.addEventListener('click', () => {
      const cat  = card.dataset.cat;
      const data = ARTIGOS[cat];
      if (!data) return;

      grid.querySelectorAll('.sup-knowledge-card').forEach(c => c.classList.remove('active'));
      card.classList.add('active');

      panel.innerHTML = `
        <div class="sup-articles-header">
          <button class="sup-articles-back" id="supArticlesBack" type="button">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="15 18 9 12 15 6"/></svg>
            Voltar
          </button>
          <h4>${_esc(cat)}</h4>
          <span class="sup-articles-count">${data.lista.length} artigos</span>
        </div>
        <div class="sup-articles-list">
          ${data.lista.map((a, i) => `
            <div class="sup-article-item" data-art="${i}" data-cat="${_esc(cat)}" role="button" tabindex="0">
              <div class="sup-article-title">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                ${_esc(a.titulo)}
              </div>
              <span class="sup-article-time">${_esc(a.tempo)}</span>
            </div>
          `).join('')}
        </div>
      `;
      panel.classList.remove('hidden');

      panel.querySelector('#supArticlesBack')?.addEventListener('click', () => {
        panel.classList.add('hidden');
        panel.innerHTML = '';
        grid.querySelectorAll('.sup-knowledge-card').forEach(c => c.classList.remove('active'));
      });

      panel.querySelectorAll('.sup-article-item').forEach(item => {
        item.addEventListener('click', () => {
          const idx = parseInt(item.dataset.art);
          _openArticleModal(ARTIGOS[item.dataset.cat].lista[idx], item.dataset.cat);
        });
        item.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') item.click(); });
      });
    });

    card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') card.click(); });
  });
}

function _openArticleModal(artigo, categoria) {
  document.getElementById('supArticleModal')?.remove();
  const modal = document.createElement('div');
  modal.id = 'supArticleModal';
  modal.className = 'sup-article-modal-overlay';
  modal.innerHTML = `
    <div class="sup-article-modal">
      <div class="sup-article-modal-head">
        <div>
          <span class="sup-article-modal-cat">${_esc(categoria)}</span>
          <h3 class="sup-article-modal-title">${_esc(artigo.titulo)}</h3>
        </div>
        <button class="sup-article-modal-close" id="supArticleModalClose" type="button">✕</button>
      </div>
      <div class="sup-article-modal-meta">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        Tempo de leitura: ${_esc(artigo.tempo)}
      </div>
      <div class="sup-article-modal-body">${artigo.conteudo}</div>
      <div class="sup-article-modal-footer">
        <span>Este artigo foi útil?</span>
        <button class="sup-article-vote" type="button">👍 Sim</button>
        <button class="sup-article-vote" type="button">👎 Não</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  modal.querySelector('#supArticleModalClose')?.addEventListener('click', () => modal.remove());
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  modal.querySelectorAll('.sup-article-vote').forEach(btn => {
    btn.addEventListener('click', () => {
      modal.querySelector('.sup-article-modal-footer').innerHTML = '<span class="sup-feedback-ok">✓ Obrigado pelo feedback!</span>';
    });
  });
}

function _bindIaChat(el) {
  const input   = el.querySelector('#supIaInput');
  const sendBtn = el.querySelector('#supIaSend');
  const chat    = el.querySelector('#supIaChat');
  if (!input || !sendBtn || !chat) return;

  el.querySelectorAll('.sup-ia-suggest').forEach(btn => {
    btn.addEventListener('click', () => {
      const key  = btn.dataset.question;
      const resp = IA_RESPOSTAS[key];
      if (!resp) return;
      _addChatMessage('user', resp.q, chat);
      setTimeout(() => _addChatMessage('ia', resp.r, chat), 500);
    });
  });

  function send() {
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    _addChatMessage('user', text, chat);
    const lower = text.toLowerCase();
    let resp = 'Entendi sua dúvida! Nossa equipe pode te ajudar com mais detalhes. Abra um chamado técnico para atendimento personalizado.';
    for (const val of Object.values(IA_RESPOSTAS)) {
      if (lower.includes('cancel') && val.q.includes('cancelar')) { resp = val.r; break; }
      if ((lower.includes('fech') || lower.includes('caixa')) && val.q.includes('caixa')) { resp = val.r; break; }
      if ((lower.includes('market') || lower.includes('integr')) && val.q.includes('marketplace')) { resp = val.r; break; }
      if ((lower.includes('nota') || lower.includes('nfc') || lower.includes('fiscal')) && val.q.includes('nota')) { resp = val.r; break; }
    }
    setTimeout(() => _addChatMessage('ia', resp, chat), 600);
  }

  sendBtn.addEventListener('click', send);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') send(); });
}

function _addChatMessage(role, text, container) {
  const div = document.createElement('div');
  div.className = role === 'user' ? 'sup-ia-msg sup-ia-msg-user' : 'sup-ia-msg sup-ia-msg-ia';
  if (role === 'ia') {
    const bot = document.createElement('span');
    bot.className = 'sup-ia-bot-dot';
    bot.textContent = '🤖';
    const msg = document.createElement('span');
    msg.innerHTML = text;
    div.appendChild(bot);
    div.appendChild(msg);
  } else {
    const msg = document.createElement('span');
    msg.textContent = text;
    div.appendChild(msg);
  }
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

/* ─── Helpers ─────────────────────────────────────────────────────────────── */

function _showError(el, msg)   { if (!el) return; el.textContent = msg; el.classList.remove('hidden'); }
function _showSuccess(el, msg) { if (!el) return; el.textContent = msg; el.classList.remove('hidden'); }
function _hideEl(el)           { if (!el) return; el.classList.add('hidden'); }
