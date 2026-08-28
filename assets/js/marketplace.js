/**
 * marketplace.js — Gamby Fluxo Caixa Pro
 * Integração real com Mercado Livre, Shopee, Amazon, Magalu e iFood.
 *
 * Cada plataforma segue o mesmo ciclo:
 *   1. Cliente salva suas credenciais (App ID + Secret)
 *   2. Autenticação OAuth ou HMAC via backend proxy
 *   3. Polling periódico por novos pedidos
 *   4. Baixa de estoque automática ao confirmar pedido
 *   5. Registro no histórico e dashboard
 */

import { state } from './state.js';
import { KEYS, load, save } from './storage.js';
import { persistProducts, renderProducts, updateProductMetrics } from './products.js';
import { addHistory } from './history.js';
import { formatCurrency, formatDateTimeBR, toNumber } from './utils.js';
import { renderFinance } from './finance.js';
import { renderReports } from './reports.js';

function _esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/* ================= CONSTANTES ================= */

const PLATFORMS = {
  mercadolivre: {
    id: 'mercadolivre',
    name: 'Mercado Livre',
    color: '#ffe600',
    textColor: '#333',
    icon: '🛒',
    authType: 'oauth2',
    docsUrl: 'https://developers.mercadolivre.com.br/pt_br/autenticacao-e-autorizacao',
    setupSteps: [
      'Acesse developers.mercadolivre.com.br',
      'Clique em "Criar aplicação"',
      'Preencha nome, descrição e URL de redirecionamento',
      'Copie o App ID e o Client Secret gerados',
      'Cole as credenciais abaixo e clique em Conectar'
    ],
    fields: [
      { key: 'appId', label: 'App ID (Client ID)', placeholder: 'Ex.: 1234567890' },
      { key: 'clientSecret', label: 'Client Secret', placeholder: 'Cole o secret aqui', type: 'password' },
      { key: 'sellerId', label: 'Seller ID (user_id)', placeholder: 'Ex.: 123456789' }
    ],
    apiBase: 'https://api.mercadolibre.com',
    ordersEndpoint: '/orders/search?seller={sellerId}&order.status=paid&sort=date_desc',
    stockEndpoint: '/items/{itemId}'
  },

  shopee: {
    id: 'shopee',
    name: 'Shopee',
    color: '#ee4d2d',
    textColor: '#fff',
    icon: '🛍️',
    authType: 'hmac',
    docsUrl: 'https://open.shopee.com/documents',
    setupSteps: [
      'Acesse open.shopee.com e crie uma conta de parceiro',
      'Solicite acesso à API (processo de aprovação manual)',
      'Após aprovação, crie um app em "My Apps"',
      'Copie o Partner ID e o Partner Key',
      'Cole as credenciais abaixo e clique em Conectar'
    ],
    fields: [
      { key: 'partnerId', label: 'Partner ID', placeholder: 'Ex.: 1234567' },
      { key: 'partnerKey', label: 'Partner Key', placeholder: 'Cole a key aqui', type: 'password' },
      { key: 'shopId', label: 'Shop ID', placeholder: 'Ex.: 987654321' }
    ],
    apiBase: 'https://partner.shopeemobile.com',
    ordersEndpoint: '/api/v2/order/get_order_list',
    stockEndpoint: '/api/v2/product/update_stock'
  },

  amazon: {
    id: 'amazon',
    name: 'Amazon',
    color: '#ff9900',
    textColor: '#333',
    icon: '📦',
    authType: 'sp-api',
    docsUrl: 'https://developer-docs.amazon.com/sp-api',
    setupSteps: [
      'Acesse sellercentral.amazon.com.br e faça login',
      'Vá em Configurações > Informações da conta > Credenciais de desenvolvedor',
      'Clique em "Adicionar nova aplicação de desenvolvedor"',
      'Anote o Seller ID (Merchant Token)',
      'Registre-se em developer.amazonservices.com para obter MWS Auth Token',
      'Cole as credenciais abaixo'
    ],
    fields: [
      { key: 'sellerId', label: 'Seller ID (Merchant Token)', placeholder: 'Ex.: A1B2C3D4E5F6G7' },
      { key: 'mwsAuthToken', label: 'MWS Auth Token', placeholder: 'Cole o token aqui', type: 'password' },
      { key: 'marketplaceId', label: 'Marketplace ID', placeholder: 'BR: A2Q3Y263D00KWC' }
    ],
    apiBase: 'https://sellingpartnerapi-na.amazon.com',
    ordersEndpoint: '/orders/v0/orders?MarketplaceIds={marketplaceId}&OrderStatuses=Unshipped',
    stockEndpoint: '/fba/inventory/v1/summaries'
  },

  magalu: {
    id: 'magalu',
    name: 'Magalu',
    color: '#0086ff',
    textColor: '#fff',
    icon: '🏪',
    authType: 'oauth2',
    docsUrl: 'https://sellers.magalu.com/api-docs',
    setupSteps: [
      'Acesse seller.magalu.com e faça login como seller',
      'Vá em Configurações > Integrações > API',
      'Clique em "Solicitar acesso à API"',
      'Aguarde a aprovação (pode levar alguns dias)',
      'Copie o Client ID e Client Secret liberados',
      'Cole as credenciais abaixo'
    ],
    fields: [
      { key: 'clientId', label: 'Client ID', placeholder: 'Ex.: abc123def456' },
      { key: 'clientSecret', label: 'Client Secret', placeholder: 'Cole o secret aqui', type: 'password' },
      { key: 'sellerId', label: 'Seller ID', placeholder: 'Ex.: seller-uuid' }
    ],
    apiBase: 'https://api.magalu.com',
    ordersEndpoint: '/v1/orders?status=pending',
    stockEndpoint: '/v1/products/{sku}/stocks'
  },

  ifood: {
    id: 'ifood',
    name: 'iFood',
    color: '#ea1d2c',
    textColor: '#fff',
    icon: '🍔',
    authType: 'oauth2',
    docsUrl: 'https://developer.ifood.com.br',
    setupSteps: [
      'Acesse developer.ifood.com.br e crie uma conta de parceiro tecnológico',
      'Preencha o formulário de parceria (processo de credenciamento)',
      'Aguarde contato da equipe iFood (pode levar semanas)',
      'Após aprovação, acesse o Portal do Desenvolvedor',
      'Crie uma aplicação e copie o Client ID e Client Secret',
      'Cole as credenciais abaixo'
    ],
    fields: [
      { key: 'clientId', label: 'Client ID', placeholder: 'Ex.: ifood-client-uuid' },
      { key: 'clientSecret', label: 'Client Secret', placeholder: 'Cole o secret aqui', type: 'password' },
      { key: 'merchantId', label: 'Merchant ID (ID do restaurante/loja)', placeholder: 'Ex.: merchant-uuid' }
    ],
    apiBase: 'https://merchant-api.ifood.com.br',
    ordersEndpoint: '/order/v1.0/events:polling',
    stockEndpoint: '/catalog/v2.0/merchants/{merchantId}/items'
  }
};

