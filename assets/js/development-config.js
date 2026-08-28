import { state } from './state.js';
import { KEYS, load, save } from './storage.js';
import { SUBSCRIPTION_STATES } from './access-control.js';

export const DEFAULT_DEVELOPMENT_CONFIG = Object.freeze({ enabled: false, allowLocalDeveloperLogin: false, simulateSubscription: false, simulatedSubscriptionStatus: 'active' });

export function initDevelopmentConfig() {
  const persisted = load(KEYS.developmentConfig, {});
  state.development = { ...DEFAULT_DEVELOPMENT_CONFIG, ...persisted };
  if (!SUBSCRIPTION_STATES.includes(state.development.simulatedSubscriptionStatus)) state.development.simulatedSubscriptionStatus = 'active';
  return state.development;
}

export function saveDevelopmentConfig(partial = {}) {
  state.development = { ...state.development, ...partial };
  save(KEYS.developmentConfig, state.development);
  return state.development;
}

export function renderDevelopmentConfig() {
  const enabled = document.getElementById('developmentModeEnabled');
  const simulate = document.getElementById('simulateSubscriptionEnabled');
  const status = document.getElementById('simulatedSubscriptionStatus');
  const box = document.getElementById('developmentModeStatus');
  if (enabled) enabled.checked = Boolean(state.development.enabled);
  if (simulate) simulate.checked = Boolean(state.development.simulateSubscription);
  if (status) status.value = state.development.simulatedSubscriptionStatus;
  if (box) box.textContent = state.development.simulateSubscription ? `Simulação de assinatura ativa: ${state.development.simulatedSubscriptionStatus}` : 'Simulação desativada; o status real do tenant será utilizado.';
}

export function bindDevelopmentConfigActions() {
  document.getElementById('saveDevelopmentModeBtn')?.addEventListener('click', () => {
    const simulatedSubscriptionStatus = document.getElementById('simulatedSubscriptionStatus')?.value || 'active';
    if (!SUBSCRIPTION_STATES.includes(simulatedSubscriptionStatus)) return;
    saveDevelopmentConfig({ enabled: Boolean(document.getElementById('developmentModeEnabled')?.checked), simulateSubscription: Boolean(document.getElementById('simulateSubscriptionEnabled')?.checked), simulatedSubscriptionStatus });
    renderDevelopmentConfig();
  });
}
