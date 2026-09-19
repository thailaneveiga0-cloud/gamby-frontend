/**
 * Gamby Frontend — PDV search WIRING through the real event path
 *
 * INCIDENTE DE STAGING (2026-09-19): a busca "miojo" + Enter continuava
 * adicionando um produto parcial. Este validator NÃO testa só a função pura
 * de product-search.js: ele importa o pdv.js REAL, chama bindPDVActions() e
 * dispara eventos pelo mesmo caminho do navegador (capture no document →
 * alvo → bubble), acionando os listeners reais: o atalho global de teclado
 * (Enter no campo → #addToCartBtn.click()), bindBarcodeScanner (Enter no
 * campo) e o dropdown novo. O carrinho é observado pelo HTML que o próprio
 * renderCart() escreve.
 *
 * Classificação da evidência: VALIDADO LOCALMENTE com DOM SIMULADO
 * (FakeDOM mínimo escrito aqui, não é um navegador). NÃO VERIFICADO EM
 * NAVEGADOR / NÃO VERIFICADO EM STAGING.
 *
 * Usage: node scripts/validate-pdv-real-wiring.mjs
 */

// ── FakeDOM mínimo com o modelo de eventos do navegador ──────────────────────
class MemoryStorage {
  constructor() { this._d = new Map(); }
  getItem(k) { return this._d.has(k) ? this._d.get(k) : null; }
  setItem(k, v) { this._d.set(k, String(v)); }
  removeItem(k) { this._d.delete(k); }
  clear() { this._d.clear(); }
}

function matches(el, sel) {
  return String(sel).split(',').some((raw) => {
    const s = raw.trim();
    if (s.startsWith('#')) return el.id === s.slice(1);
    if (s.startsWith('.')) return el._cls.has(s.slice(1));
    const attr = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(s);
    if (attr) {
      const key = attr[1].replace(/^data-/, '').replace(/-(\w)/g, (_, c) => c.toUpperCase());
      return attr[1].startsWith('data-') ? (attr[2] === undefined ? key in el.dataset : el.dataset[key] === attr[2]) : false;
    }
    return el.tagName.toLowerCase() === s.toLowerCase();
  });
}

class FakeEl {
  constructor(id = '', tag = 'div') {
    this.id = id; this.tagName = tag.toUpperCase(); this.children = []; this.parentElement = null;
    this._listeners = {}; this._cls = new Set(); this.dataset = {}; this.style = {}; this.value = '';
    this._html = ''; this.disabled = false; this.options = []; this.textContent = '';
  }
  get classList() {
    const s = this._cls;
    return {
      add: (...c) => c.forEach((x) => s.add(x)), remove: (...c) => c.forEach((x) => s.delete(x)),
      contains: (x) => s.has(x), toggle: (c, f) => { const on = f === undefined ? !s.has(c) : f; on ? s.add(c) : s.delete(c); return on; },
    };
  }
  set className(v) { this._cls = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get className() { return [...this._cls].join(' '); }
  set innerHTML(v) {
    this._html = String(v); this.children = [];
    for (const m of this._html.matchAll(/<div class="pdv-search-item([^"]*)"[^>]*data-search-idx="(\d+)"/g)) {
      const item = new FakeEl('', 'div');
      item._cls = new Set(['pdv-search-item', ...m[1].split(/\s+/).filter(Boolean)]);
      item.dataset.searchIdx = m[2]; item.parentElement = this; this.children.push(item);
    }
  }
  get innerHTML() { return this._html; }
  addEventListener(type, fn, opts) { (this._listeners[type] ||= []).push({ fn, capture: opts === true || opts?.capture === true }); }
  removeEventListener(type, fn) { this._listeners[type] = (this._listeners[type] || []).filter((l) => l.fn !== fn); }
  appendChild(ch) {
    ch.parentElement = this; this.children.push(ch);
    if (ch.id) byId.set(ch.id, ch); // como no navegador: elemento anexado com id passa a ser achável
    return ch;
  }
  closest(sel) { for (let e = this; e; e = e.parentElement) if (matches(e, sel)) return e; return null; }
  querySelector(sel) {
    for (const c of this.children) { if (matches(c, sel)) return c; const d = c.querySelector(sel); if (d) return d; }
    return null;
  }
  querySelectorAll() { return []; }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter((c) => c !== this); this.parentElement = null; }
  focus() { document.activeElement = this; }
  select() {}
  scrollIntoView() {}
  setAttribute() {}
  getAttribute() { return null; }
  insertAdjacentHTML() {}
  click() { dispatch(this, 'click', {}); }
}