/* ================= STATE ================= */

let pollingIntervals = {};
let marketplaceActionsBound = false;

function getMarketplaceState() {
  if (!state.marketplace) {
    state.marketplace = load(KEYS.marketplace, {
      channels: [],
      onlineOrders: [],
      credentials: {},
      lastSync: {}
    });
  }

  state.marketplace.channels ||= [];
  state.marketplace.onlineOrders ||= [];
  state.marketplace.credentials ||= {};
  state.marketplace.lastSync ||= {};

  return state.marketplace;
}

function persist() {
  save(KEYS.marketplace, state.marketplace);
}

/* ================= CREDENCIAIS ================= */

function saveCredentials(platformId, fields) {
  const mk = getMarketplaceState();
  mk.credentials[platformId] = { ...fields, connectedAt: new Date().toISOString(), active: true };
  persist();
}

function getCredentials(platformId) {
  return getMarketplaceState().credentials?.[platformId] || null;
}

function isConnected(platformId) {
  const creds = getCredentials(platformId);
  if (!creds || !creds.active) return false;

  const platform = PLATFORMS[platformId];
  if (!platform) return false;

  // Verifica se todos os campos obrigatórios estão preenchidos
  return platform.fields.every(f => creds[f.key] && String(creds[f.key]).trim().length > 0);
}

function disconnectPlatform(platformId) {
  const mk = getMarketplaceState();
  if (mk.credentials[platformId]) {
    mk.credentials[platformId].active = false;
  }
  stopPolling(platformId);
  persist();
}

/* ================= AUTENTICAÇÃO ================= */

/**
 * Gera o header de autenticação correto para cada plataforma.
 * Na prática, chamadas diretas de browser são bloqueadas por CORS —
 * o ideal é um backend proxy. Mas a estrutura está pronta para quando
 * o backend for configurado.
 */
async function getAuthHeader(platformId) {
  const creds = getCredentials(platformId);
  if (!creds) throw new Error(`Credenciais não encontradas para ${platformId}`);

  const platform = PLATFORMS[platformId];

  if (platform.authType === 'oauth2') {
    // Busca token salvo ou renova
    if (creds.accessToken && creds.tokenExpiresAt && Date.now() < creds.tokenExpiresAt) {
      return { Authorization: `Bearer ${creds.accessToken}` };
    }
    // Token expirado ou ausente — fluxo de renovação
    const token = await refreshOAuthToken(platformId, creds);
    return { Authorization: `Bearer ${token}` };
  }

  if (platform.authType === 'hmac') {
    // Shopee usa HMAC-SHA256 com timestamp
    const timestamp = Math.floor(Date.now() / 1000);
    const signature = await generateShopeeSignature(creds.partnerKey, timestamp, platform.ordersEndpoint);
    return {
      'Content-Type': 'application/json',
      'X-Shopee-Signature': signature,
      'X-Shopee-Timestamp': String(timestamp)
    };
  }

  if (platform.authType === 'sp-api') {
    // Amazon SP-API usa AWS Signature v4
    return {
      'x-amz-access-token': creds.mwsAuthToken,
      'Content-Type': 'application/json'
    };
  }

  return { 'Content-Type': 'application/json' };
}

