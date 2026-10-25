// Standalone, bounded HTTP/real-PostgreSQL concurrency evidence. Never targets an existing DB.
// node tests/integration/device-membership-http-concurrency.cjs <new-or-resumable evidence directory>
// Uses existing local dependencies/images; no application build, QA access or source instrumentation.
const fs = require('node:fs');
const path = require('node:path');
const cp = require('node:child_process');
const crypto = require('node:crypto');
const net = require('node:net');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { performance } = require('node:perf_hooks');
const { assessMembershipAudit } = require('./membership-audit-attribution.cjs');

const root = path.resolve(__dirname, '../..');
const baseline = 'c509db3f03e1c8df93f0842eff57adc49d509724';
const image = 'sha256:215224715e5f47445e394af3e48f48c2d5b0a9eee8dbd3c7ada4deef32d4e64a';
const pgImage = 'sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea';
const local = createRequire(path.resolve(root, '../tahili-m37-integration/package.json'));
const { chromium } = local('playwright');
const { buildSync } = local('esbuild');
const { encodeReply } = local('next/dist/compiled/react-server-dom-webpack/client.node');
const dir = path.resolve(process.argv[2] || path.join(root, 'release-evidence/mission-41-c1-20261025'));
const localBuild = process.env.C2_LOCAL_BUILD === '1';
const buildMount = localBuild ? ['--mount', `type=bind,source=${path.join(root, '.next')},target=/app/.next,readonly`] : [];
assert.ok(dir.includes('release-evidence') && !/TahiliPrivate|recovery/i.test(dir));
fs.mkdirSync(dir, { recursive: true });
const hash = x => crypto.createHash('sha256').update(x).digest('hex');
const save = (name, value) => fs.writeFileSync(path.join(dir, name), JSON.stringify(value, null, 2));
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const q = value => "'" + String(value).replaceAll("'", "''") + "'";
const specs = [
  { id: 'DEVICE_TRANSFER_FIRST', kind: 'transfer', replacementFirst: false },
  { id: 'DEVICE_REPLACEMENT_BEFORE_TRANSFER', kind: 'transfer', replacementFirst: true },
  { id: 'DEVICE_REVOCATION_FIRST', kind: 'revoke', replacementFirst: false },
  { id: 'DEVICE_REPLACEMENT_FIRST', kind: 'revoke', replacementFirst: true },
];
const matrixFile = path.join(dir, 'FOUR_CASE_MATRIX.json');
const matrix = fs.existsSync(matrixFile) ? JSON.parse(fs.readFileSync(matrixFile, 'utf8')) : [];
const entryPointMode = require.main !== module;
const pending = entryPointMode ? [] : specs.filter(s => !matrix.some(x => x.id === s.id && x.result === 'PASS') && matrix.filter(x => x.id === s.id).length < 2);
assert.ok(entryPointMode || pending.length, 'No unexecuted/bounded-retry scenario remains');
const id = crypto.randomBytes(6).toString('hex');
const prefix = `tahili-acceptance-${id}`;
const label = `${localBuild ? '41-c2' : '41-c1'}-${id}`;
const dbPassword = crypto.randomBytes(24).toString('hex');
const testPassword = crypto.randomBytes(24).toString('hex');
const authSecret = crypto.randomBytes(32).toString('hex');
const redact = value => [dbPassword, testPassword, authSecret].reduce((s, secret) => s.split(secret).join('[REDACTED]'), String(value));
const port = 43193;
const origin = `http://127.0.0.1:${port}`;
const env = {
  ...process.env, NODE_ENV: 'production', NEXT_TELEMETRY_DISABLED: '1',
  TAHILI_ENVIRONMENT: 'acceptance', TAHILI_DISPOSABLE_TEST_DB: '1',
  ACCEPTANCE_RUN_ID: id, COMPOSE_PROJECT_NAME: prefix, ACCEPTANCE_APP_PORT: String(port),
  E2E_BASE_URL: origin, NEXTAUTH_URL: origin, NEXTAUTH_URL_INTERNAL: origin,
  ACCEPTANCE_DB_PASSWORD: dbPassword, POSTGRES_PASSWORD: dbPassword,
  DATABASE_URL: `postgresql://acceptance:${dbPassword}@127.0.0.1:55432/acceptance_${id}`,
  NEXTAUTH_SECRET: authSecret, C1_TEST_PASSWORD: testPassword,
  TAHILI_LOCAL_ACCESS: 'true', TAHILI_LOCAL_PORT: String(port),
  NEXTAUTH_ALLOW_HTTP_LOGIN: 'true', AUTH_TRUST_HOST: 'true',
};
for (const key of ['DIRECT_URL', 'SHADOW_DATABASE_URL', 'DOTENV_CONFIG_PATH', 'NODE_OPTIONS', 'TAHILI_LAN_IP']) delete env[key];
require(path.join(root, 'scripts/acceptance/guard.cjs')).assertIsolatedTarget(env);
const runtimeEnv = { ...env, DATABASE_URL: `postgresql://acceptance:${dbPassword}@c1-db:5432/acceptance_${id}?connection_limit=8&pool_timeout=5&application_name=m41-c1-app` };
const resources = { network: null, pg: null, app: null };
const sessions = new Set();
let browser, observer, fixture, actions, permits = new Map();
const pages = {};
let writesBlocked = 0, externalBlocked = 0;
let stage = 'SOURCE_PREFLIGHT';
const checkpoint = next => { const file = path.join(dir, 'RESUME_CHECKPOINT.json'), prior = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}; stage = next; save('RESUME_CHECKPOINT.json', { ...prior, mission: entryPointMode ? '41-C2R' : localBuild ? '41-C2' : '41-C1', baseline, id, stage, resources, pending: entryPointMode ? [] : specs.filter(s => !matrix.some(x => x.id === s.id && x.result === 'PASS')).map(s => s.id), matrix: entryPointMode ? 'ENTRY_POINT_CASES.json' : 'FOUR_CASE_MATRIX.json', qaAccessed: false, productionAccessed: false, secretsSaved: false, atUtc: new Date().toISOString() }); };

