const { assertIsolatedTarget } = require('./guard.cjs');
const { spawnSync, spawn } = require('node:child_process');
const { randomBytes } = require('node:crypto');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const target = assertIsolatedTarget();
// No inherited application settings, dotenv loading or real credentials.
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(PATH|HOME|HOSTNAME|ACCEPTANCE_.*|COMPOSE_PROJECT_NAME|TAHILI_ENVIRONMENT|TAHILI_DISPOSABLE_TEST_DB|DATABASE_URL|E2E_BASE_URL|NEXTAUTH_URL|NEXTAUTH_URL_INTERNAL|QA_CREDENTIALS_PATH)$/.test(key)));
Object.assign(env, {
  PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH: '/usr/bin/chromium', NODE_ENV: 'production',
  NEXTAUTH_SECRET: randomBytes(32).toString('hex'), TAHILI_LOCAL_ACCESS: 'true',
  TAHILI_LOCAL_PORT: String(target.port), NEXTAUTH_ALLOW_HTTP_LOGIN: 'true', AUTH_TRUST_HOST: 'true',
  NEXT_TELEMETRY_DISABLED: '1', OTEL_ENABLED: 'false', FARO_ENABLED: 'false',
});
const run = (script, args) => {
  const result = spawnSync(process.execPath, [script, ...args], { env, stdio: 'inherit' });
  assert.equal(result.status, 0, `${script} failed`);
};
async function main() {
  run('scripts/acceptance/guard.test.cjs', []);
  assertIsolatedTarget(env);
  const { PrismaClient } = require('@prisma/client');
  const db = new PrismaClient();
  try {
    const [identity] = await db.$queryRaw`SELECT current_database() AS name, current_user AS role, inet_server_port() AS port`;
    assert.equal(identity.name, `acceptance_${target.id}`);
    assert.equal(identity.role, 'acceptance');
    assert.equal(identity.port, 55432);
    const [tables] = await db.$queryRaw`SELECT count(*)::int AS count FROM pg_tables WHERE schemaname = 'public'`;
    assert.equal(tables.count, 0, 'Refusing to initialize a nonempty database');
    fs.writeFileSync('/evidence/database-before-writes.json', JSON.stringify({ ...identity, publicTables: tables.count }, null, 2));
    assertIsolatedTarget(env);
    run('node_modules/prisma/build/index.js', ['migrate', 'deploy']);
    const bcrypt = require('bcryptjs');
    const branch = await db.branch.create({ data: { name: 'Acceptance registration A' } });
    await db.branch.create({ data: { name: 'Acceptance registration B' } });
    await db.governorate.create({ data: { name: 'Acceptance governorate' } });
    await db.injuryType.create({ data: { name: 'Acceptance injury' } });
    const deadBranch = await db.branch.create({ data: { name: 'Acceptance inactive importer', isActive: false } });
    const rows = [];
    for (const [username, role, branchId] of [['acc-entry', 'DATA_ENTRY', branch.id], ['acc-unassigned', 'DATA_ENTRY', null], ['acc-admin', 'ADMIN', null], ['acc-admin-branch', 'ADMIN', branch.id], ['acc-admin-inactive', 'ADMIN', deadBranch.id]]) {
      const password = randomBytes(18).toString('hex');
      await db.user.create({ data: { username, fullName: username, role, branchId, passwordHash: await bcrypt.hash(password, 10) } });
      rows.push([role, username, password, username].join('\t'));
    }
    fs.writeFileSync(env.QA_CREDENTIALS_PATH, rows.join('\n'), { mode: 0o600 });
  } finally { await db.$disconnect(); }
  const fd = fs.openSync('/evidence/app.log', 'w');
  const app = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(target.port)], { env, stdio: ['ignore', fd, fd] });
  try {
    let ready = false;
    for (let i = 0; i < 120; i++) {
      if (app.exitCode !== null) throw new Error('Disposable app exited before readiness');
      try { if ((await fetch(`${target.origin}/login`, { signal: AbortSignal.timeout(2000) })).ok) { ready = true; break; } } catch {}
      // Bounded readiness polling, never a substitute for UI synchronization.
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    assert.ok(ready, 'Disposable app readiness timeout');
    fs.writeFileSync('/evidence/runtime.json', JSON.stringify({ node: process.version, platform: process.platform, next: require('next/package.json').version, prisma: require('@prisma/client/package.json').version, origin: target.origin }, null, 2));
    run('node_modules/@playwright/test/cli.js', ['test', '-c', 'tests/e2e/acceptance/playwright.critical.config.ts', 'critical-registration.spec.ts']);
  } finally {
    if (app.exitCode === null) { const exit = once(app, 'exit'); app.kill('SIGTERM'); await exit; }
    fs.closeSync(fd);
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