async function refreshOAuthToken(platformId, creds) {
  const tokenUrls = {
    mercadolivre: 'https://api.mercadolibre.com/oauth/token',
    magalu: 'https://id.magalu.com/oauth/token',
    ifood: 'https://merchant-api.ifood.com.br/authentication/v1.0/oauth/token'
  };

  const url = tokenUrls[platformId];
  if (!url) throw new Error(`URL de token não definida para ${platformId}`);

  const clientId = creds.appId || creds.clientId;
  const clientSecret = creds.clientSecret;

  if (!clientId || !clientSecret) {
    throw new Error('Credenciais incompletas para renovar token.');
  }

  // NOTA: em produção, esta chamada deve passar por um backend proxy
  // para não expor o client_secret no frontend.
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Erro ao renovar token ${platformId}: ${err}`);
  }

  const data = await response.json();
  const token = data.access_token;
  const expiresIn = Number(data.expires_in || 21600);

  // Salva token renovado
  const mk = getMarketplaceState();
  mk.credentials[platformId].accessToken = token;
  mk.credentials[platformId].tokenExpiresAt = Date.now() + (expiresIn - 60) * 1000;
  persist();

  return token;
}

async function generateShopeeSignature(partnerKey, timestamp, path) {
  // Shopee assina: partnerId + path + timestamp com HMAC-SHA256
  // Em browser, usa SubtleCrypto
  try {
    const encoder = new TextEncoder();
    const message = encoder.encode(`${partnerKey}${path}${timestamp}`);
    const keyData = encoder.encode(partnerKey);
    const cryptoKey = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = await crypto.subtle.sign('HMAC', cryptoKey, message);
    return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return '';
  }
}

/* ================= BUSCA DE PEDIDOS ================= */

async function fetchOrders(platformId) {
  const platform = PLATFORMS[platformId];
  const creds = getCredentials(platformId);
  if (!platform || !creds) return [];

  const headers = await getAuthHeader(platformId);

  let endpoint = platform.ordersEndpoint
    .replace('{sellerId}', creds.sellerId || creds.merchantId || '')
    .replace('{marketplaceId}', creds.marketplaceId || 'A2Q3Y263D00KWC');

  const url = platform.apiBase + endpoint;

  const response = await fetch(url, { method: 'GET', headers });

  if (!response.ok) {
    throw new Error(`Erro ${response.status} ao buscar pedidos de ${platform.name}`);
  }

  const data = await response.json();

  return normalizeOrders(platformId, data);
}

/**
 * Normaliza a resposta de cada plataforma para o formato interno do Gamby.
 */
function normalizeOrders(platformId, raw) {
  if (platformId === 'mercadolivre') {
    const results = raw?.results || [];
    return results.map(order => ({
      externalId: String(order.id),
      platform: 'mercadolivre',
      platformName: 'Mercado Livre',
      status: order.status,
      total: Number(order.total_amount || 0),
      items: (order.order_items || []).map(i => ({
        name: i.item?.title || 'Produto',
        sku: String(i.item?.id || ''),
        quantity: Number(i.quantity || 1),
        price: Number(i.unit_price || 0)
      })),
      createdAt: order.date_created || new Date().toISOString(),
      buyerName: order.buyer?.nickname || 'Comprador'
    }));
  }

  if (platformId === 'shopee') {
    const list = raw?.response?.order_list || [];
    return list.map(order => ({
      externalId: String(order.order_sn),
      platform: 'shopee',
      platformName: 'Shopee',
      status: order.order_status,
      total: Number(order.total_amount || 0),
      items: (order.item_list || []).map(i => ({
        name: i.item_name || 'Produto',
        sku: String(i.item_id || ''),
        quantity: Number(i.model_quantity_purchased || 1),
        price: Number(i.model_discounted_price || 0)
      })),
      createdAt: new Date((order.create_time || Date.now() / 1000) * 1000).toISOString(),
      buyerName: order.buyer_username || 'Comprador'
    }));
  }

  if (platformId === 'amazon') {
    const orders = raw?.Orders || [];
    return orders.map(order => ({
      externalId: order.AmazonOrderId,
      platform: 'amazon',
      platformName: 'Amazon',
      status: order.OrderStatus,
      total: Number(order.OrderTotal?.Amount || 0),
      items: [],
      createdAt: order.PurchaseDate || new Date().toISOString(),
      buyerName: 'Cliente Amazon'
    }));
  }

  if (platformId === 'magalu') {
    const orders = raw?.data || raw?.orders || [];
    return orders.map(order => ({
      externalId: String(order.id || order.order_id),
      platform: 'magalu',
      platformName: 'Magalu',
      status: order.status,
      total: Number(order.total || order.total_amount || 0),
      items: (order.items || []).map(i => ({
        name: i.product_description || i.name || 'Produto',
        sku: String(i.sku || i.product_id || ''),
        quantity: Number(i.quantity || 1),
        price: Number(i.unit_price || i.price || 0)
      })),
      createdAt: order.created_at || new Date().toISOString(),
      buyerName: order.customer?.name || 'Cliente Magalu'
    }));
  }

  if (platformId === 'ifood') {
    const events = raw || [];
    return events
      .filter(e => e.code === 'PLC' || e.code === 'CFM') // placed / confirmed
      .map(event => ({
        externalId: String(event.orderId),
        platform: 'ifood',
        platformName: 'iFood',
        status: event.code,
        total: Number(event.metadata?.totalAmount || 0),
        items: [],
        createdAt: event.createdAt || new Date().toISOString(),
        buyerName: 'Cliente iFood'
      }));
  }

  return [];
}

/* ================= BAIXA DE ESTOQUE ================= */

function matchProductBySku(sku) {
  if (!sku || !Array.isArray(state.products)) return null;

  return state.products.find(p =>
    String(p.barcode || '').trim() === String(sku).trim() ||
    String(p.code || '').trim() === String(sku).trim()
  ) || null;
}

function deductStock(items, platformName, externalId) {
  if (!Array.isArray(items) || !items.length) return;

  items.forEach(item => {
    const product = matchProductBySku(item.sku);
    if (!product) return;

    const qty = Number(item.quantity || 1);
    const currentStock = Number(product.stock || 0);

    if (currentStock < qty) {
      console.warn(`[Marketplace] Estoque insuficiente para ${product.name}: tem ${currentStock}, precisa ${qty}`);
    }

    product.stock = Math.max(0, currentStock - qty);
  });

  persistProducts();
  renderProducts();
  updateProductMetrics();
}

/* ================= PROCESSAMENTO DE PEDIDOS ================= */

function isOrderAlreadyProcessed(externalId) {
  const mk = getMarketplaceState();
  return mk.onlineOrders.some(o => o.externalId === externalId);
}

function processNewOrder(order) {
  if (isOrderAlreadyProcessed(order.externalId)) return false;

  const mk = getMarketplaceState();

  const normalizedOrder = {
    id: Date.now(),
    externalId: order.externalId,
    platform: order.platform,
    platformName: order.platformName,
    status: order.status,
    total: order.total,
    items: order.items || [],
    buyerName: order.buyerName,
    createdAt: order.createdAt || new Date().toISOString(),
    processedAt: new Date().toISOString()
  };

  mk.onlineOrders.unshift(normalizedOrder);

  // Baixa estoque
  deductStock(order.items, order.platformName, order.externalId);

  // Histórico
  addHistory(
    'Marketplace',
    `Pedido ${order.externalId} — ${order.platformName} — ${order.buyerName}`,
    order.total
  );

  persist();
  renderFinance();
  renderReports();
  renderMarketplace();

  showSyncNotification(order.platformName, order.externalId, order.total);

  return true;
}

function showSyncNotification(platformName, orderId, total) {
  const container = document.getElementById('marketplaceSyncLog');
  if (!container) return;

  const entry = document.createElement('div');
  entry.className = 'marketplace-sync-entry';
  entry.innerHTML = `
    <span class="marketplace-sync-platform">${_esc(platformName)}</span>
    <span class="marketplace-sync-text">Pedido <strong>#${_esc(String(orderId).slice(-6))}</strong> recebido — ${formatCurrency(total)}</span>
    <span class="marketplace-sync-time">${new Date().toLocaleTimeString('pt-BR')}</span>
  `;

  container.insertBefore(entry, container.firstChild);

  // Mantém só os últimos 20 logs
  while (container.children.length > 20) {
    container.removeChild(container.lastChild);
  }
}

/* ================= POLLING ================= */

async function syncPlatform(platformId) {
  if (!isConnected(platformId)) return;

  const mk = getMarketplaceState();
  const platform = PLATFORMS[platformId];

  try {
    updateSyncStatus(platformId, 'syncing');

    const orders = await fetchOrders(platformId);
    let newCount = 0;

    orders.forEach(order => {
      if (processNewOrder(order)) newCount++;
    });

    mk.lastSync[platformId] = new Date().toISOString();
    persist();

    updateSyncStatus(platformId, 'ok', newCount);
  } catch (error) {
    console.error(`[Marketplace] Erro ao sincronizar ${platform.name}:`, error);
    updateSyncStatus(platformId, 'error', 0, error.message);
  }
}

function updateSyncStatus(platformId, status, newOrders = 0, errorMsg = '') {
  const mk = getMarketplaceState();
  if (status === 'error' && mk.credentials[platformId]) {
    mk.credentials[platformId].syncError = errorMsg || 'Falha na conexão';
    persist();
  } else if (status === 'ok' && mk.credentials[platformId]) {
    delete mk.credentials[platformId].syncError;
    persist();
  }

  const el = document.getElementById(`mk-sync-${platformId}`);
  if (!el) return;
  const labels = {
    syncing: '⟳ Sincronizando...',
    ok: newOrders > 0 ? `✓ ${newOrders} novo(s) pedido(s)` : '✓ Em dia',
    error: `✗ ${errorMsg || 'Falha na conexão'}`
  };
  el.textContent = labels[status] || status;
  el.classList.toggle('txt-danger',  status === 'error');
  el.classList.toggle('txt-success', status === 'ok');
  el.classList.toggle('txt-blue',    status === 'syncing');
}

function startPolling(platformId, intervalMinutes = 5) {
  stopPolling(platformId);

  // Sincroniza imediatamente
  syncPlatform(platformId);

  // Depois a cada N minutos
  pollingIntervals[platformId] = setInterval(() => {
    syncPlatform(platformId);
  }, intervalMinutes * 60 * 1000);
}

function stopPolling(platformId) {
  if (pollingIntervals[platformId]) {
    clearInterval(pollingIntervals[platformId]);
    delete pollingIntervals[platformId];
  }
}

function startAllPolling() {
  Object.keys(PLATFORMS).forEach(platformId => {
    if (isConnected(platformId)) {
      startPolling(platformId);
    }
  });
}

/* ================= RENDER HELPERS ================= */

const MK_LOGOS = {
  mercadolivre: `<div class="mkl-logo mkl-ml"><span>mercado<br>livre</span></div>`,
  shopee:       `<div class="mkl-logo mkl-shopee"><span>Shopee</span></div>`,
  amazon:       `<div class="mkl-logo mkl-amazon"><span>amazon</span></div>`,
  magalu:       `<div class="mkl-logo mkl-magalu"><span>magalu</span></div>`,
  ifood:        `<div class="mkl-logo mkl-ifood"><span>iFood</span></div>`
};

function _mkRelTime(isoOrDate) {
  if (!isoOrDate) return null;
  const d = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  if (isNaN(d)) return null;
  const mins = Math.round((Date.now() - d) / 60000);
  if (mins < 1)  return 'Agora';
  if (mins < 60) return `Há ${mins} min`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24)  return `Há ${hrs}h`;
  return formatDateTimeBR(d);
}

function computeGlobalMkMetrics() {
  const mk = getMarketplaceState();
  const orders = mk.onlineOrders || [];
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const yestStart  = new Date(todayStart); yestStart.setDate(yestStart.getDate() - 1);

  const todayOrders = orders.filter(o => new Date(o.createdAt) >= todayStart);
  const yestOrders  = orders.filter(o => { const d = new Date(o.createdAt); return d >= yestStart && d < todayStart; });

  const products = new Set();
  orders.forEach(o => (o.items || []).forEach(i => products.add(i.sku || i.name || i.code)));

  const totalRev = orders.reduce((s, o) => s + Number(o.total || 0), 0);
  const todayRev = todayOrders.reduce((s, o) => s + Number(o.total || 0), 0);
  const yestRev  = yestOrders.reduce((s, o) => s + Number(o.total || 0), 0);

  const connected = Object.keys(PLATFORMS).filter(id => isConnected(id));
  const total     = Object.keys(PLATFORMS).length;

  const lastSyncs = Object.values(mk.lastSync || {}).filter(Boolean).map(s => new Date(s));
  const lastSync  = lastSyncs.length ? new Date(Math.max(...lastSyncs)) : null;

  const pct = (c, p) => p > 0 ? ((c - p) / p * 100).toFixed(1) : null;

  return {
    connectedCount: connected.length, total,
    todayOrders: todayOrders.length, yestOrders: yestOrders.length,
    productsCount: products.size,
    totalRevenue: totalRev, todayRevenue: todayRev, yestRevenue: yestRev,
    lastSync,
    ordersPct: pct(todayOrders.length, yestOrders.length),
    revenuePct: pct(todayRev, yestRev)
  };
}

function computePlatformMetrics(platformId) {
  const orders = getMarketplaceState().onlineOrders || [];
  const today  = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const platOrders = orders.filter(o => o.platform === platformId);
  const todayOrders = platOrders.filter(o => new Date(o.createdAt) >= todayStart);
  const revenue = platOrders.reduce((s, o) => s + Number(o.total || 0), 0);
  const products = new Set();
  platOrders.forEach(o => (o.items || []).forEach(i => products.add(i.sku || i.name || i.code)));
  return { pedidosHoje: todayOrders.length, produtos: products.size, faturamento: revenue };
}

function computeLast7DaysOrders() {
  const orders = getMarketplaceState().onlineOrders || [];
  const days   = 7;
  const labels = [];
  const today  = new Date();
  today.setHours(0,0,0,0);
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today); d.setDate(d.getDate() - i);
    labels.push(`${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`);
  }
  const datasets = {};
  Object.values(PLATFORMS).forEach(p => { datasets[p.id] = new Array(days).fill(0); });
  orders.forEach(o => {
    const d = new Date(o.createdAt); d.setHours(0,0,0,0);
    const diff = Math.round((today - d) / 86400000);
    if (diff >= 0 && diff < days && datasets[o.platform]) {
      datasets[o.platform][days - 1 - diff]++;
    }
  });
  return { labels, datasets };
}

function computeRevenueByPlatform() {
  const orders = getMarketplaceState().onlineOrders || [];
  const rev = {};
  Object.values(PLATFORMS).forEach(p => { rev[p.id] = 0; });
  orders.forEach(o => { if (rev[o.platform] !== undefined) rev[o.platform] += Number(o.total || 0); });
  return rev;
}

function computeTopProducts() {
  const orders = getMarketplaceState().onlineOrders || [];
  const map = {};
  orders.forEach(o => (o.items || []).forEach(item => {
    const key = item.name || item.code || 'Produto';
    map[key] = (map[key] || 0) + Number(item.quantity || 1);
  }));
  return Object.entries(map).sort((a,b)=>b[1]-a[1]).slice(0,5);
}

/* ================= RENDER ================= */

export function renderMarketplace() {
  renderMkKpis();
  renderMkChannelsRows();
  renderMkActivityPanel();
  renderMkAnalyticsSection();
}

function renderMkKpis() {
  const el = document.getElementById('mkKpiStrip');
  if (!el) return;
  const m = computeGlobalMkMetrics();
  const pctBadge = (pct, invert) => {
    if (pct === null) return '';
    const up = invert ? pct < 0 : pct >= 0;
    const arrow = pct >= 0 ? '↑' : '↓';
    return `<span class="${up ? 'mk-pct-up' : 'mk-pct-down'}">${arrow}${Math.abs(pct)}% vs ontem</span>`;
  };
  const connPct = m.total > 0 ? Math.round(m.connectedCount / m.total * 100) : 0;
  const lastSyncText  = m.lastSync ? _mkRelTime(m.lastSync) : '—';
  const lastSyncDate  = m.lastSync ? formatDateTimeBR(m.lastSync) : '—';

  el.innerHTML = `
    <div class="mk-kpi-card">
      <div class="mk-kpi-icon mk-kpi-ico-blue">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
      </div>
      <div class="mk-kpi-body">
        <span>Marketplaces conectados</span>
        <strong>${m.connectedCount} / ${m.total}</strong>
        <small>${connPct}% dos canais ativos</small>
        <div class="mk-kpi-bar"><div class="mk-kpi-bar-fill"></div></div>
      </div>
    </div>
    <div class="mk-kpi-card">
      <div class="mk-kpi-icon mk-kpi-ico-green">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>
      </div>
      <div class="mk-kpi-body">
        <span>Pedidos sincronizados hoje</span>
        <strong>${m.todayOrders.toLocaleString('pt-BR')}</strong>
        ${pctBadge(m.ordersPct, false)}
      </div>
    </div>
    <div class="mk-kpi-card">
      <div class="mk-kpi-icon mk-kpi-ico-purple">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
      </div>
      <div class="mk-kpi-body">
        <span>Produtos sincronizados</span>
        <strong>${m.productsCount.toLocaleString('pt-BR')}</strong>
        <small>Atualizados ${m.lastSync ? _mkRelTime(m.lastSync) : 'em breve'}</small>
      </div>
    </div>
    <div class="mk-kpi-card">
      <div class="mk-kpi-icon mk-kpi-ico-amber">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v12M15 9H10.5a2.5 2.5 0 0 0 0 5h3a2.5 2.5 0 0 1 0 5H9"/></svg>
      </div>
      <div class="mk-kpi-body">
        <span>Receita por canais</span>
        <strong>${formatCurrency(m.totalRevenue)}</strong>
        ${pctBadge(m.revenuePct, false)}
      </div>
    </div>
    <div class="mk-kpi-card">
      <div class="mk-kpi-icon mk-kpi-ico-blue">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      </div>
      <div class="mk-kpi-body">
        <span>Última sincronização</span>
        <strong>${lastSyncText}</strong>
        <small class="txt-blue">${lastSyncDate}</small>
      </div>
    </div>
  `;
  const barFill = el.querySelector('.mk-kpi-bar-fill');
  if (barFill) barFill.style.width = connPct + '%';
}

function renderMkChannelsRows() {
  const el = document.getElementById('mkChannelsBody');
  if (!el) return;
  const mk = getMarketplaceState();

  el.innerHTML = Object.values(PLATFORMS).map(platform => {
    const connected   = isConnected(platform.id);
    const creds       = getCredentials(platform.id);
    const hasError    = creds?.syncError;
    const lastSync    = mk.lastSync?.[platform.id];
    const metrics     = connected ? computePlatformMetrics(platform.id) : null;
    const logo        = MK_LOGOS[platform.id] || `<div class="mkl-logo" data-mkl-bg="${platform.color}" data-mkl-fg="${platform.textColor}">${platform.name}</div>`;

    let badgeHtml, syncHtml, actionHtml;

    if (connected && !hasError) {
      badgeHtml = `<span class="mk-badge mk-badge-connected">● Conectado</span>`;
      syncHtml  = `<div class="mk-sync-info">Última sincronização<br><span class="mk-sync-ok">${lastSync ? _mkRelTime(lastSync) : '—'}</span></div>`;
      actionHtml = `
        <button class="btn btn-ghost mk-ch-btn" onclick="window.marketplaceSync('${platform.id}')">Ver pedidos</button>
        <button class="mk-dots-btn" onclick="window.mkRowMenu('${platform.id}', this)" title="Mais opções">⋯</button>
      `;
    } else if (hasError) {
      badgeHtml = `<span class="mk-badge mk-badge-error">○ Erro de conexão</span>`;
      syncHtml  = `<div class="mk-sync-info">Falha ao conectar API<br><span class="mk-err-link" onclick="window.marketplaceOpenConfig('${platform.id}')">Ver detalhes</span></div>`;
      actionHtml = `
        <button class="btn btn-ghost mk-ch-btn" onclick="window.marketplaceOpenConfig('${platform.id}')">Tentar novamente</button>
        <button class="mk-dots-btn" onclick="window.mkRowMenu('${platform.id}', this)" title="Mais opções">⋯</button>
      `;
    } else {
      badgeHtml = `<span class="mk-badge mk-badge-disconnected">○ Desconectado</span>`;
      syncHtml  = `<div class="mk-sync-info">Conecte sua conta para<br>começar a vender</div>`;
      actionHtml = `
        <button class="btn btn-primary mk-ch-btn-wide" onclick="window.marketplaceOpenConfig('${platform.id}')">Conectar agora</button>
        <button class="mk-dots-btn" onclick="window.mkRowMenu('${platform.id}', this)" title="Mais opções">⋯</button>
      `;
    }

    return `
      <div class="mk-channel-row">
        <div class="mk-ch-logo">${logo}</div>
        <div class="mk-ch-info">
          <div class="mk-ch-name">${platform.name}</div>
          <div class="mk-ch-sub">Brasil</div>
        </div>
        <div class="mk-ch-status">
          ${badgeHtml}
          ${syncHtml}
        </div>
        <div class="mk-ch-metric">
          <span>Pedidos hoje</span>
          <strong>${connected && !hasError ? metrics.pedidosHoje : '—'}</strong>
          ${connected && !hasError && metrics.pedidosHoje > 0 ? `<small class="txt-success">Ativos</small>` : ''}
        </div>
        <div class="mk-ch-metric">
          <span>Produtos</span>
          <strong>${connected && !hasError ? metrics.produtos : '—'}</strong>
          ${connected && !hasError && metrics.produtos > 0 ? `<small class="txt-success">Ativos</small>` : ''}
        </div>
        <div class="mk-ch-metric">
          <span>Faturamento</span>
          <strong>${connected && !hasError ? formatCurrency(metrics.faturamento) : '—'}</strong>
        </div>
        <div class="mk-ch-actions">${actionHtml}</div>
        <div id="mk-sync-${platform.id}" class="hidden"></div>
      </div>
    `;
  }).join('');
  el.querySelectorAll('[data-mkl-bg]').forEach(logoEl => {
    logoEl.style.background = logoEl.dataset.mklBg;
    logoEl.style.color = logoEl.dataset.mklFg;
  });
}

function renderMkActivityPanel() {
  const el = document.getElementById('marketplaceSyncLog');
  if (!el) return;
  if (!el.children.length || el.querySelector('.muted')) {
    el.innerHTML = '<div class="mk-empty-row">Nenhuma atividade recente.</div>';
  }
}

function renderMkAnalyticsSection() {
  const lineEl   = document.getElementById('mkOrdersChartCanvas');
  const donutEl  = document.getElementById('mkRevenueChartCanvas');
  const topEl    = document.getElementById('mkTopProducts');
  const badgeEl  = document.getElementById('mkTotalRevBadge');

  const revByPlat = computeRevenueByPlatform();
  const totalRev  = Object.values(revByPlat).reduce((s,v) => s+v, 0);
  if (badgeEl) badgeEl.textContent = formatCurrency(totalRev);

  // Legend for donut
  const legendEl = document.getElementById('mkDonutLegend');
  if (legendEl) {
    legendEl.innerHTML = Object.values(PLATFORMS).map(p => {
      const rev = revByPlat[p.id] || 0;
      const pct = totalRev > 0 ? ((rev / totalRev) * 100).toFixed(1) : '0';
      return `<div class="mk-donut-legend-row">
        <span><span class="mk-legend-dot" data-pid="${p.id}"></span>${p.name}</span>
        <span>${pct}%&nbsp;&nbsp;<strong>${formatCurrency(rev)}</strong></span>
      </div>`;
    }).join('');
  }

  // Top products
  if (topEl) {
    const tops = computeTopProducts();
    topEl.innerHTML = tops.length
      ? tops.map(([name, qty], i) => `
          <div class="mk-top-row">
            <span class="mk-top-rank">${i+1}</span>
            <span class="mk-top-name">${_esc(name)}</span>
            <span class="mk-top-qty">${Number(qty)} vendas</span>
          </div>
        `).join('')
      : '<div class="mk-empty-row">Sem dados de vendas ainda.</div>';
  }

  if (typeof Chart === 'undefined') return;

  const platColors = { mercadolivre:'#ffe600', shopee:'#ee4d2d', amazon:'#ff9900', magalu:'#0040D0', ifood:'#ea1d2c' };
  const baseGrid = { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: 'rgba(238,243,255,0.4)', font: { size: 10 } } };

  // Line chart — Pedidos por marketplace
  if (lineEl) {
    if (lineEl._chart) lineEl._chart.destroy();
    const { labels, datasets } = computeLast7DaysOrders();
    lineEl._chart = new Chart(lineEl, {
      type: 'line',
      data: {
        labels,
        datasets: Object.values(PLATFORMS).map(p => ({
          label: p.name,
          data: datasets[p.id] || [],
          borderColor: platColors[p.id] || '#64748b',
          backgroundColor: 'transparent',
          tension: 0.4, pointRadius: 3, borderWidth: 2
        }))
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: true, labels: { color: 'rgba(238,243,255,0.6)', font: { size: 9 }, boxWidth: 10, padding: 8 } },
          tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.raw}` } }
        },
        scales: { x: baseGrid, y: { ...baseGrid, beginAtZero: true, ticks: { ...baseGrid.ticks, callback: v => Math.round(v) } } }
      }
    });
  }

  // Donut chart — Faturamento por canal
  if (donutEl) {
    if (donutEl._chart) donutEl._chart.destroy();
    const platIds = Object.keys(PLATFORMS);
    donutEl._chart = new Chart(donutEl, {
      type: 'doughnut',
      data: {
        labels: Object.values(PLATFORMS).map(p => p.name),
        datasets: [{ data: platIds.map(id => revByPlat[id] || 0), backgroundColor: platIds.map(id => platColors[id] || '#64748b'), borderWidth: 0, hoverOffset: 4 }]
      },
      options: {
        cutout: '65%',
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${formatCurrency(ctx.raw)}` } } },
        animation: { duration: 400 }
      }
    });
  }
}

function renderOrdersTable() {
  const tbody = document.getElementById('marketplaceOrdersTableBody');
  if (!tbody) return;
  const orders = getMarketplaceState().onlineOrders.slice(0, 20);
  if (!orders.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="mk-td-empty">Nenhum pedido recebido ainda.</td></tr>';
    return;
  }
  tbody.innerHTML = orders.map(o => `
    <tr>
      <td class="mk-td-muted">${formatDateTimeBR(o.createdAt)}</td>
      <td><span class="marketplace-platform-pill platform-${_esc(o.platform)}">${_esc(o.platformName)}</span></td>
      <td class="mk-td-muted">#${_esc(String(o.externalId).slice(-8))}</td>
      <td class="mk-td-sm">${_esc(o.buyerName)}</td>
      <td class="mk-td-muted">${o.items?.length || '—'} item(s)</td>
      <td><strong>${formatCurrency(o.total)}</strong></td>
    </tr>
  `).join('');
}

function renderSyncLog() {
  renderMkActivityPanel();
}

/* ================= MODAL DE CONFIGURAÇÃO ================= */

function openConfigModal(platformId) {
  const platform = PLATFORMS[platformId];
  if (!platform) return;

  const existing = getCredentials(platformId) || {};

  let modal = document.getElementById('marketplaceConfigModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'marketplaceConfigModal';
    modal.className = 'overlay';
    document.body.appendChild(modal);
  }

  modal.innerHTML = `
    <div class="modal modal-max-520">
      <div class="modal-head">
        <div>
          <span class="tag tag-primary">Integração</span>
          <h3>${platform.icon} ${platform.name}</h3>
          <p class="mini">Configure suas credenciais de API para ativar a integração real.</p>
        </div>
        <button class="close-btn" onclick="document.getElementById('marketplaceConfigModal').classList.add('hidden')">✕</button>
      </div>

      <div class="marketplace-setup-steps">
        <h4 class="mk-steps-head">Como obter suas credenciais:</h4>
        <ol class="marketplace-steps-list">
          ${platform.setupSteps.map(s => `<li class="mini">${s}</li>`).join('')}
        </ol>
        <a href="${platform.docsUrl}" target="_blank" rel="noopener" class="marketplace-docs-link mini">
          📄 Ver documentação oficial →
        </a>
      </div>

      <div class="mk-fields-wrap">
        ${platform.fields.map(f => `
          <div class="field-group">
            <label>${f.label}</label>
            <input
              id="mkCred_${f.key}"
              class="field"
              type="${f.type || 'text'}"
              placeholder="${f.placeholder}"
              value="${_esc(existing[f.key] || '')}"
            />
          </div>
        `).join('')}
      </div>

      <div id="marketplaceConfigStatus" class="notice mk-cfg-status hidden"></div>

      <div class="hero-actions compact mk-cfg-actions">
        <button
          class="btn btn-primary"
          onclick="window.marketplaceSaveConfig('${platformId}')"
        >
          Salvar e conectar
        </button>
        <button
          class="btn btn-ghost"
          onclick="document.getElementById('marketplaceConfigModal').classList.add('hidden')"
        >
          Cancelar
        </button>
      </div>
    </div>
  `;

  modal.classList.remove('hidden');

  modal.addEventListener('click', e => {
    if (e.target === modal) modal.classList.add('hidden');
  });
}

function saveConfig(platformId) {
  const platform = PLATFORMS[platformId];
  if (!platform) return;

  const fields = {};
  let allFilled = true;

  platform.fields.forEach(f => {
    const input = document.getElementById(`mkCred_${f.key}`);
    const value = String(input?.value || '').trim();
    fields[f.key] = value;
    if (!value) allFilled = false;
  });

  const statusEl = document.getElementById('marketplaceConfigStatus');

  if (!allFilled) {
    if (statusEl) {
      statusEl.textContent = 'Preencha todos os campos antes de conectar.';
      statusEl.classList.remove('hidden', 'mkt-cfg-status--ok');
      statusEl.classList.add('mkt-cfg-status--err');
    }
    return;
  }

  saveCredentials(platformId, fields);

  if (statusEl) {
    statusEl.textContent = `${platform.name} conectado! Iniciando sincronização...`;
    statusEl.classList.remove('hidden', 'mkt-cfg-status--err');
    statusEl.classList.add('mkt-cfg-status--ok');
  }

  setTimeout(() => {
    document.getElementById('marketplaceConfigModal')?.classList.add('hidden');
    renderMarketplace();
    startPolling(platformId);
  }, 1200);
}

/* ================= HTML EXTRA PARA O INDEX ================= */

/**
 * Injeta os elementos HTML necessários na seção marketplace do index.html.
 * Chamado uma vez durante initMarketplace().
 * Se preferir, cole o bloco comentado abaixo diretamente no HTML.
 */
function injectMarketplaceHTML() {
  const section = document.querySelector('[data-page-content="marketplace"]');
  if (!section || section.dataset.mkInjected === 'true') return;
  section.dataset.mkInjected = 'true';

  section.innerHTML = `
    <div class="mk-shell">

      <!-- HEADER -->
      <div class="mk-page-head">
        <div>
          <h2 class="mk-page-title">Marketplace</h2>
          <p class="mk-page-sub">
            Conecte e gerencie seus canais de venda externos.&nbsp;
            <span class="mk-learn-link" onclick="window.marketplaceOpenNewModal()">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mk-learn-ico"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              Saiba mais sobre integrações
            </span>
          </p>
        </div>
        <button class="btn btn-ghost mk-help-btn" onclick="alert('Central de Ajuda — em breve.')">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="mk-help-ico"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          Central de Ajuda
        </button>
      </div>

      <!-- LAYOUT: center + right sidebar -->
      <div class="mk-main-layout">

        <!-- CENTER COLUMN -->
        <div class="mk-center-col">

          <!-- 5 KPI cards -->
          <div id="mkKpiStrip" class="mk-kpi-strip"></div>

          <!-- Seus canais de venda -->
          <div class="mk-channels-card">
            <div class="mk-channels-head">
              <h3>Seus canais de venda</h3>
              <div class="mk-channels-acts">
                <button class="btn btn-ghost mk-sync-all-btn" onclick="window.marketplaceSyncAll()">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>
                  Sincronizar todos
                </button>
                <div class="mk-batch-drop">
                  <button class="btn btn-ghost mk-batch-btn" onclick="this.nextElementSibling.classList.toggle('hidden')">
                    Ações em lote&nbsp;▾
                  </button>
                  <div class="mk-drop-menu hidden">
                    <button onclick="window.marketplaceSyncAll();this.closest('.mk-drop-menu').classList.add('hidden')">Sincronizar todos</button>
                    <button onclick="Object.keys(window._mkPlatforms||{}).forEach(id=>window.marketplaceDisconnect&&window.marketplaceDisconnect(id));this.closest('.mk-drop-menu').classList.add('hidden')">Desconectar todos</button>
                  </div>
                </div>
              </div>
            </div>

            <!-- Channel rows -->
            <div id="mkChannelsBody"></div>

            <!-- Connect new -->
            <button class="mk-connect-new-btn" onclick="window.marketplaceOpenNewModal()">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Conectar novo marketplace
            </button>
          </div>

          <!-- Analytics row: 3 cards -->
          <div class="mk-analytics-row">

            <!-- Line chart: orders by platform -->
            <div class="mk-analytics-card">
              <div class="mk-an-head">
                <h3>Pedidos por marketplace</h3>
                <span class="mk-an-period">últimos 7 dias</span>
              </div>
              <div class="dashboard-chart-wrap mk-chart-wrap">
                <canvas id="mkOrdersChartCanvas"></canvas>
              </div>
            </div>

            <!-- Donut chart: revenue by channel -->
            <div class="mk-analytics-card">
              <div class="mk-an-head"><h3>Faturamento por canal</h3></div>
              <div class="mk-donut-wrap">
                <div class="mk-donut-canvas">
                  <canvas id="mkRevenueChartCanvas" width="100" height="100"></canvas>
                </div>
                <div id="mkDonutLegend" class="mk-donut-legend"></div>
              </div>
              <div class="mk-donut-total">
                <span class="mk-total-lbl">Total</span>
                <strong id="mkTotalRevBadge">R$ 0,00</strong>
              </div>
            </div>

            <!-- Top products ranking -->
            <div class="mk-analytics-card">
              <div class="mk-an-head"><h3>Produtos mais vendidos</h3><span class="mk-an-period">todos os canais</span></div>
              <div id="mkTopProducts"></div>
              <button class="panel-link-btn mk-all-prods" onclick="window.openPageDirect?.('estoque')">Ver todos os produtos →</button>
            </div>

          </div>

        </div><!-- /mk-center-col -->

        <!-- RIGHT SIDEBAR -->
        <div class="mk-side-col">

          <!-- Activity log -->
          <div class="mk-side-card">
            <h3 class="mk-card-title">Atividade recente</h3>
            <div id="marketplaceSyncLog" class="mk-activity-log"></div>
            <button class="panel-link-btn mk-hist-btn">Ver histórico completo →</button>
          </div>

          <!-- Tips -->
          <div class="mk-side-card mk-tips-card">
            <h3 class="mk-card-title">Dicas para vender mais</h3>
            <div class="mk-tips-list">
              <div class="mk-tip-item">
                <div class="mk-tip-ico mk-tip-ico-green">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
                </div>
                <div>
                  <div class="mk-tip-title">Ative todos os canais</div>
                  <div class="mk-tip-sub">Conecte mais marketplaces e aumente seu alcance.</div>
                </div>
              </div>
              <div class="mk-tip-item">
                <div class="mk-tip-ico mk-tip-ico-blue">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
                </div>
                <div>
                  <div class="mk-tip-title">Mantenha seus produtos atualizados</div>
                  <div class="mk-tip-sub">Produtos atualizados vendem até 30% mais.</div>
                </div>
              </div>
              <div class="mk-tip-item">
                <div class="mk-tip-ico mk-tip-ico-purple">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                </div>
                <div>
                  <div class="mk-tip-title">Responda rápido aos pedidos</div>
                  <div class="mk-tip-sub">Agilidade aumenta suas vendas e sua reputação.</div>
                </div>
              </div>
            </div>
            <button class="panel-link-btn mk-tips-link">Ver todas as dicas →</button>
          </div>

        </div><!-- /mk-side-col -->

      </div><!-- /mk-main-layout -->

    </div><!-- /mk-shell -->
  `;
}

function openNewMarketplaceModal() {
  let modal = document.getElementById('mkNewModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'mkNewModal';
    modal.className = 'overlay';
    document.body.appendChild(modal);
  }

  const comingSoon = [
    { name: 'Elo7', icon: '🎁', color: '#ff6b35' },
    { name: 'OLX', icon: '🏷️', color: '#8b5cf6' },
    { name: 'Americanas', icon: '🛒', color: '#ef4444' },
    { name: 'Casas Bahia', icon: '🏠', color: '#f59e0b' }
  ];

  modal.innerHTML = `
    <div class="modal modal-max-560">
      <div class="modal-head">
        <div>
          <span class="tag tag-primary">Integração</span>
          <h3>Conectar marketplace</h3>
          <p class="mini">Escolha a plataforma que deseja integrar ao Gamby.</p>
        </div>
        <button class="close-btn" onclick="document.getElementById('mkNewModal').classList.add('hidden')">✕</button>
      </div>

      <div class="mkt-section-label">Disponíveis agora</div>
      <div class="mkt-platform-grid">
        ${Object.values(PLATFORMS).map(p => `
          <button class="mkt-platform-btn" onclick="document.getElementById('mkNewModal').classList.add('hidden');window.marketplaceOpenConfig('${p.id}')">
            <div class="mkt-platform-ico" data-pid="${p.id}">${p.icon}</div>
            <div>
              <div class="mkt-platform-name">${p.name}</div>
              <div class="mkt-platform-hint">Clique para configurar</div>
            </div>
          </button>
        `).join('')}
      </div>

      <div class="mkt-section-label">Em breve</div>
      <div class="mkt-platform-grid">
        ${comingSoon.map(p => `
          <div class="mkt-platform-coming">
            <div class="mkt-platform-ico" data-pid="${p.name.toLowerCase().replace(/\s+/g,'')}">${p.icon}</div>
            <div>
              <div class="mkt-platform-name">${p.name}</div>
              <div class="mkt-hint-soon">Em breve</div>
            </div>
          </div>
        `).join('')}
      </div>

      <button class="btn btn-ghost btn-block mt-16" onclick="document.getElementById('mkNewModal').classList.add('hidden')">Fechar</button>
    </div>
  `;

  modal.classList.remove('hidden');
  modal.addEventListener('click', e => { if (e.target === modal) modal.classList.add('hidden'); });
}

/* ================= INIT ================= */

export function initMarketplace() {
  getMarketplaceState();
  injectMarketplaceHTML();
  renderMarketplace();
  startAllPolling();
}

/* ================= BIND ================= */

export function bindMarketplaceActions() {
  if (marketplaceActionsBound) return;
  marketplaceActionsBound = true;

  window._mkPlatforms = PLATFORMS;
  window.marketplaceOpenConfig = openConfigModal;
  window.marketplaceSaveConfig = saveConfig;
  window.marketplaceSync = syncPlatform;
  window.marketplaceOpenNewModal = openNewMarketplaceModal;
  window.marketplaceDisconnect = (platformId) => {
    if (!confirm(`Desconectar ${PLATFORMS[platformId]?.name}?`)) return;
    disconnectPlatform(platformId);
    renderMarketplace();
  };
  window.marketplaceSyncAll = () => {
    Object.keys(PLATFORMS).forEach(id => {
      if (isConnected(id)) syncPlatform(id);
    });
  };
  window.mkRowMenu = (platformId, btn) => {
    const existing = document.getElementById('mkRowContextMenu');
    if (existing) existing.remove();
    const menu = document.createElement('div');
    menu.id = 'mkRowContextMenu';
    menu.className = 'mk-drop-menu ctx-drop-menu';
    const rect = btn.getBoundingClientRect();
    menu.style.setProperty('--ctx-top',  (rect.bottom + 4) + 'px');
    menu.style.setProperty('--ctx-left', (rect.left - 120) + 'px');
    const connected = isConnected(platformId);
    menu.innerHTML = `
      <button onclick="window.marketplaceOpenConfig('${platformId}');document.getElementById('mkRowContextMenu')?.remove()">Editar configuração</button>
      ${connected ? `<button onclick="window.marketplaceSync('${platformId}');document.getElementById('mkRowContextMenu')?.remove()">Sincronizar agora</button>` : ''}
      ${connected ? `<button class="ctx-drop-item--danger" onclick="window.marketplaceDisconnect('${platformId}');document.getElementById('mkRowContextMenu')?.remove()">Desconectar</button>` : ''}
    `;
    document.body.appendChild(menu);
    setTimeout(() => document.addEventListener('click', () => menu.remove(), { once: true }), 10);
  };
}