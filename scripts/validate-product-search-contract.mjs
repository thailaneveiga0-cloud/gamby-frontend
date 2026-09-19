/**
 * Gamby Frontend — PDV product search / barcode / keyboard contract (S1–S12)
 * + integração conceitual busca → venda (VALIDADO COM MOCK, não é E2E).
 *
 * Bug real: resolveProductBySearch() (pdv.js) usava products.find() com um OR
 * entre code/barcode/dígitos/name.includes — o PRIMEIRO produto na ordem do
 * array que casasse com qualquer critério ganhava. "miojo" adicionava
 * "Ramen Nissin Miojo..." mesmo existindo um produto chamado exatamente
 * "Miojo"; e para busca por texto (sem dígitos) a comparação
 * onlyDigits(barcode) === '' casava com qualquer produto SEM código de
 * barras.
 *
 * Classificação da evidência:
 *   - ranking/decisão/navegação: VALIDADO LOCALMENTE (funções reais importadas)
 *   - integração busca→createSaleService: VALIDADO COM MOCK (fetch stubado)
 *   - fiação do dropdown em pdv.js (mouse, Escape, foco): CONFIRMADO
 *     ESTATICAMENTE (pdv.js é acoplado ao DOM)
 *   - NÃO VERIFICADO EM NAVEGADOR / NÃO VERIFICADO EM STAGING
 *
 * Usage: node scripts/validate-product-search-contract.mjs
 */

import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

class MemoryStorage {
  constructor() { this._data = new Map(); }
  getItem(key) { return this._data.has(key) ? this._data.get(key) : null; }
  setItem(key, value) { this._data.set(key, String(value)); }
  removeItem(key) { this._data.delete(key); }
  clear() { this._data.clear(); }
}
globalThis.localStorage = new MemoryStorage();
globalThis.window = { GAMBY_CONFIG: { apiUrl: 'http://fake-backend.invalid' }, location: { hostname: 'localhost' }, dispatchEvent: () => {} };
globalThis.CustomEvent = class CustomEvent { constructor(type, opts) { this.type = type; this.detail = opts?.detail; } };

