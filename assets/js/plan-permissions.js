import { state } from './state.js';

const PLAN_RULES = {
  basico: {
    label: 'Básico',
    devices: 1,
    dashboard: true,
    financeiro: false,
    relatorios: false,
    estoque: true,
    produtos: true,
    marketplace: false,
    usuarios: false,
    configuracoes: true
  },

  economico: {
    label: 'Econômico',
    devices: 6,
    dashboard: true,
    financeiro: true,
    relatorios: true,
    estoque: true,
    produtos: true,
    marketplace: false,
    usuarios: true,
    configuracoes: true
  },

  pro: {
    label: 'Pró',
    devices: 12,
    dashboard: true,
    financeiro: true,
    relatorios: true,
    estoque: true,
    produtos: true,
    marketplace: true,
    usuarios: true,
    configuracoes: true
  }
};

function normalizePlan(plan) {
  const value = String(plan || '').trim().toLowerCase();

  if (value.includes('econ')) return 'economico';
  if (value.includes('pro')) return 'pro';
  return 'basico';
}

function setVisibilityBySelector(selector, enabled) {
  document.querySelectorAll(selector).forEach((el) => {
    el.classList.toggle('hidden', !enabled);
  });
}

export function getPlanRules(plan = state.currentUser?.planCode || state.currentUser?.plan) {
  return PLAN_RULES[normalizePlan(plan)] || PLAN_RULES.basico;
}

export function applyPlanPermissions(plan) {
  const normalized = normalizePlan(plan);
  const rules = getPlanRules(normalized);

  state.activePlanRules = rules;

  // Only toggle nav button visibility — page sections are managed by activatePage() exclusively.
  setVisibilityBySelector('[data-page="dashboard"]', rules.dashboard);
  setVisibilityBySelector('[data-page="financeiro"]', rules.financeiro);
  setVisibilityBySelector('[data-page="relatorios"]', rules.relatorios);
  setVisibilityBySelector('[data-page="estoque"]', rules.estoque);
  setVisibilityBySelector('[data-page="produtos"]', rules.produtos);
  setVisibilityBySelector('[data-page="marketplace"]', rules.marketplace);
  setVisibilityBySelector('[data-page="usuarios"]', rules.usuarios);
  setVisibilityBySelector('[data-page="configuracoes"]', rules.configuracoes);

  const devicesInfo = document.querySelectorAll('[data-plan-device-limit]');
  devicesInfo.forEach((el) => {
    el.textContent = `${rules.devices} dispositivo${rules.devices > 1 ? 's' : ''}`;
  });
}

export function getPlanDeviceLimit(plan) {
  return getPlanRules(plan).devices;
}

export function planAllows(feature, plan = state.currentUser?.planCode || state.currentUser?.plan) {
  const rules = getPlanRules(plan);
  return Boolean(rules?.[feature]);
}