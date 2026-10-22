const { test } = require('node:test');
const assert = require('node:assert/strict');
const { assertIsolatedTarget } = require('./guard.cjs');
const id = '123456abcdef';
const password = 'a'.repeat(48);
const safe = {
  TAHILI_ENVIRONMENT: 'acceptance', TAHILI_DISPOSABLE_TEST_DB: '1', ACCEPTANCE_RUN_ID: id,
  COMPOSE_PROJECT_NAME: `tahili-acceptance-${id}`, ACCEPTANCE_APP_PORT: '38091', ACCEPTANCE_DB_PASSWORD: password,
  E2E_BASE_URL: 'http://127.0.0.1:38091', NEXTAUTH_URL: 'http://127.0.0.1:38091', NEXTAUTH_URL_INTERNAL: 'http://127.0.0.1:38091',
  DATABASE_URL: `postgresql://acceptance:${password}@127.0.0.1:55432/acceptance_${id}`,
};
test('complete disposable identity is accepted', () => assert.equal(assertIsolatedTarget(safe).id, id));
for (const key of Object.keys(safe)) test(`missing ${key} refuses writes`, () => {
  const env = { ...safe }; delete env[key];
  assert.throws(() => assertIsolatedTarget(env), /refusing all writes/);
});
const overrides = [
  { TAHILI_ENVIRONMENT: 'production' }, { TAHILI_ENVIRONMENT: 'development' }, { TAHILI_DISPOSABLE_TEST_DB: '0' },
  { COMPOSE_PROJECT_NAME: 'tahili-qa-windows' }, { ACCEPTANCE_RUN_ID: '../../qa' },
  ...['3101', '3102', '3000', '31999', '49001', '38091.0', '3.8091e4', ' 38091'].map(ACCEPTANCE_APP_PORT => ({ ACCEPTANCE_APP_PORT })),
  ...['http://localhost:3101', 'http://192.168.17.228:3000', 'https://tah.elaqat.site', 'http://192.168.17.20:3000', 'http://127.0.0.1:38091/path', 'http://127.0.0.1:38091?target=qa'].map(E2E_BASE_URL => ({ E2E_BASE_URL })),
  ...['tahili_rehearsal', 'tahili_preview', 'postgres', 'app_test'].map(name => ({ DATABASE_URL: safe.DATABASE_URL.replace(`acceptance_${id}`, name) })),
  ...['postgres', 'localhost', '192.168.17.228', '127.0.0.1.evil.test'].map(host => ({ DATABASE_URL: safe.DATABASE_URL.replace('127.0.0.1', host) })),
  { DATABASE_URL: safe.DATABASE_URL + '?host=192.168.17.228' },
  { DATABASE_URL: safe.DATABASE_URL.replace(':55432', ':5432') },
  { DATABASE_URL: safe.DATABASE_URL.replace('acceptance:', 'postgres:') },
  { NEXTAUTH_URL_INTERNAL: 'http://localhost:3101' }, { NEXTAUTH_URL: 'http://localhost:3101' },
  { ACCEPTANCE_DB_PASSWORD: 'qa-password' }, { DIRECT_URL: safe.DATABASE_URL }, { SHADOW_DATABASE_URL: safe.DATABASE_URL },
  { DOTENV_CONFIG_PATH: '.env' }, { NODE_OPTIONS: '--require dotenv/config' },
];
overrides.forEach((override, index) => test(`unsafe identity override ${index + 1} refuses writes`, () => assert.throws(() => assertIsolatedTarget({ ...safe, ...override }))));
test('entirely absent identity refuses writes', () => assert.throws(() => assertIsolatedTarget({})));
