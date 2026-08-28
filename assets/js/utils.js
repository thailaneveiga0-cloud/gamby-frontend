export function formatCurrency(value) {
  return Number(value || 0).toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  });
}

export function formatDateBR(value) {
  return new Date(value).toLocaleDateString('pt-BR');
}

export function formatDateTimeBR(value) {
  return new Date(value).toLocaleString('pt-BR');
}

export function addDays(baseDate, days) {
  const date = new Date(baseDate);
  date.setDate(date.getDate() + Number(days || 0));
  return date;
}

export function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

export function setHtml(id, value) {
  const element = document.getElementById(id);
  if (element) element.innerHTML = value;
}

export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function normalizeString(value) {
  return String(value || '').trim();
}

export function toNumber(value, fallback = 0) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : fallback;
  }

  const normalized = String(value)
    .trim()
    .replace(/\s+/g, '')
    .replace(/\./g, '')
    .replace(',', '.');

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : fallback;
}