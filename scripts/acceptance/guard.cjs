// No dotenv: this boundary must run before database clients or test setup.
function assertIsolatedTarget(env = process.env) {
  const fail = () => { throw new Error('Acceptance requires an identified disposable target; refusing all writes'); };
  const id = env.ACCEPTANCE_RUN_ID;
  if (env.TAHILI_ENVIRONMENT !== 'acceptance' || env.TAHILI_DISPOSABLE_TEST_DB !== '1' || !/^[a-f0-9]{12}$/.test(id || '')) fail();
  if (env.COMPOSE_PROJECT_NAME !== `tahili-acceptance-${id}`) fail();
  const port = Number(env.ACCEPTANCE_APP_PORT);
  if (!/^[0-9]+$/.test(env.ACCEPTANCE_APP_PORT || '') || !Number.isInteger(port) || port < 32000 || port > 49000) fail();
  const origin = `http://127.0.0.1:${port}`;
  if (env.E2E_BASE_URL !== origin || env.NEXTAUTH_URL !== origin || env.NEXTAUTH_URL_INTERNAL !== origin) fail();
  if (!/^[a-f0-9]{48}$/.test(env.ACCEPTANCE_DB_PASSWORD || '')) fail();
  // Explicit high loopback port for hosts reserving 55432 (Windows Hyper-V).
  const dbPort = env.ACCEPTANCE_DB_PORT || '55432';
  if (dbPort !== '55432' && (!/^[0-9]+$/.test(dbPort) || Number(dbPort) < 32000 || Number(dbPort) > 49000)) fail();
  // Exact equality rejects QA names, alternate hosts, encoded targets and connection-string overrides.
  if (env.DATABASE_URL !== `postgresql://acceptance:${env.ACCEPTANCE_DB_PASSWORD}@127.0.0.1:${dbPort}/acceptance_${id}`) fail();
  if (env.DIRECT_URL || env.SHADOW_DATABASE_URL || env.DOTENV_CONFIG_PATH || env.NODE_OPTIONS) fail();
  return { origin, id, port };
}
module.exports = { assertIsolatedTarget };