function run(exe, args, options = {}) {
  const r = cp.spawnSync(exe, args, { cwd: root, env, windowsHide: true, encoding: 'utf8', timeout: 90000, maxBuffer: 16 * 1024 * 1024, ...options });
  if (r.status !== 0) throw new Error(`${path.basename(exe)} ${args[0]} failed (${r.status}); raw output suppressed`);
  return r.stdout.trim();
}
const docker = (args, options) => run('docker', args, options);
function owned(container, purpose) {
  assert.ok(container && [resources.pg, resources.app].includes(container));
  const x = JSON.parse(docker(['inspect', container]))[0];
  assert.equal(x.Config.Labels['tahili.mission'], label);
  assert.equal(x.Config.Labels['com.docker.compose.project'], prefix);
  assert.equal(x.Name, `/${prefix}-${purpose}`);
  assert.ok(!x.Mounts.some(m => m.Type === 'volume'));
  for (const m of x.Mounts.filter(m => m.Type === 'bind')) {
    assert.ok(localBuild && purpose === 'app' && m.Destination === '/app/.next' && m.RW === false);
    assert.ok(m.Source.replaceAll('\\', '/').toLowerCase().endsWith('/tahili-m41-c2-audit/.next'));
  }
  assert.deepEqual(Object.keys(x.NetworkSettings.Networks), [resources.network]);
  for (const bindings of Object.values(x.HostConfig.PortBindings || {})) for (const p of bindings || []) {
    assert.equal(p.HostIp, '127.0.0.1'); assert.notEqual(p.HostPort, '3101');
  }
  return x;
}
async function freePort(p) {
  await new Promise((resolve, reject) => { const server = net.createServer(); server.once('error', reject); server.listen(p, '127.0.0.1', () => server.close(resolve)); });
}

