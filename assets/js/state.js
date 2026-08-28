export const DEFAULT_INTERNAL_USERS = [];

export const DEFAULT_COMPANY_SETTINGS = {
  companyName: 'Minha Empresa',
  tradeName: 'Gamby Cliente',
  cnpj: '',
  phone: '',
  email: '',
  address: '',
  noteFooter: 'Obrigado pela preferência.'
};

export const DEFAULT_SUBSCRIPTION = {
  companyId: '',
  companyName: 'Minha empresa',
  subscriptionId: null,
  status: 'trial',
  billingCycle: 'monthly',
  paymentMethod: 'card',
  autoDebitEnabled: false,
  trialStartsAt: null,
  trialEndsAt: null,
  nextBillingAt: null,
  planCode: 'basico',
  planName: 'Básico',
  priceMonthly: 39.9,
  priceYearly: 399,
  trialDays: 15,
  cardLast4: null,
  cardBrand: null,
  daysLeft: 0
};

export const state = {
  _dataLoaded: false,
  currentUser: null,

  // Perfil ativo escolhido na tela pós-login (administrador/gerente/operador).
  // Camada puramente visual: NÃO substitui currentUser.role (papel real do JWT),
  // apenas direciona getCurrentRole() de gov-access.js para fins de menu/navegação.
  // Persistido em sessionStorage (chave 'gamby_active_profile') — ver profile-selector.js.
  activeProfile: null,

  backend: {
    enabled: true,
    apiBaseUrl: '',
    timeoutMs: 10000,
    tenantHeader: 'X-Tenant-Id',
    tenantId: '',
    syncStrategy: 'fallback-local',
    endpoints: {
      health: '/health',
      auth: '/v1/auth',
      products: '/v1/products',
      sales: '/v1/sales',
      payments: '/v1/payments',
      companies: '/v1/companies',
      users: '/v1/users',
      cashSessions: '/v1/cash-sessions',
      finance: '/v1/finance',
      reports: '/v1/reports',
      marketplace: '/v1/marketplace',
      developer: '/v1/developer',
      mercadopago: '/v1/mercadopago'
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
    generatedDeviceCodes: [],
    cardMachines: [
      { id: 'stone',      name: 'Stone',      debito: 1.50, credito: 2.50, credito2a6: 3.50, credito7a12: 4.50, enabled: true },
      { id: 'pagseguro',  name: 'PagSeguro',  debito: 1.99, credito: 3.29, credito2a6: 4.99, credito7a12: 5.99, enabled: true },
      { id: 'ton',        name: 'Ton',        debito: 1.07, credito: 2.74, credito2a6: 3.99, credito7a12: 5.49, enabled: true },
      { id: 'cielo',      name: 'Cielo',      debito: 1.60, credito: 2.85, credito2a6: 4.00, credito7a12: 5.00, enabled: true },
      { id: 'sumup',      name: 'SumUp',      debito: 1.90, credito: 3.49, credito2a6: 4.99, credito7a12: 5.99, enabled: true },
      { id: 'mercadopago',name: 'Mercado Pago',debito: 1.99, credito: 3.49, credito2a6: 5.99, credito7a12: 6.99, enabled: true }
    ],
    defaultCardMachine: 'stone',
    cashDiscountEnabled: false,
    cashDiscountMode: 'percent',
    cashDiscountValue: 5,
    pixDiscountEnabled: false,
    pixDiscountMode: 'percent',
    pixDiscountValue: 5
  },

  companySettings: { ...DEFAULT_COMPANY_SETTINGS },
  subscription: { ...DEFAULT_SUBSCRIPTION },
  commercialPolicy: null,

  marketplace: {
    channels: [],
    onlineOrders: []
  },

  history: [],
  products: [],
  sales: [],
  orders: [],
  cart: [],
  cashSession: null,
  operatorSessions: [],
  pdvSettings: null,

  registrationData: {
    planName: 'Básico',
    planCode: 'basico',
    planPrice: 39.9,
    trialDays: 15,
    paymentMethod: 'Cartão',
    userCreated: false,
    emailVerified: false,
    email: '',
    password: '',
    company: ''
  },

  internalUsers: [...DEFAULT_INTERNAL_USERS]
};