const _posts = [];
globalThis.fetch = async (url, opts) => {
  if (String(url).includes('/v1/sales') && (opts?.method || 'GET') === 'POST') _posts.push(JSON.parse(opts.body));
  return {
    ok: true, status: 201,
    headers: { get: (h) => (h.toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: async () => ({ id: 'sale-1', items: [], total: 15 }),
    text: async () => '{}',
  };
};

let failed = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed++;
}

let mod = null;
try { mod = await import('../assets/js/product-search.js'); } catch { /* ainda não existe */ }
check('product-search.js existe e exporta rankProducts/decideSearch/nextHighlight/productThumb', Boolean(mod?.rankProducts && mod?.decideSearch && mod?.nextHighlight && mod?.productThumb));

if (mod?.rankProducts) {
  const { rankProducts, decideSearch, nextHighlight, productThumb } = mod;

  const P = (id, name, extra = {}) => ({ id, name, price: 3.5, stock: 5, barcode: '', code: '', ...extra });
  const ramen = P('ramen', 'Ramen Nissin Miojo Galinha', { barcode: '7891000000011' });
  const macarrao = P('macarrao', 'Macarrão Instantâneo Miojo Carne', { barcode: '7891000000028' });
  const miojo = P('miojo', 'Miojo', { barcode: '7891000000035', code: 'MIO-1' });
  // Ramen vem ANTES do "Miojo" exato no array — exatamente o cenário do bug.
  const catalog = [ramen, macarrao, miojo, P('semcodigo', 'Sabão em Pó')];

  // S1
  const ranked = rankProducts(catalog, 'miojo').matches;
  check('S1: nome exato "Miojo" fica primeiro, antes dos parciais', ranked[0]?.product.id === 'miojo' && ranked.length === 3, ranked.map((m) => m.product.id).join(','));

  // S2
  const d2 = decideSearch(catalog, 'miojo');
  check('S2: Enter em "miojo" com exato único → adiciona "Miojo" (não o Ramen que vem antes no array)', d2.action === 'add' && d2.product.id === 'miojo', `${d2.action}/${d2.product?.id}`);

  // busca por texto nunca casa produto sem código de barras por acidente
  const dGhost = decideSearch(catalog, 'zzzz-inexistente');
  check('texto sem correspondência → not_found (não escolhe produto sem barcode por acidente)', dGhost.action === 'not_found', dGhost.action);

  // S3
  const d3 = decideSearch([ramen, macarrao, P('lamen', 'Lámen Picante')], 'lamen');
  const d3b = decideSearch([ramen, macarrao], 'miojo');
  check('S3: sem exato e vários parciais → abre lista', d3b.action === 'list' && d3b.matches.length === 2, d3b.action);
  check('normalização de acento/caixa/espaços só para comparar (Lámen ↔ lamen)', d3.action === 'add' && d3.product.id === 'lamen');

  // S4
  const d4 = decideSearch([P('a', 'Miojo'), P('b', 'Miojo'), ramen], 'miojo');
  check('S4: dois produtos com nome exatamente igual → lista, sem auto-adicionar', d4.action === 'list' && d4.matches.length === 3, d4.action);

  // ranking geral: barcode > sku > nome exato > começa com > contém
  const mix = [P('contem', 'Super Miojo Pack'), P('comeca', 'Miojo Galinha'), P('exato', 'miojo'), P('sku', 'Qualquer', { code: 'miojo' }), P('bar', 'Outro', { barcode: 'miojo' })];
  const order = rankProducts(mix, 'miojo').matches.map((m) => m.product.id);
  check('ranking: barcode > SKU > nome exato > começa com > contém', order.join(',') === 'bar,sku,exato,comeca,contem', order.join(','));

  // S8 / S9
  const d8 = decideSearch(catalog, '7891000000035');
  check('S8/S9: barcode exato (digitado ou leitor+Enter) → adiciona o produto correto, sem lista', d8.action === 'add' && d8.product.id === 'miojo');
  const d8b = decideSearch(catalog, '  7891000000035  ');
  check('S9: leitor com espaços/whitespace ao redor ainda resolve o produto exato', d8b.action === 'add' && d8b.product.id === 'miojo');

  // S10
  const d10 = decideSearch(catalog, '7899999999999');
  check('S10: barcode inexistente → not_found, nenhum produto parcial/errado', d10.action === 'not_found' && d10.reason === 'barcode', `${d10.action}/${d10.reason}`);

  // S5 / S6 / S7 (navegação — funções reais)
  check('S5: ArrowDown avança e ArrowUp volta (com wrap)', nextHighlight(0, 3, 'ArrowDown') === 1 && nextHighlight(2, 3, 'ArrowDown') === 0 && nextHighlight(1, 3, 'ArrowUp') === 0 && nextHighlight(0, 3, 'ArrowUp') === 2 && nextHighlight(-1, 3, 'ArrowDown') === 0);
  check('lista vazia → índice -1 (nada destacado)', nextHighlight(0, 0, 'ArrowDown') === -1);

  // S11
  check('S11: foto correta é devolvida quando disponível (imageUrl/imagem) e null quando não', productThumb({ imageUrl: 'http://x/a.png' }) === 'http://x/a.png' && productThumb({ imagem: 'http://x/b.png' }) === 'http://x/b.png' && productThumb({}) === null);

  // S12 — estoque zero: a busca NÃO filtra por estoque (política atual: o
  // aviso "sem estoque" continua sendo dado por addItemToCart, verificado abaixo)
  const zero = decideSearch([P('z', 'Produto Zerado', { stock: 0, barcode: '7890000000001' })], '7890000000001');
  check('S12: produto com estoque 0 ainda é encontrado (a política de estoque continua em addItemToCart)', zero.action === 'add' && zero.product.id === 'z');

  // ── Integração conceitual (VALIDADO COM MOCK): busca → venda R$15 dinheiro R$20 ──
  const { createSaleService } = await import('../assets/js/services/sales-service.js');
  const { state } = await import('../assets/js/state.js');
  state.currentUser = { id: 'user-1', companyId: 'company-1', name: 'Operador' };

  const miojo15 = { ...miojo, price: 15, salePrice: 15 };
  const decision = decideSearch([ramen, macarrao, miojo15], 'Miojo');
  const chosen = decision.product;
  const cart = [{ id: chosen.id, name: chosen.name, quantity: 1, price: chosen.price, cost: 0, discount: 0, total: chosen.price }];
  _posts.length = 0;
  await createSaleService({
    items: cart.map((i) => ({ productId: i.id, productName: i.name, quantity: i.quantity, unitPrice: i.price, cost: i.cost, discount: 0, total: i.total })),
    paymentMethod: 'Dinheiro', subtotal: 15, discount: 0, total: 15,
    amountReceived: 20, amountPaid: 20, changeAmount: 5, cashSessionId: 'cs-1',
  });
  const body = _posts[0];
  check('integração: pesquisa "Miojo" → produto exato → F10/Dinheiro/R$20 → exatamente 1 POST /v1/sales', _posts.length === 1);
  check('integração: o item do payload é o produto exato ("miojo"), não o Ramen', body?.items?.[0]?.productId === 'miojo');
  // total e troco são derivados pelo backend (o corpo real não os envia — schema
  // .strict()); o que precisa chegar é o valor recebido e o preço do item, de
  // onde o servidor calcula total 15 e troco 5.
  check('integração: corpo real leva amountReceived=20, item 1×R$15 e pagamento em dinheiro (backend deriva total 15 / troco 5)',
    body?.amountReceived === 20 && body?.items?.[0]?.unitPrice === 15 && body?.items?.[0]?.quantity === 1 && /cash|dinheiro/i.test(String(body?.paymentMethod)),
    JSON.stringify({ r: body?.amountReceived, u: body?.items?.[0]?.unitPrice, q: body?.items?.[0]?.quantity, m: body?.paymentMethod }));
}

// ── Fiação em pdv.js (estático) ───────────────────────────────────────────────
const pdv = await readFile(join(ROOT, 'assets/js/pdv.js'), 'utf8');
const css = await readFile(join(ROOT, 'assets/css/dashboard.css'), 'utf8');

function extractFunctionBody(src, fnName) {
  const m = new RegExp(`(?:async\\s+)?function\\s+${fnName}\\s*\\([^)]*\\)\\s*{`).exec(src);
  if (!m) return null;
  let depth = 0; let i = m.index + m[0].length - 1; const start = i + 1;
  for (; i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i); } }
  return null;
}

