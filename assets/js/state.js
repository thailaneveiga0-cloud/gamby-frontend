export const DEFAULT_INTERNAL_USERS = [
  { username: 'dev.gamby', password: 'GambyDev@2026', role: 'desenvolvedora' },
  { username: 'admin', password: '1234', role: 'administrador' },
  { username: 'operador', password: '1234', role: 'operador' }
];

export const DEFAULT_COMPANY_SETTINGS = {
  companyName: 'Minha Empresa',
  tradeName: 'Gamby Cliente',
  cnpj: '',
  phone: '',
  email: '',
  address: '',
  noteFooter: 'Obrigado pela preferência.'
};

export const state = {
  currentUser: null,

  backend: {
    enabled: false,
    apiBaseUrl: '',
    timeoutMs: 10000,
    tenantHeader: 'X-Tenant-Id',
    tenantId: '',
    syncStrategy: 'fallback-local',
    endpoints: {
      auth: '/auth',
      products: '/products',
      sales: '/sales',
      payments: '/payments',
      companies: '/companies'
    },
    lastHealthcheck: null,
    health: { ok: false, message: 'Não verificado' }
  },

  currentBillingCycle: 'monthly',
  paymentSettings: {
    methods: { card: true, pix: true, boleto: true, cash: true },
    pixKey: '',
    boletoIssuer: '',
    autoReminderEnabled: true,
    autoDebitEnabled: true,
    reminderDaysBeforeTrialEnd: 1,
    generatedDeviceCodes: []
  },
  companySettings: { ...DEFAULT_COMPANY_SETTINGS },
  marketplace: {
    channels: [],
    onlineOrders: []
  },
  history: [],
  products: [],
  sales: [],
  cart: [],
  cashSession: null,
  registrationData: {
    planName: 'Básico',
    planPrice: 39.90,
    trialDays: 15,
    paymentMethod: 'Cartão'
  },
  internalUsers: [...DEFAULT_INTERNAL_USERS]
};