// Persistent psql transport: no process spawn, spawnSync, or cached stats transaction in a lock window.
class PgSession {
  constructor(name) {
    owned(resources.pg, 'db');
    this.name = name; this.sequence = 0; this.buffer = ''; this.active = null; this.dead = false;
    this.child = cp.spawn('docker', ['exec', '-e', `PGAPPNAME=${name}`, '-i', resources.pg, 'psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-U', 'acceptance', '-d', `acceptance_${id}`], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    this.closed = new Promise(resolve => this.child.on('close', code => { this.dead = true; if (this.active) { clearTimeout(this.active.timer); this.active.reject(Error('Owned PostgreSQL session closed')); this.active = null; } resolve(code); }));
    this.child.stdout.on('data', b => { this.buffer += b.toString('utf8'); let end; while ((end = this.buffer.indexOf('\n')) >= 0) { const line = this.buffer.slice(0, end).replace(/\r$/, ''); this.buffer = this.buffer.slice(end + 1); const a = this.active; if (!a) continue; if (line === a.token) { clearTimeout(a.timer); this.active = null; a.resolve(a.lines.join('\n').trim()); } else a.lines.push(line); } });
    this.child.stderr.on('data', () => {}); // Never retain raw SQL/data errors.
    this.child.on('error', () => { if (this.active) this.active.reject(Error('Owned PostgreSQL transport failed')); });
    sessions.add(this);
  }
  async raw(sql) {
    assert.ok(!this.dead && !this.active, 'One outstanding query per independent session');
    const token = `C1_QUERY_END_${++this.sequence}`;
    return new Promise((resolve, reject) => {
      this.active = { token, resolve, reject, lines: [], timer: setTimeout(() => { reject(Error('Bounded PostgreSQL command deadline')); }, 16000) };
      this.child.stdin.write(sql + '\n\\echo ' + token + '\n');
    });
  }
  async json(sql) { return JSON.parse(await this.raw(sql)); }
  async init() {
    const meta = await this.json(`SELECT json_build_object('pid',pg_backend_pid(),'database',current_database(),'serverVersion',current_setting('server_version_num'));`);
    assert.equal(meta.database, `acceptance_${id}`); this.pid = meta.pid; return this;
  }
  async close() {
    if (!this.dead) { if (!this.active) this.child.stdin.end('ROLLBACK;\n\\q\n'); else this.child.stdin.end(); await this.closed; }
    sessions.delete(this);
  }
}

async function setup() {
  assert.equal(run('git', ['rev-parse', `${baseline}^{tree}`]), 'dc81472f2481212e3b5d598795804b0e52296e95');
  const sourceFiles = ['src/lib/device-replacement.ts', 'src/app/(app)/devices/actions.ts', 'src/app/(app)/users/actions.ts', 'src/lib/patient-access.ts', 'src/lib/permission-store.ts', 'src/lib/perms.ts', 'prisma/schema.prisma'];
  const buildProof = localBuild ? JSON.parse(fs.readFileSync(path.join(dir, 'LOCAL_BUILD_PROOF.json'), 'utf8')) : null;
  if (localBuild) {
    assert.equal(buildProof.exit, 0); assert.equal(fs.readFileSync(path.join(root, '.next/BUILD_ID'), 'utf8').trim(), buildProof.buildId);
    assert.equal(hash(fs.readFileSync(path.join(root, '.next/server/server-reference-manifest.json'))), buildProof.actionManifestSha256);
    assert.equal(run('git', ['diff', '--name-only', baseline, '--', 'src', 'prisma', 'package.json', 'package-lock.json']), 'src/app/(app)/users/actions.ts');
    runtimeEnv.GIT_REVISION = 'c2-local-' + buildProof.sourceUsersSha256.slice(0, 12);
  }
  const hashes = Object.fromEntries(sourceFiles.map(file => { const normalize = s => s.toString('utf8').replace(/\r\n/g, '\n'); const current = hash(normalize(fs.readFileSync(path.join(root, file)))); const base = hash(normalize(cp.execFileSync('git', ['show', `${baseline}:${file}`], { cwd: root, windowsHide: true }))); assert.equal(current, localBuild && file === 'src/app/(app)/users/actions.ts' ? buildProof.sourceUsersSha256 : base); return [file, current]; }));
  const img = JSON.parse(docker(['image', 'inspect', image]))[0]; assert.equal(img.Config.Labels['org.opencontainers.image.revision'], baseline);
  assert.equal(docker(['info', '--format', '{{.OSType}}']), 'linux');
  save('SOURCE_BASELINE.json', { baseline, image, hashes, applicationSourceUnchanged: !localBuild, localBuildProof: buildProof, sourceTree: 'dc81472f2481212e3b5d598795804b0e52296e95', noDockerBuild: true });
  save('SCENARIO_PLAN.json', (entryPointMode ? [] : specs).map(s => ({ ...s, participants: ['Authenticated ADMIN membership action', 'Authenticated PROSTHETICS markReplaced', 'Independent new-row lock barrier', 'Independent read-only PostgreSQL observer'], expected: s.replacementFirst ? 'replacement commits and is audited before membership revocation/transfer proceeds' : 'membership change commits before replacement authorization proceeds; replacement denied without device/audit mutation' })));
  await freePort(port); await freePort(55432);
  resources.network = `${prefix}-network`;
  docker(['network', 'create', '--label', `tahili.mission=${label}`, resources.network]); checkpoint('EMPTY_DISPOSABLE_DATABASE_STARTING');
  resources.pg = docker(['run', '-d', '--rm', '--pull=never', '--name', `${prefix}-db`, '--label', `tahili.mission=${label}`, '--label', `com.docker.compose.project=${prefix}`, '--network', resources.network, '--network-alias', 'c1-db', '--memory', '768m', '--tmpfs', '/var/lib/postgresql/data:rw,size=512m', '-p', '127.0.0.1:55432:5432', '-e', 'POSTGRES_USER=acceptance', '-e', 'POSTGRES_PASSWORD', '-e', `POSTGRES_DB=acceptance_${id}`, pgImage]);
  owned(resources.pg, 'db'); checkpoint('DISPOSABLE_DATABASE_CREATED');
  let ready = false;
  // The image's temporary initialization server listens on Unix sockets; require the final TCP server.
  for (let n = 0; n < 30; n++) { if (cp.spawnSync('docker', ['exec', resources.pg, 'pg_isready', '-h', '127.0.0.1', '-U', 'acceptance'], { windowsHide: true, stdio: 'ignore' }).status === 0) { ready = true; break; } await sleep(200); }
  assert.ok(ready, 'Owned PostgreSQL readiness');
  observer = await new PgSession('m41-c1-observer').init();
  assert.equal(Number(await observer.raw("SELECT count(*) FROM pg_tables WHERE schemaname='public';")), 0);
  const ddl = docker(['run', '--rm', '--pull=never', '--network=none', '--read-only', '--entrypoint', 'node', image, 'node_modules/prisma/build/index.js', 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', 'prisma/schema.prisma', '--script']);
  assert.ok(!/^\s*(DROP|TRUNCATE|DELETE)\b/im.test(ddl)); await observer.raw(ddl);
  await observer.raw("SET default_transaction_read_only=on; SET statement_timeout='2000ms';");
  save('ISOLATION.json', { runId: id, project: prefix, resources, database: `acceptance_${id}`, appOrigin: origin, networkInternal: false, dedicatedBridgeOnlyOwnedContainers: true, publishedPortsLoopbackOnly: true, persistentVolumes: 0, productionOrQaAccess: false, schemaInitialization: 'from-empty DDL only in verified new DB', resetOrMigrationExecution: false, schemaSha256: hashes['prisma/schema.prisma'] });
  const seedSource = `import {PrismaClient} from '@prisma/client';import bcrypt from 'bcryptjs';import {loadPermissionsFromStore} from './src/lib/permission-store';const p=new PrismaClient();(async()=>{const u=new URL(process.env.DATABASE_URL);if(u.hostname!=='c1-db'||u.pathname!=='/acceptance_${id}')throw Error('Disposable only');const passwordHash=await bcrypt.hash(process.env.C1_TEST_PASSWORD,10);const a=await p.branch.create({data:{name:'SYNTHETIC C1 actor branch'}}),b=await p.branch.create({data:{name:'SYNTHETIC C1 patient branch'}});const accounts={};for(const role of ['ADMIN','PROSTHETICS']){const x=await p.user.create({data:{username:'c1_${id}_'+role,fullName:'SYNTHETIC C1 '+role,role,branchId:a.id,passwordHash,isActive:true,needsActivation:false}});const perms=await loadPermissionsFromStore(x.id,x.role,{findRolePermissions:role=>p.rolePermission.findMany({where:{role}}),findUserPermissions:userId=>p.userPermission.findMany({where:{userId}})});accounts[role]={id:x.id,username:x.username,role:x.role,authVersion:x.authVersion,permissions:[...perms]};}await p.orgSetting.create({data:{id:1,autoBackup:false}});const cases=[];for(const spec of ${JSON.stringify(pending)}){const ca=await p.center.create({data:{name:'SYNTHETIC '+spec.id+' A'}}),cb=await p.center.create({data:{name:'SYNTHETIC '+spec.id+' B'}});const patient=await p.patient.create({data:{fullName:'SYNTHETIC '+spec.id,branchId:b.id}});const member=await p.centerMembership.create({data:{userId:accounts.PROSTHETICS.id,centerId:ca.id,role:'DEVICE_OPERATOR',startDate:new Date('2020-01-01')}});await p.appointment.create({data:{patientId:patient.id,centerId:ca.id,scheduledAt:new Date('2026-11-02T10:00:00Z'),notes:'SYNTHETIC C1 scope only'}});const device=await p.device.create({data:{patientId:patient.id,type:'SYNTHETIC C1 device',serialNo:'SYNTHETIC '+spec.id,createdById:accounts.PROSTHETICS.id,nextMaintenanceAt:new Date('2026-11-10T10:00:00Z')}});cases.push({...spec,patientId:patient.id,deviceId:device.id,membershipId:member.id,centerA:ca.id,centerB:cb.id});}console.log(JSON.stringify({accounts,cases,branchA:a.id,branchB:b.id,permissionOverrides:await p.userPermission.count()+await p.rolePermission.count()}));})().catch(()=>{console.error('Synthetic isolated fixture initialization failed');process.exitCode=1;}).finally(()=>p.$disconnect());`;
  const compiled = buildSync({ stdin: { contents: seedSource, resolveDir: root, loader: 'ts' }, absWorkingDir: root, tsconfig: path.join(root, 'tsconfig.json'), bundle: true, platform: 'node', target: 'node20', format: 'cjs', packages: 'external', write: false, logLevel: 'silent' }).outputFiles[0].text;
  fixture = JSON.parse(docker(['run', '-i', '--rm', '--pull=never', '--read-only', '--network', resources.network, '--entrypoint', 'node', '-e', 'DATABASE_URL', '-e', 'C1_TEST_PASSWORD', image], { env: runtimeEnv, input: compiled }));
  assert.equal(fixture.permissionOverrides, 0); assert.ok(fixture.accounts.PROSTHETICS.permissions.includes('devices.maintain'));
  save('SYNTHETIC_FIXTURES.json', { ...fixture, accounts: Object.fromEntries(Object.entries(fixture.accounts).map(([k, a]) => [k, { id: a.id, role: a.role, authVersion: a.authVersion, permissions: a.permissions }])), entirelyNewSyntheticDatabase: true, qaCredentialsUsed: false });
  const actionProbe = "const fs=require('fs'),m=JSON.parse(fs.readFileSync('.next/server/server-reference-manifest.json'));console.log(JSON.stringify(Object.entries(m.node).filter(([id,e])=>['checkUsername','markReplaced','endUserCenterMembership','updateUserCenterMembership','placeUserInCenter'].includes(e.exportedName)).map(([id,e])=>({id,name:e.exportedName,workers:Object.keys(e.workers)}))));";
  actions = Object.fromEntries(JSON.parse(docker(['run', '--rm', '--pull=never', '--read-only', '--network=none', ...buildMount, '--entrypoint', 'node', image, '-e', actionProbe])).map(x => [x.name, x]));
  for (const name of ['checkUsername', 'markReplaced', 'endUserCenterMembership', 'updateUserCenterMembership']) assert.ok(actions[name]);
  const appKeys = ['DATABASE_URL', 'NEXTAUTH_URL', 'NEXTAUTH_URL_INTERNAL', 'NEXTAUTH_SECRET', 'TAHILI_LOCAL_ACCESS', 'TAHILI_LOCAL_PORT', 'NEXTAUTH_ALLOW_HTTP_LOGIN', 'AUTH_TRUST_HOST', 'NEXT_TELEMETRY_DISABLED', ...(localBuild ? ['GIT_REVISION'] : [])];
  resources.app = docker(['run', '-d', '--rm', '--pull=never', '--name', `${prefix}-app`, '--label', `tahili.mission=${label}`, '--label', `com.docker.compose.project=${prefix}`, '--network', resources.network, '--read-only', ...buildMount, '--tmpfs', '/tmp:rw,size=64m', '--tmpfs', '/app/.next/cache:rw,size=64m,mode=1777', '--tmpfs', '/app/uploads:rw,size=64m,mode=1777', '-p', `127.0.0.1:${port}:3000`, ...appKeys.flatMap(k => ['-e', k]), image], { env: runtimeEnv });
  owned(resources.app, 'app'); checkpoint('ISOLATED_APPLICATION_STARTING');
  let up = false; for (let n = 0; n < 30; n++) { try { const r = await fetch(origin + '/login', { signal: AbortSignal.timeout(1000) }); await r.arrayBuffer(); if (r.status === 200) { up = true; break; } } catch {} await sleep(200); } assert.ok(up, 'Owned application login availability');
  browser = await chromium.launch({ headless: true });
  for (const role of ['ADMIN', 'PROSTHETICS']) await login(role);
  save('AUTHENTICATED_ROLES.json', { method: 'Normal username action, password/CSRF NextAuth login, actual session identity/role/authVersion', roles: Object.entries(fixture.accounts).map(([role, a]) => ({ role, id: a.id, verified: true, permissions: a.permissions })), permissionOverrides: 0, credentialsCookiesTokensSaved: false });
  checkpoint('AUTHENTICATED_ISOLATED_FIXTURES_READY');
}

async function who(role) {
  return pages[role].evaluate(async expected => { const r = await fetch('/api/auth/session', { cache: 'no-store' }); const s = await r.json(); return { matches: s?.user?.id === expected.id && s.user.role === expected.role && s.user.authVersion === expected.authVersion }; }, fixture.accounts[role]);
}
async function login(role) {
  const account = fixture.accounts[role];
  const context = await browser.newContext({ baseURL: origin, serviceWorkers: 'block', acceptDownloads: false });
  const page = await context.newPage(); pages[role] = page;
  await context.route('**/*', async route => {
    try {
      const req = route.request(), u = new URL(req.url());
      if (['data:', 'blob:'].includes(u.protocol)) return route.continue();
      if (u.origin !== origin) { externalBlocked++; return route.abort(); }
      if (u.pathname === '/readiness' || u.pathname.startsWith('/api/readiness')) return route.abort();
      if (['GET', 'HEAD'].includes(req.method())) return route.continue();
      if (req.method() !== 'POST') return route.abort();
      const aid = await req.headerValue('next-action');
      if (await req.headerValue('origin') !== origin || new URL(req.frame().url()).origin !== origin) return route.abort();
      if (u.pathname === '/login' && aid === actions.checkUsername.id && JSON.stringify(JSON.parse(req.postData() || 'null')) === JSON.stringify([account.username])) return route.continue();
      if (u.pathname === '/api/auth/callback/credentials' && !aid && new URLSearchParams(req.postData() || '').get('username') === account.username) return route.continue();
      const permit = permits.get(await req.headerValue('x-c1-case'));
      if (permit && !permit.used && permit.role === role && permit.id === aid && permit.path === u.pathname) { permit.used = true; permit.dispatchedAtUtc = new Date().toISOString(); return route.continue(); }
      writesBlocked++; return route.abort();
    } catch { return route.abort(); }
  });
  await page.goto(origin + '/login', { waitUntil: 'domcontentloaded' });
  await page.locator('#u').fill(account.username); await page.getByRole('button', { name: 'متابعة', exact: true }).click();
  await page.locator('#p').waitFor({ state: 'visible' }); await page.locator('#p').fill(testPassword);
  await page.getByRole('button', { name: 'دخول', exact: true }).click(); await page.waitForURL(u => u.pathname !== '/login');
  assert.ok((await who(role)).matches, 'Genuine current identity required');
  await page.goto(origin + (role === 'ADMIN' ? '/users' : '/devices'), { waitUntil: 'domcontentloaded' });
  console.log(JSON.stringify({ event: 'AUTHENTICATED', role }));
}

// All session RPCs, form encoding and metadata lookups complete BEFORE holding a barrier.
async function prepare(role, name, args, route, deniedActorProbe = false) {
  assert.ok((await who(role)).matches); assert.ok(['markReplaced', 'endUserCenterMembership', 'updateUserCenterMembership', 'placeUserInCenter'].includes(name));
  if (deniedActorProbe) assert.ok(localBuild && role === 'PROSTHETICS' && ['updateUserCenterMembership', 'placeUserInCenter'].includes(name));
  else assert.equal(role, name === 'markReplaced' ? 'PROSTHETICS' : 'ADMIN');
  const encoded = await encodeReply(args.map(a => { if (!a?.__form) return a; const fd = new FormData(); for (const [k, v] of Object.entries(a.__form)) fd.append(k, String(v)); return fd; }));
  const wire = typeof encoded === 'string' ? { text: encoded } : { fields: [...encoded.entries()] };
  const nonce = crypto.randomBytes(20).toString('hex'), permit = { role, id: actions[name].id, path: route, used: false };
  permits.set(nonce, permit);
  return { permit, send: async () => {
    try { return await pages[role].evaluate(async ({ wire, nonce, aid, route }) => {
      const headers = { 'Next-Action': aid, 'X-C1-Case': nonce, Accept: 'text/x-component' }; let body;
      if (wire.fields) { body = new FormData(); for (const [k, v] of wire.fields) body.append(k, v); }
      else { body = wire.text; headers['Content-Type'] = 'text/plain;charset=UTF-8'; }
      const r = await fetch(route, { method: 'POST', headers, body, redirect: 'manual' });
      const text = await r.text(); const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return { status: r.status, errorFrame: /(?:^|\n)[0-9a-f]+:E\{/.test(text), bytes: new TextEncoder().encode(text).length, sha256: Array.from(new Uint8Array(digest), n => n.toString(16).padStart(2, '0')).join('') };
    }, { wire, nonce, aid: actions[name].id, route }); } finally { permits.delete(nonce); }
  } };
}

async function graph() {
  await observer.raw('SELECT pg_stat_clear_snapshot();');
  return observer.json(`SELECT coalesce(json_agg(json_build_object('pid',pid,'xid',backend_xid::text,'waitType',wait_event_type,'waitEvent',wait_event,'blockers',pg_blocking_pids(pid),'queryClass',CASE WHEN query~*'INSERT.*audit_logs' THEN 'audit-insert' WHEN query~*'UPDATE.*center_memberships' THEN 'membership-update' WHEN query~*'SELECT.*FROM users.*FOR UPDATE' THEN 'account-lock' WHEN query~*'FROM.*Device.*FOR UPDATE' THEN 'device-lock' WHEN query~*'FROM center_memberships.*FOR SHARE' THEN 'membership-share' ELSE 'other' END)),'[]'::json) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND wait_event_type='Lock';`);
}
async function until(predicate) {
  const limit = performance.now() + 3500; let last = [];
  do { last = await graph(); if (predicate(last)) return last; await sleep(15); } while (performance.now() < limit);
  const e = Error('Required PostgreSQL blocking relationship not observed within bound'); e.lastGraph = last; throw e;
}
async function snapshots() {
  const names = JSON.parse(await observer.raw("SELECT json_agg(tablename ORDER BY tablename) FROM pg_tables WHERE schemaname='public';"));
  const union = names.map(t => { assert.ok(/^[A-Za-z0-9_]+$/.test(t)); return `SELECT '${t}' name,count(*)::int n,md5(coalesce(string_agg(to_jsonb(t)::text,'' ORDER BY to_jsonb(t)::text),'')) fp FROM public."${t}" t`; }).join(' UNION ALL ');
  return observer.json(`SELECT json_object_agg(name,json_build_object('count',n,'hash',fp)) FROM (${union}) s;`);
}
async function state(f) {
  return observer.json(`SELECT json_build_object('device',(SELECT to_jsonb(d) FROM "Device" d WHERE id=${q(f.deviceId)}),'memberships',(SELECT coalesce(json_agg(to_jsonb(m) ORDER BY id),'[]'::json) FROM center_memberships m WHERE "userId"=${q(fixture.accounts.PROSTHETICS.id)} AND "centerId" IN (${f.centerA},${f.centerB})),'audit',(SELECT coalesce(json_agg(json_build_object('id',id,'userId',"userId",'recordId',"recordId",'tableName',"tableName",'action',action,'newValue',"newValue",'createdAtEpoch',extract(epoch FROM "createdAt" AT TIME ZONE 'UTC')) ORDER BY "createdAt",id),'[]'::json) FROM audit_logs WHERE "recordId" IN (${q(f.deviceId)},${q(f.membershipId)}) OR ("tableName"='center_memberships' AND "newValue"->>'centerId'=${q(f.centerB)})));`);
}
function logSummary(since) {
  const r = cp.spawnSync('docker', ['logs', '--since', since, resources.app], { windowsHide: true, encoding: 'utf8', timeout: 10000, maxBuffer: 4 * 1024 * 1024 });
  const text = (r.stdout || '') + (r.stderr || '');
  return { authorizationDenied: /Error:\s*غير مصرح/.test(text), transactionFailures: ['P2028', 'P2034', '40P01', '55P03', '57014', 'deadlock detected', 'lock timeout'].filter(x => text.includes(x)), rawLogsSaved: false };
}

async function observerDiagnosis() {
  let timerAt; const start = performance.now();
  const tick = new Promise(resolve => setTimeout(() => { timerAt = performance.now(); resolve(); }, 0));
  docker(['exec', resources.pg, 'psql', '-X', '-qAt', '-U', 'acceptance', '-d', `acceptance_${id}`, '-c', 'SELECT 1']);
  const syncFinished = performance.now(); await tick;
  let asyncTimerAt; const asyncStart = performance.now();
  const asyncTick = new Promise(resolve => setTimeout(() => { asyncTimerAt = performance.now(); resolve(); }, 0));
  await observer.raw('SELECT pg_sleep(0.15);'); const asyncFinished = performance.now(); await asyncTick;
  const diagnosis = { measuredOnOwnedDisposableDatabaseOnly: true, synchronousDockerProbeMs: syncFinished - start, synchronousTimerDelayMs: timerAt - start, timerCouldRunDuringSynchronousProbe: timerAt < syncFinished, persistentAsyncProbeMs: asyncFinished - asyncStart, asyncTimerDelayMs: asyncTimerAt - asyncStart, timerRanBeforeAsyncProbeCompleted: asyncTimerAt < asyncFinished,
    confirmed: ['Old observer blocks the Node event loop that services Playwright/CDP and route guards.', 'Old action helper awaits identity checks and form encoding inside the held-lock window.', 'Historical attempts with results.length=1 never submitted the second action after failing the first-wait predicate.'],
    notProvenHistorically: ['Exact timing/cause of every historical miss was not recorded; do not infer a PostgreSQL or authorization defect.', 'The one historical first wait alone did not prove the second participant overlapped.'],
    correction: 'Persistent independent asynchronous psql observer; current stats in separate autocommit queries; pre-encode/authenticate before barrier; assert actual directed blocking edges and distinct backend PIDs.', timingNotUsedForConcurrencyPass: true };
  assert.ok(!diagnosis.timerCouldRunDuringSynchronousProbe && diagnosis.timerRanBeforeAsyncProbeCompleted);
  save('OBSERVER_DIAGNOSIS.json', diagnosis);
}

async function scenario(f) {
  const started = new Date().toISOString(); checkpoint('PREPARING_' + f.id);
  const databaseTimeBefore = Number(await observer.raw('SELECT extract(epoch FROM clock_timestamp());'));
  const before = await state(f), beforeHashes = await snapshots();
  const replacement = await prepare('PROSTHETICS', 'markReplaced', [f.deviceId], '/devices');
  const mutation = f.kind === 'revoke'
    ? await prepare('ADMIN', 'endUserCenterMembership', [fixture.accounts.PROSTHETICS.id, f.membershipId], '/users')
    : await prepare('ADMIN', 'updateUserCenterMembership', [fixture.accounts.PROSTHETICS.id, f.membershipId, { __form: { centerId: f.centerB, role: 'DEVICE_OPERATOR', specialty: 'SYNTHETIC C1 transfer', ...(localBuild ? { actorId: fixture.accounts.PROSTHETICS.id } : {}) } }], '/users');
  const barrier = await new PgSession('m41-c1-barrier-' + f.id).init();
  let first, second, wait1, wait2, locks, observationError = null;
  let releaseAt;
  try {
    await barrier.raw(`BEGIN; SET LOCAL lock_timeout='1500ms'; SET LOCAL statement_timeout='8000ms'; SET LOCAL idle_in_transaction_session_timeout='12000ms'; SELECT id FROM ${f.replacementFirst ? '"Device"' : 'center_memberships'} WHERE id=${q(f.replacementFirst ? f.deviceId : f.membershipId)} FOR UPDATE;`);
    first = (f.replacementFirst ? replacement.send() : mutation.send()).catch(() => ({ transportError: true }));
    wait1 = await until(g => g.some(x => x.blockers.includes(barrier.pid)));
    const firstPid = wait1.find(x => x.blockers.includes(barrier.pid)).pid;
    second = (f.replacementFirst ? mutation.send() : replacement.send()).catch(() => ({ transportError: true }));
    wait2 = await until(g => g.some(x => x.pid !== firstPid && (x.blockers.includes(firstPid) || x.blockers.includes(barrier.pid))));
    locks = await observer.json(`SELECT coalesce(json_agg(json_build_object('pid',l.pid,'lockType',l.locktype,'relation',c.relname,'mode',l.mode,'granted',l.granted,'transactionId',l.transactionid::text)),'[]'::json) FROM pg_locks l LEFT JOIN pg_class c ON c.oid=l.relation WHERE l.pid IN (${[barrier.pid, ...wait2.map(x => x.pid)].join(',')});`);
    checkpoint('TWO_PARTICIPANTS_BLOCKED_' + f.id);
  } catch (e) { observationError = e.message; wait2 = e.lastGraph || wait2; }
  finally { releaseAt = new Date().toISOString(); await barrier.raw('COMMIT;'); await barrier.close(); }
  const responses = await Promise.all([first, second].filter(Boolean));
  const after = await state(f), afterHashes = await snapshots(), errors = logSummary(started);
  const databaseTimeAfter = Number(await observer.raw('SELECT extract(epoch FROM clock_timestamp());'));
  const auditTimesCorrect = after.audit.every(a => Number(a.createdAtEpoch) >= databaseTimeBefore && Number(a.createdAtEpoch) <= databaseTimeAfter);
  const firstPid = wait1?.find(x => x.blockers.includes(barrier.pid))?.pid;
  const secondNode = wait2?.find(x => x.pid !== firstPid && (x.blockers.includes(firstPid) || x.blockers.includes(barrier.pid)));
  const interleaving = !observationError && firstPid && secondNode && firstPid !== secondNode.pid && barrier.pid !== secondNode.pid;
  const replacementResponse = f.replacementFirst ? responses[0] : responses[1];
  const membershipResponse = f.replacementFirst ? responses[1] : responses[0];
  const deviceAudits = after.audit.filter(a => a.tableName === 'devices' && a.recordId === f.deviceId);
  const membershipAudits = after.audit.filter(a => a.tableName === 'center_memberships');
  const member = after.memberships.find(m => m.id === f.membershipId);
  const fixedFields = d => { const out = { ...d }; delete out.status; delete out.nextMaintenanceAt; return out; };
  const deviceCorrect = f.replacementFirst
    ? after.device.status === 'REPLACED' && after.device.nextMaintenanceAt === null && JSON.stringify(fixedFields(before.device)) === JSON.stringify(fixedFields(after.device)) && deviceAudits.length === 1 && deviceAudits[0].userId === fixture.accounts.PROSTHETICS.id && replacementResponse?.status === 200 && !replacementResponse.errorFrame
    : JSON.stringify(before.device) === JSON.stringify(after.device) && deviceAudits.length === 0 && replacementResponse?.status >= 400 && replacementResponse.errorFrame && errors.authorizationDenied;
  const auditCriterion = assessMembershipAudit({ ...f, after, adminId: fixture.accounts.ADMIN.id, operatorId: fixture.accounts.PROSTHETICS.id, oldMembershipId: f.membershipId });
  const memberCorrect = member?.status === 'INACTIVE' && auditCriterion.pass && membershipResponse?.status === 200 && !membershipResponse.errorFrame && (f.kind !== 'transfer' || after.memberships.some(m => m.centerId === f.centerB && m.status === 'ACTIVE'));
  const unrelatedChanged = Object.keys(beforeHashes).filter(t => !['Device', 'center_memberships', 'audit_logs'].includes(t) && JSON.stringify(beforeHashes[t]) !== JSON.stringify(afterHashes[t]));
  const unexpectedEscalation = (locks || []).filter(l => l.lockType === 'relation' && (['AccessExclusiveLock', 'ExclusiveLock', 'ShareRowExclusiveLock'].includes(l.mode) || l.mode === 'ShareLock' && !['RolePermission', 'UserPermission'].includes(l.relation)));
  const pass = !!interleaving && deviceCorrect && memberCorrect && auditTimesCorrect && unrelatedChanged.length === 0 && errors.transactionFailures.length === 0 && unexpectedEscalation.length === 0;
  const result = { id: f.id, runId: id, attempt: matrix.filter(x => x.id === f.id).length + 1, result: pass ? 'PASS' : observationError ? 'BLOCKED' : 'FAIL', kind: f.kind, replacementFirst: f.replacementFirst, authenticatedRoles: ['ADMIN', 'PROSTHETICS'], effectivePermissionOverrides: 0,
    before, after, responses, interleavingProven: !!interleaving, proof: { barrierPid: barrier.pid, firstPid, secondPid: secondNode?.pid || null, firstWait: wait1, secondWait: wait2, locks, releaseAt, requestDispatches: [replacement.permit, mutation.permit].map(p => ({ role: p.role, dispatched: p.used, dispatchedAtUtc: p.dispatchedAtUtc || null })), expectedSourcePermissionMetadataShareLocksPreserved: true },
    checks: { deviceCorrect, memberCorrect, auditTimesCorrect, databaseTimeBefore, databaseTimeAfter, unrelatedChanged, unrelatedTablesUnchanged: unrelatedChanged.length === 0, unexpectedLockEscalation: unexpectedEscalation, noUnexpectedTransactionFailure: errors.transactionFailures.length === 0 },
    auditAttribution: { replacementActorMatches: deviceAudits.length ? deviceAudits[0].userId === fixture.accounts.PROSTHETICS.id : null, ...auditCriterion },
    errors, observationError, tableHashesBefore: beforeHashes, tableHashesAfter: afterHashes, rawResponsesOrSecretsSaved: false };
  matrix.push(result); save('FOUR_CASE_MATRIX.json', matrix); save(f.id + '_ATTEMPT_' + result.attempt + '.json', result); checkpoint('SAVED_' + f.id);
  console.log(JSON.stringify({ event: 'SCENARIO', id: f.id, result: result.result, interleaving: !!interleaving, firstPid, secondPid: secondNode?.pid || null }));
}

async function auditFailureChecks() {
  const f = fixture.cases.find(x => x.id === 'DEVICE_TRANSFER_FIRST');
  const existing = await state(f), active = existing.memberships.find(m => m.centerId === f.centerB && m.status === 'ACTIVE');
  assert.ok(active, 'Successful transfer fixture needed for negative and rollback checks');
  const args = [fixture.accounts.PROSTHETICS.id, active.id, { __form: { centerId: f.centerA, role: 'DEVICE_OPERATOR', specialty: 'SYNTHETIC C2 denied/rollback', actorId: fixture.accounts.ADMIN.id } }];
  const sameHashes = (a, b) => Object.keys(a).every(t => a[t].count === b[t].count && a[t].hash === b[t].hash);
  checkpoint('DENIED_TRANSFER_WITH_SPOOFED_ACTOR');
  const denied = await prepare('PROSTHETICS', 'updateUserCenterMembership', args, '/users', true);
  const beforeDenied = await snapshots(), denial = await denied.send(), afterDenied = await snapshots();
  assert.ok(denial.status >= 400 && denial.errorFrame && sameHashes(beforeDenied, afterDenied), 'Rejected transfer must leave every table and audit unchanged');
  save('DENIED_TRANSFER.json', { status: 'PASS', actualAuthenticatedRole: 'PROSTHETICS', untrustedActorClaim: 'ADMIN fixture ID', request: denial, allTableHashesBefore: beforeDenied, allTableHashesAfter: afterDenied, allRowsAndAuditsUnchanged: true });
  checkpoint('AUDIT_FAILURE_ROLLBACK_CHECK');
  const rollback = await prepare('ADMIN', 'updateUserCenterMembership', args, '/users');
  const beforeRollback = await snapshots(), beforeState = await state(f);
  const barrier = await new PgSession('m41-c2-audit-fk-barrier').init();
  let response, wait, cancellation;
  try {
    // Only this fresh ADMIN fixture row is locked. The new trusted audit FK must wait here
    // after membership writes; cancelling that exact audit INSERT proves real DB rollback.
    await barrier.raw(`BEGIN; SET LOCAL idle_in_transaction_session_timeout='10000ms'; SELECT id FROM users WHERE id=${q(fixture.accounts.ADMIN.id)} FOR UPDATE;`);
    const pending = rollback.send();
    wait = await until(g => g.some(x => x.queryClass === 'audit-insert' && x.blockers.includes(barrier.pid)));
    const target = wait.find(x => x.queryClass === 'audit-insert' && x.blockers.includes(barrier.pid));
    assert.ok(target.pid !== barrier.pid && target.pid !== observer.pid);
    cancellation = await observer.json(`SELECT json_build_object('cancelled',pg_cancel_backend(pid),'pid',pid) FROM pg_stat_activity WHERE pid=${target.pid} AND datname=current_database() AND wait_event_type='Lock' AND query~*'INSERT.*audit_logs' AND ${barrier.pid}=ANY(pg_blocking_pids(pid));`);
    assert.ok(cancellation.cancelled); response = await pending;
  } finally { await barrier.raw('COMMIT;'); await barrier.close(); }
  const afterRollback = await snapshots(), afterState = await state(f);
  assert.ok(response.status >= 400 && response.errorFrame && sameHashes(beforeRollback, afterRollback), 'Required audit failure must roll back membership writes and leave no success audit');
  save('AUDIT_ROLLBACK.json', { status: 'PASS', actualAuthenticatedRole: 'ADMIN', failurePoint: 'Actual audit INSERT FK check waiting on fresh ADMIN fixture row; exact owned backend query cancelled', wait, barrierPid: barrier.pid, cancellation, response, before: beforeState, after: afterState, allTableHashesBefore: beforeRollback, allTableHashesAfter: afterRollback, allRowsAndAuditsUnchanged: true, sourceOrSchemaInstrumentation: false, noMigrationOrReset: true, expectedQueryCancellation: true });
  checkpoint('DENIAL_AND_REAL_AUDIT_ROLLBACK_PASS');
  console.log(JSON.stringify({ event: 'AUDIT_FAILURE_CHECKS', denied: 'PASS', rollback: 'PASS', realAuditInsertObserved: true }));
}

async function cleanup() {
  if (browser) await browser.close();
  for (const s of [...sessions]) { try { await s.close(); } catch {} }
  for (const purpose of ['app', 'pg']) if (resources[purpose]) { owned(resources[purpose], purpose === 'pg' ? 'db' : 'app'); docker(['stop', resources[purpose]], { timeout: 30000 }); }
  if (resources.network) { const n = JSON.parse(docker(['network', 'inspect', resources.network]))[0]; assert.equal(n.Labels['tahili.mission'], label); assert.equal(Object.keys(n.Containers || {}).length, 0); docker(['network', 'rm', resources.network]); }
  save('RESOURCE_CLEANUP.json', { id, resources, ownedResourcesStoppedAndRemoved: true, persistentVolumesCreated: 0, qaTargeted: false, productionTargeted: false, imagesDeleted: false });
}

// Reuse the isolated runtime, real login and read-only observer for adjacent entry-point regressions.
module.exports = { setup, prepare, snapshots, cleanup, PgSession, graph, until, save, checkpoint,
  current: () => ({ fixture, observer, resources }) };

if (require.main === module) (async () => {
  try {
    checkpoint('SOURCE_PREFLIGHT'); await setup(); await observerDiagnosis();
    const deadlocksBefore = Number(await observer.raw('SELECT deadlocks FROM pg_stat_database WHERE datname=current_database();'));
    for (const f of fixture.cases) await scenario(f);
    if (localBuild && specs.every(s => matrix.some(x => x.id === s.id && x.result === 'PASS'))) await auditFailureChecks();
    const deadlocksAfter = Number(await observer.raw('SELECT deadlocks FROM pg_stat_database WHERE datname=current_database();'));
    const residual = await observer.json("SELECT json_build_object('idleTransactions',count(*) FILTER(WHERE state='idle in transaction'),'lockWaiters',count(*) FILTER(WHERE wait_event_type='Lock')) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid();");
    save('DATABASE_INTEGRITY.json', { deadlocksBefore, deadlocksAfter, noDeadlocks: deadlocksBefore === deadlocksAfter, residual, noResidualBarrierTransactions: Number(residual.idleTransactions) === 0, noResidualLockWaiters: Number(residual.lockWaiters) === 0, authenticatedSourceActions: true, originalQaDataAccessed: false, writesBlocked, externalBlocked });
    assert.equal(deadlocksAfter, deadlocksBefore, 'Unexpected disposable-database deadlock');
    assert.equal(Number(residual.idleTransactions), 0); assert.equal(Number(residual.lockWaiters), 0);
    if (specs.some(s => !matrix.some(x => x.id === s.id && x.result === 'PASS'))) process.exitCode = 1;
    checkpoint('FOUR_CASE_EXECUTION_COMPLETE');
  } catch (e) { save('RUN_ERROR.json', { stage, type: e.name, message: redact(e.message), rawDetailsSuppressed: true }); console.error('Bounded isolated runner failed at ' + stage + ': ' + redact(e.message)); process.exitCode = 1; }
  finally { try { await cleanup(); checkpoint('STOPPED_OWNED_RESOURCES_REMOVED'); } catch (e) { save('CLEANUP_ERROR.json', { type: e.name, message: redact(e.message), rawDetailsSuppressed: true }); process.exitCode = 1; } }
})();