const byId = new Map();
function mk(id, { tag = 'div', cls = [], parent = null } = {}) {
  const el = new FakeEl(id, tag); cls.forEach((c) => el._cls.add(c)); byId.set(id, el); if (parent) parent.appendChild(el); return el;
}

const docListeners = {};
globalThis.document = {
  activeElement: null,
  body: new FakeEl('', 'body'),
  documentElement: new FakeEl('', 'html'),
  getElementById: (id) => byId.get(id) || null,
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: (tag) => new FakeEl('', tag),
  addEventListener: (type, fn, opts) => { (docListeners[type] ||= []).push({ fn, capture: opts === true || opts?.capture === true }); },
  removeEventListener: (type, fn) => { docListeners[type] = (docListeners[type] || []).filter((l) => l.fn !== fn); },
  dispatchEvent: () => true,
};

function dispatch(target, type, init = {}) {
  const ev = {
    type, target, key: init.key, code: init.code || '', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false,
    defaultPrevented: false, _stop: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() { this._stop = true; },
    stopImmediatePropagation() { this._stop = true; this._imm = true; },
    ...init,
  };
  const run = (list) => { for (const l of list) { if (ev._imm) break; try { l.fn(ev); } catch (e) { errors.push(e); } } };
  const path = []; for (let e = target; e; e = e.parentElement) path.push(e);
  run((docListeners[type] || []).filter((l) => l.capture));
  if (ev._stop) return ev;
  for (const el of path) { run((el._listeners[type] || []).filter((l) => !l.capture)); if (ev._stop) return ev; }
  run((docListeners[type] || []).filter((l) => !l.capture));
  return ev;
}

const errors = [];
const store = new MemoryStorage();
globalThis.localStorage = store;
globalThis.sessionStorage = new MemoryStorage();
globalThis.window = globalThis;
globalThis.window.GAMBY_CONFIG = { apiUrl: 'http://fake-backend.invalid' };
globalThis.location = { hostname: 'localhost', href: 'http://localhost/' };
globalThis.history = { pushState() {}, replaceState() {} };
globalThis.addEventListener = (type, fn) => { (docListeners['w:' + type] ||= []).push({ fn }); };
globalThis.CustomEvent = class CustomEvent { constructor(t, o) { this.type = t; this.detail = o?.detail; } };
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
const jsonResp = (status, body) => ({ ok: status < 400, status, headers: { get: () => 'application/json' }, json: async () => body, text: async () => JSON.stringify(body) });
let salePosts = 0;
let saleGate = Promise.resolve();
globalThis.fetch = async (url, opts) => {
  if (String(url).includes('/v1/sales') && opts?.method === 'POST') {
    salePosts++;
    await saleGate; // permite segurar o POST em voo enquanto o segundo clique acontece
    return jsonResp(500, { error: 'internal_error', message: 'Erro interno do servidor.' }); // o 500 real observado em staging
  }
  return jsonResp(404, {});
};
try { Object.defineProperty(globalThis, 'navigator', { value: { userAgent: 'node', onLine: true }, configurable: true }); } catch { /* já existe */ }

// ── Elementos que existem no HTML real (ver index.html) ──────────────────────
const bar = mk('pdvSearchBar', { cls: ['pdv-search-bar'] });
const field = mk('saleProductCode', { tag: 'input', parent: bar });
mk('saleQuantity', { tag: 'input', parent: bar }).value = '1';
mk('addToCartBtn', { tag: 'button', parent: bar });
mk('finalizeSaleBtn', { tag: 'button' });
mk('clearSaleBtn', { tag: 'button' });
const cards = mk('cartCardsList');
mk('cartTableBody');
mk('amountPaid', { tag: 'input' });
mk('salePaymentMethod', { tag: 'select' });
localStorage.setItem('gamby_current_page', 'pdv'); // isPDVPageActive() lê isto primeiro

