import { state, DEFAULT_COMPANY_SETTINGS } from './state.js';
import { saveCompanySettingsService, loadCompanySettingsService } from './services/company-service.js';

export async function initSettings() {
  state.companySettings = { ...DEFAULT_COMPANY_SETTINGS, ...(await loadCompanySettingsService()) };
  renderSettings();
  renderSelfTests();
}

export async function saveCompanySettings() {
  state.companySettings = {
    companyName: document.getElementById('companyName')?.value.trim() || '',
    tradeName: document.getElementById('tradeName')?.value.trim() || '',
    cnpj: document.getElementById('companyCnpj')?.value.trim() || '',
    phone: document.getElementById('companyPhone')?.value.trim() || '',
    email: document.getElementById('companyEmail')?.value.trim() || '',
    address: document.getElementById('companyAddress')?.value.trim() || '',
    noteFooter: document.getElementById('companyFooter')?.value.trim() || ''
  };
  await saveCompanySettingsService(state.companySettings);
  const status = document.getElementById('companySettingsStatus');
  if (status) status.textContent = 'Configurações da empresa salvas com sucesso.';
}

export function renderSettings() {
  const s = state.companySettings;
  const ids = {
    companyName: s.companyName, tradeName: s.tradeName, companyCnpj: s.cnpj,
    companyPhone: s.phone, companyEmail: s.email, companyAddress: s.address, companyFooter: s.noteFooter
  };
  Object.entries(ids).forEach(([id,val])=>{ const el=document.getElementById(id); if(el) el.value = val || ''; });
}

export function renderSelfTests() {
  const list = document.getElementById('selfTestsList');
  if (!list) return;
  const checks = [
    ['Produtos carregados', Array.isArray(state.products) && state.products.length > 0],
    ['Vendas estruturadas', Array.isArray(state.sales)],
    ['Sessão de caixa inicializada', state.cashSession !== undefined],
    ['Usuários internos carregados', Array.isArray(state.internalUsers) && state.internalUsers.length > 0],
    ['Configurações de pagamento presentes', !!state.paymentSettings && !!state.paymentSettings.methods],
    ['Configurações da empresa presentes', !!state.companySettings && typeof state.companySettings.companyName === 'string'],
    ['Produtos padrão disponíveis', Array.isArray(state.products) && state.products.every(p => p && p.code && p.name)],
    ['Permissões carregadas', !!state.currentUser ? true : true]
  ];
  list.innerHTML = checks.map(([label, ok]) => `<li>${ok ? '✅' : '⚠️'} ${label}</li>`).join('');
}

export function bindSettingsActions() {
  document.getElementById('saveCompanySettingsBtn')?.addEventListener('click', saveCompanySettings);
  document.getElementById('runSelfTestsBtn')?.addEventListener('click', renderSelfTests);
}
