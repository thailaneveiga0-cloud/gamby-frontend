// Busca de produtos do PDV — funções puras (sem DOM), testáveis em Node.
//
// Prioridade (menor tier = melhor):
//   1 código de barras exato
//   2 SKU/código interno exato
//   3 nome exatamente igual
//   4 nome começa com a pesquisa
//   5 nome contém a pesquisa
//   6 todas as palavras da pesquisa aparecem no nome (qualquer ordem)
//
// A normalização (caixa, acentos, espaços) é só para COMPARAR — nunca altera
// o nome salvo do produto.

const MAX_TIER_AUTO_ADD = 3;

export function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function onlyDigits(value) {
  return String(value ?? '').replace(/\D/g, '');
}

// EAN-8/EAN-13/UPC/GTIN-14: só dígitos, 8 a 14. Um texto assim que não casa
// com nenhum produto é tratado como barcode inexistente — nunca cai numa
// correspondência parcial por nome.
export function looksLikeBarcode(query) {
  return /^\d{8,14}$/.test(String(query ?? '').trim());
}

function tierOf(product, raw, q, tokens) {
  const barcode = String(product?.barcode ?? '').trim();
  // Guarda contra barcode vazio: '' nunca pode casar (bug antigo: em busca
  // por texto, onlyDigits('') === '' casava com todo produto sem barcode).
  if (barcode) {
    if (barcode.toLowerCase() === raw.toLowerCase()) return 1;
    if (looksLikeBarcode(raw) && onlyDigits(barcode) === raw) return 1;
  }

  const code = normalizeText(product?.code);
  const sku = normalizeText(product?.sku);
  if ((code && code === q) || (sku && sku === q)) return 2;

  const name = normalizeText(product?.name);
  if (!name) return null;
  if (name === q) return 3;
  if (name.startsWith(q)) return 4;
  if (name.includes(q)) return 5;
  if (tokens.length > 1 && tokens.every((t) => name.includes(t))) return 6;

  return null;
}

export function rankProducts(products, query) {
  const raw = String(query ?? '').trim();
  const q = normalizeText(raw);
  if (!q) return { matches: [] };

  const tokens = q.split(' ').filter(Boolean);
  const list = Array.isArray(products) ? products : [];

  const matches = [];
  list.forEach((product, index) => {
    const tier = tierOf(product, raw, q, tokens);
    if (tier !== null) matches.push({ product, tier, index, nameLength: normalizeText(product?.name).length });
  });

  matches.sort((a, b) => a.tier - b.tier || a.nameLength - b.nameLength || a.index - b.index);
  return { matches };
}

// action:
//   'add'       → um único candidato inequívoco (barcode/SKU/nome exato único,
//                 ou um único resultado no total)
//   'list'      → ambíguo: mostrar lista para o operador escolher
//   'not_found' → nada encontrado (reason:'barcode' quando a busca parece um
//                 código de barras — nunca adiciona um produto errado)
export function decideSearch(products, query) {
  const { matches } = rankProducts(products, query);

  if (!matches.length) {
    return { action: 'not_found', reason: looksLikeBarcode(query) ? 'barcode' : 'text' };
  }

  // Barcode-like sem correspondência exata de barcode/SKU: não aceitar um
  // parcial por nome (ex.: dígitos que por acaso aparecem num nome).
  if (looksLikeBarcode(query) && matches[0].tier > 2) {
    return { action: 'not_found', reason: 'barcode' };
  }

  const topTier = matches[0].tier;
  const sameTier = matches.filter((m) => m.tier === topTier);

  if (topTier <= MAX_TIER_AUTO_ADD && sameTier.length === 1) {
    return { action: 'add', product: matches[0].product };
  }

  if (matches.length === 1) {
    return { action: 'add', product: matches[0].product };
  }

  return { action: 'list', matches };
}

// Navegação por teclado na lista (com wrap). Lista vazia → -1.
export function nextHighlight(current, count, key) {
  if (!count || count < 1) return -1;
  if (key === 'ArrowDown') return current < 0 ? 0 : (current + 1) % count;
  if (key === 'ArrowUp') return current < 0 ? count - 1 : (current - 1 + count) % count;
  return current;
}

export function productThumb(product) {
  return product?.imageUrl || product?.imagem || null;
}
