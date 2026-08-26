import { state } from '../state.js';
import { KEYS, load, save } from '../storage.js';
import { buildEndpoint, isBackendReady } from '../backend-config.js';
import { httpRequest } from '../http.js';

function settingsToApi(settings) {
  return {
    acceptCard: Boolean(settings.methods?.card),
    acceptPix: Boolean(settings.methods?.pix),
    acceptCash: Boolean(settings.methods?.cash),
    acceptBoleto: Boolean(settings.methods?.boleto),
    pixKey: settings.pixKey || '',
    boletoIssuer: settings.boletoIssuer || '',
    autoDebitEnabled: Boolean(settings.autoDebitEnabled),
    trialReminderEnabled: Boolean(settings.autoReminderEnabled),
    trialReminderDaysBefore: Number(settings.reminderDaysBeforeTrialEnd || 1)
  };
}

function settingsFromApi(settings) {
  if (!settings) return state.paymentSettings;
  return {
    ...state.paymentSettings,
    methods: {
      card: Boolean(settings.acceptCard),
      pix: Boolean(settings.acceptPix),
      cash: Boolean(settings.acceptCash),
      boleto: Boolean(settings.acceptBoleto)
    },
    pixKey: settings.pixKey || '',
    boletoIssuer: settings.boletoIssuer || '',
    autoReminderEnabled: Boolean(settings.trialReminderEnabled ?? true),
    autoDebitEnabled: Boolean(settings.autoDebitEnabled ?? true),
    reminderDaysBeforeTrialEnd: Number(settings.trialReminderDaysBefore || 1)
  };
}

export async function savePaymentSettingsService(settings) {
  if (isBackendReady()) {
    // Backend é a fonte da verdade: se o PUT falhar, propaga o erro — nunca
    // grava localmente como se tivesse persistido no servidor.
    const payload = await httpRequest(buildEndpoint('payments', 'settings'), { method: 'PUT', body: JSON.stringify(settingsToApi(settings)) });
    const normalized = settingsFromApi(payload);
    save(KEYS.paymentSettings, normalized);
    state.paymentSettings = normalized;
    return normalized;
  }
  save(KEYS.paymentSettings, settings);
  state.paymentSettings = settings;
  return settings;
}

export async function loadPaymentSettingsService() {
  if (isBackendReady()) {
    try {
      const payload = await httpRequest(buildEndpoint('payments', 'settings'));
      return settingsFromApi(payload);
    } catch { /* fallback local */ }
  }
  return load(KEYS.paymentSettings, state.paymentSettings);
}

export async function saveSubscriptionPaymentMethod(method) {
  if (isBackendReady()) {
    return httpRequest(buildEndpoint('payments', 'methods'), { method: 'POST', body: JSON.stringify(method) });
  }
  return { ok: true };
}