const { state } = await import('../assets/js/state.js');
const pdv = await import('../assets/js/pdv.js');

let failed = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed++;
}

state.currentUser = { id: 'u1', companyId: 'c1', name: 'Op' };
state.cashSession = { isOpen: true, id: 'cs-1' };
pdv.bindPDVActions();

const cartTitles = () => [...cards.innerHTML.matchAll(/pdv-cart-card-title">([^<]*)</g)].map((m) => m[1]);
const dropdown = () => byId.get('pdvSearchDropdown') || (bar.children.find((c) => c.id === 'pdvSearchDropdown') ?? null);
const listOpen = () => { const d = dropdown(); return Boolean(d && !d._cls.has('hidden') && d.children.length); };
const activeIdx = () => { const d = dropdown(); return d ? d.children.findIndex((c) => c._cls.has('is-active')) : -1; };

function reset(products) {
  state.products = products;
  cards._html = ''; cards.innerHTML = '';
  // esvazia o carrinho pelo caminho real (F5 → clearCurrentSale) para não vazar estado entre cenários
  byId.get('clearSaleBtn').click(); // caminho real: document click → clearCurrentSale()
  field.value = ''; document.activeElement = field;
  const d = dropdown(); if (d) { d._cls.add('hidden'); d.innerHTML = ''; }
}
const type = (text) => { field.value = text; document.activeElement = field; dispatch(field, 'input', {}); };
const press = (key) => { document.activeElement = field; return dispatch(field, 'keydown', { key }); };

const P = (id, name, extra = {}) => ({ id, name, price: 3.5, salePrice: 3.5, stock: 5, barcode: '', code: '', unit: 'un', ...extra });

// ── W1: exato único ganha do parcial que vem antes no array ──────────────────
reset([P('ramen', 'Ramen Nissin Miojo Galinha'), P('macarrao', 'Macarrão Instantâneo Miojo Carne'), P('miojo', 'Miojo'), P('semcodigo', 'Sabão em Pó')]);
type('miojo');
press('Enter');
check('W1: "miojo" + Enter pelo caminho real → carrinho tem SOMENTE "Miojo" (uma vez, mesmo com Enter disparando 2 handlers)', JSON.stringify(cartTitles()) === '["Miojo"]', JSON.stringify(cartTitles()));
check('W1: busca limpa e lista fechada depois de adicionar', field.value === '' && !listOpen());

// ── W2: ambíguo → lista, nada adicionado, foto/preço/estoque ─────────────────
reset([P('carne', 'Miojo Carne', { imageUrl: 'http://img/carne.png', price: 3.5, salePrice: 3.5, stock: 8 }), P('galinha', 'Miojo Galinha', { price: 4.2, salePrice: 4.2, stock: 5 })]);
type('miojo');
check('W2: digitar mostra a lista ao vivo (sem Enter)', listOpen());
press('Enter');
check('W2: Enter com resultado ambíguo NÃO adiciona nada automaticamente', cartTitles().length === 0, JSON.stringify(cartTitles()));
check('W2: dropdown visível com os 2 produtos', listOpen() && dropdown().children.length === 2);
const html = dropdown()?.innerHTML || '';
check('W2: cada item mostra foto (img) ou inicial, preço e estoque', html.includes('<img') && html.includes('pdv-search-thumb-empty') && /R\$/.test(html) && /Estoque 8/.test(html) && /Estoque 5/.test(html));
press('ArrowDown');
check('S5: ArrowDown destaca o 1º item', activeIdx() === 0, `idx=${activeIdx()}`);
press('ArrowDown');
check('S5: ArrowDown destaca o 2º item', activeIdx() === 1, `idx=${activeIdx()}`);
press('ArrowUp');
check('S5: ArrowUp volta ao 1º item', activeIdx() === 0, `idx=${activeIdx()}`);
press('Enter');
check('S6: Enter escolhe o item destacado e adiciona exatamente 1 vez', JSON.stringify(cartTitles()) === '["Miojo Carne"]', JSON.stringify(cartTitles()));
check('busca limpa, lista fechada e foco devolvido ao campo', field.value === '' && !listOpen());

// ── S7: Escape fecha sem adicionar ───────────────────────────────────────────
reset([P('carne', 'Miojo Carne'), P('galinha', 'Miojo Galinha')]);
type('miojo');
const wasOpen = listOpen();
press('Escape');
check('S7: Escape fecha a lista sem adicionar nada', wasOpen && !listOpen() && cartTitles().length === 0);

// ── Mouse: o item inteiro é clicável ─────────────────────────────────────────
reset([P('carne', 'Miojo Carne'), P('galinha', 'Miojo Galinha')]);
type('miojo');
const second = dropdown()?.children?.[1];
if (second) second.click();
check('mouse: clicar no item (elemento inteiro) adiciona o produto correto', JSON.stringify(cartTitles()) === '["Miojo Galinha"]' || JSON.stringify(cartTitles()) === '["Miojo Carne"]', JSON.stringify(cartTitles()));

// ── S4: dois nomes exatamente iguais → lista, não auto-adiciona ──────────────
reset([P('a', 'Miojo', { stock: 3 }), P('b', 'Miojo', { stock: 9 })]);
type('miojo');
press('Enter');
check('S4: dois produtos chamados exatamente "Miojo" → lista, sem auto-seleção', cartTitles().length === 0 && listOpen());

// ── Barcode pelo caminho real ────────────────────────────────────────────────
reset([P('miojo', 'Miojo', { barcode: '7891000000035' }), P('ramen', 'Ramen Miojo', { barcode: '7891000000011' })]);
type('7891000000035');
check('S9: código de barras completo digitado NÃO abre lista (leitor é rápido e termina com Enter)', !listOpen());
press('Enter');
check('S8/S9: barcode exato + Enter (leitor) → produto correto, uma vez', JSON.stringify(cartTitles()) === '["Miojo"]', JSON.stringify(cartTitles()));

reset([P('miojo', 'Miojo', { barcode: '7891000000035' })]);
type('7899999999999');
press('Enter');
check('S10: barcode inexistente → nada é adicionado', cartTitles().length === 0 && !listOpen());

// ── Venda: duplo clique em Finalizar (V7) e retry depois do 500 (V5/V6) ───────
// Caminho real: click em #finalizeSaleBtn → document click listener →
// finalizeSale() → persistApprovedSale() → createSaleService() → httpRequest()
// → fetch. O POST é segurado (saleGate) para o segundo clique acontecer com o
// primeiro ainda em voo — exatamente "duas chamadas POST /v1/sales" do console.
reset([P('miojo', 'Miojo', { price: 15, salePrice: 15, stock: 9 })]);
type('miojo'); press('Enter');
state.pdvSettings = { pdvMode: 'simplified' };
byId.get('salePaymentMethod').value = 'Dinheiro';
byId.get('amountPaid').value = '20';

let releaseSale;
saleGate = new Promise((r) => { releaseSale = r; });
salePosts = 0;
const finalizeBtn = byId.get('finalizeSaleBtn');
finalizeBtn.click();
finalizeBtn.click(); // segundo clique com o primeiro POST ainda em voo
await new Promise((r) => setTimeout(r, 60));
check('V7: dois cliques simultâneos em Finalizar → EXATAMENTE 1 POST /v1/sales', salePosts === 1, `POSTs=${salePosts}`);

releaseSale();
await new Promise((r) => setTimeout(r, 120));
saleGate = Promise.resolve();
finalizeBtn.click();
await new Promise((r) => setTimeout(r, 120));
check('V5/V6: depois do 500 o lock é liberado — a tentativa seguinte dispara um novo POST (total 2, sequenciais)', salePosts === 2, `POSTs=${salePosts}`);
check('V4: com o POST falhando (500) o carrinho NÃO é limpo como se a venda tivesse concluído', cartTitles().length === 1, JSON.stringify(cartTitles()));

check('nenhum listener lançou exceção durante os cenários', errors.length === 0, errors.map((e) => e.message).slice(0, 3).join(' | '));

console.log('');
if (failed > 0) { console.error(`${failed} cenário(s) falharam.\n`); process.exit(1); }
console.log('A fiação real do campo de busca do PDV usa o ranking novo e o dropdown.\n');
process.exit(0);
