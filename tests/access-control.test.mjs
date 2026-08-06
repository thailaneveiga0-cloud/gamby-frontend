import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAccess } from '../assets/js/access-control.js';
import { authenticateUser } from '../assets/js/services/auth-service.js';
import { DEFAULT_INTERNAL_USERS, state } from '../assets/js/state.js';

const development = { enabled: true, simulateSubscription: false, simulatedSubscriptionStatus: 'active' };
const customer = (role, status) => ({ username: `${role}@tenant.test`, role, companyId: 'tenant-1', subscriptionStatus: status });

test('local developer authentication remains available while backend mode is enabled', async () => {
  const developer = DEFAULT_INTERNAL_USERS.find((user) => user.role === 'desenvolvedora');
  state.development.enabled = true;
  state.development.allowLocalDeveloperLogin = true;
  state.backend.enabled = true;
  state.backend.apiBaseUrl = 'http://backend-not-required-for-developer.test';
  const authenticated = await authenticateUser(developer.username, developer.password);
  assert.equal(authenticated.role, 'desenvolvedora');
  assert.equal(authenticated.authenticationSource, 'local-development');
  state.backend.enabled = false;
});

test('desenvolvedora enters without tenant or subscription', () => {
  const result = validateAccess({ username: 'developer', role: 'desenvolvedora', subscriptionStatus: 'blocked' }, development);
  assert.equal(result.ok, true);
  assert.equal(result.reason, 'development_bypass');
});

test('administrador enters with active subscription', () => {
  assert.equal(validateAccess(customer('administrador', 'active'), development).ok, true);
});

test('operador enters an active tenant and is limited to PDV', () => {
  const result = validateAccess(customer('operador', 'active'), development);
  assert.equal(result.ok, true);
  assert.deepEqual(result.user.allowedPages, ['pdv']);
});

for (const role of ['administrador', 'gerente', 'operador']) {
  test(`blocked tenant denies ${role}`, () => {
    const result = validateAccess(customer(role, 'blocked'), development);
    assert.equal(result.ok, false);
    assert.equal(result.code, 'subscription_blocked');
  });
}

test('desenvolvedora remains allowed while simulation is blocked', () => {
  const result = validateAccess({ username: 'developer', role: 'desenvolvedora' }, { ...development, simulateSubscription: true, simulatedSubscriptionStatus: 'blocked' });
  assert.equal(result.ok, true);
});

test('subscription belongs to tenant and is required for customer profiles', () => {
  const result = validateAccess({ username: 'operator', role: 'operador', subscriptionStatus: 'active' }, development);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'missing_tenant');
});

test('development simulation changes customer subscription without code changes', () => {
  const simulated = { ...development, simulateSubscription: true, simulatedSubscriptionStatus: 'suspended' };
  assert.equal(validateAccess(customer('administrador', 'active'), simulated).code, 'subscription_blocked');
});
