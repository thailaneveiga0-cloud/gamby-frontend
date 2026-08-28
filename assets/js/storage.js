export const KEYS = {
  authUsers: 'gamby_auth_users_modular',
  session: 'gamby_auth_session_modular',
  products: 'gamby_products_modular',
  sales: 'gamby_sales_modular',
  cashSession: 'gamby_cash_session_modular',
  paymentSettings: 'gamby_payment_settings_modular',
  internalUsers: 'gamby_internal_users_modular',
  companySettings: 'gamby_company_settings_modular',
  marketplace: 'gamby_marketplace_modular',
  history: 'gamby_history_modular',
  backendConfig: 'gamby_backend_config_modular',
  orders: 'gamby_orders_modular',
  terminals: 'gamby_terminals_modular',
  notificationSettings: 'gamby_notification_settings_modular'
};

export function load(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

export function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    if (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014) {
      console.warn('[Storage] Espaço insuficiente no localStorage para salvar:', key);
    } else {
      throw e;
    }
  }
}

export function remove(key) {
  localStorage.removeItem(key);
}