const addBody = extractFunctionBody(pdv, 'addItemToCart') || '';
check('pdv.js importa o módulo de ranking e addItemToCart() decide via decideSearch()', /from '\.\/product-search\.js'/.test(pdv) && /decideSearch\(/.test(addBody));
check('addItemToCart() não usa mais a busca antiga (first-match com name.includes)', !/resolveProductBySearch\(/.test(addBody) && !/name\.includes\(value\)/.test(pdv));
const resolvedBody = extractFunctionBody(pdv, '_pdvAddResolvedProduct') || '';
check('S12: política de estoque zero continua aplicada (em _pdvAddResolvedProduct, usado por Enter e por clique/lista)', /Produto sem estoque disponível/.test(resolvedBody) && /_pdvAddResolvedProduct\(/.test(addBody) && /_pdvAddResolvedProduct\(/.test(extractFunctionBody(pdv, '_pdvPickSearchProduct') || ''));
check('dropdown: limita a lista renderizada (não renderiza centenas de itens)', /slice\(0,\s*\d+\)/.test(pdv) && /pdvSearchDropdown/.test(pdv));
check('S5/S6/S7: teclado — ArrowDown/ArrowUp/Escape ligados no campo de busca', /nextHighlight\(/.test(pdv) && /'Escape'/.test(pdv.slice(pdv.indexOf('pdvSearchDropdown'))));
check('mouse: o item inteiro é clicável (delegação em [data-search-idx])', /data-search-idx/.test(pdv) && /closest\('\[data-search-idx\]'\)/.test(pdv));
const pickBody = extractFunctionBody(pdv, '_pdvPickSearchProduct') || '';
check('depois de escolher: limpa a busca, fecha a lista e devolve o foco ao campo', /_pdvCloseSearchDropdown\(\)/.test(pickBody) && /searchField\.value\s*=\s*''/.test(pickBody + (extractFunctionBody(pdv, '_finishAddItemToCart') || '')) && /focusPDVInput\(\)/.test(pickBody + (extractFunctionBody(pdv, '_finishAddItemToCart') || '')));
check('CSS do dropdown existe (lista compacta com rolagem)', /\.pdv-search-dropdown\b/.test(css) && /max-height/.test(css.slice(css.indexOf('.pdv-search-dropdown'))));

console.log('');
if (failed > 0) {
  console.error(`${failed} cenário(s) falharam.\n`);
  process.exit(1);
}
console.log('Busca inteligente: ranking exato-primeiro, barcode, teclado e lista compacta consistentes.\n');
