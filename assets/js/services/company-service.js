import { state } from '../state.js';
import { KEYS, load, save } from '../storage.js';
import { buildEndpoint, isBackendReady } from '../backend-config.js';
import { httpRequest } from '../http.js';

function fromApi(company) {
  if (!company) return state.companySettings;
  return {
    companyName: company.legalName || company.companyName || 'Minha Empresa',
    tradeName: company.tradeName || company.trade_name || 'Gamby Cliente',
    cnpj: company.cnpj || '',
    phone: company.phone || '',
    email: company.email || '',
    address: company.address || '',
    noteFooter: company.reportFooter || company.noteFooter || 'Obrigado pela preferência.'
  };
}

function toApi(settings) {
  return {
    legalName: settings.companyName,
    tradeName: settings.tradeName,
    cnpj: settings.cnpj,
    phone: settings.phone,
    email: settings.email,
    address: settings.address,
    reportFooter: settings.noteFooter
  };
}

export async function saveCompanySettingsService(settings) {
  if (isBackendReady()) {
    // Backend é a fonte da verdade: se o PUT falhar, propaga o erro — nunca
    // grava localmente como se tivesse persistido no servidor.
    const payload = await httpRequest(buildEndpoint('companies', 'me'), { method: 'PUT', body: JSON.stringify(toApi(settings)) });
    const normalized = fromApi(payload);
    save(KEYS.companySettings, normalized);
    state.companySettings = normalized;
    return normalized;
  }
  save(KEYS.companySettings, settings);
  state.companySettings = settings;
  return settings;
}

export async function loadCompanySettingsService() {
  if (isBackendReady()) {
    try {
      const payload = await httpRequest(buildEndpoint('companies', 'me'));
      return fromApi(payload);
    } catch { /* fallback local */ }
  }
  return load(KEYS.companySettings, state.companySettings);
}
