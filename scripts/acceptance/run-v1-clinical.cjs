// Disposable PostgreSQL only. No env file, shared volume, QA URL, or live credentials.
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const out = path.resolve(root, process.argv[2] || 'release-evidence/v1-clinical-20261027/attempt1');
if (fs.existsSync(out)) throw Error('Refusing overwrite');
fs.mkdirSync(out, { recursive: true });
const id = crypto.randomBytes(6).toString('hex'), pwd = crypto.randomBytes(24).toString('hex');
const name = `tahili-acceptance-${id}-v1-db`, database = `acceptance_${id}`;
const env = { ...process.env, NODE_ENV: 'test', TAHILI_ENVIRONMENT: 'acceptance', TAHILI_DISPOSABLE_TEST_DB: '1', ACCEPTANCE_RUN_ID: id,
  COMPOSE_PROJECT_NAME: `tahili-acceptance-${id}`, ACCEPTANCE_APP_PORT: '38647', E2E_BASE_URL: 'http://127.0.0.1:38647',
  NEXTAUTH_URL: 'http://127.0.0.1:38647', NEXTAUTH_URL_INTERNAL: 'http://127.0.0.1:38647',
  ACCEPTANCE_DB_PORT: '45432', ACCEPTANCE_DB_PASSWORD: pwd, POSTGRES_PASSWORD: pwd, DATABASE_URL: `postgresql://acceptance:${pwd}@127.0.0.1:45432/${database}`,
  M46_STATE: path.join(out, 'LEGACY_STATE.json'), M44_STATE: path.join(out, 'FOUNDATION_STATE.json'), V1_STATE: path.join(out, 'V1_STATE.json') };
for (const k of ['DIRECT_URL', 'SHADOW_DATABASE_URL', 'DOTENV_CONFIG_PATH', 'NODE_OPTIONS', 'M44_CHECKPOINT']) delete env[k];
require('./guard.cjs').assertIsolatedTarget(env);
const clean = s => String(s || '').split(pwd).join('[REDACTED]');
const save = (n, v) => fs.writeFileSync(path.join(out, n), clean(JSON.stringify(v, null, 2)));
function run(exe, args, log, input, extraEnv = env) {
  const r = cp.spawnSync(exe, args, { cwd: root, env: extraEnv, input, encoding: 'utf8', windowsHide: true, timeout: 240000, maxBuffer: 30 * 1024 * 1024 });
  if (log) fs.writeFileSync(path.join(out, log), clean((r.stdout || '') + (r.stderr || '')));
  if (r.status !== 0 || r.error) throw Error(`${path.basename(exe)} failed; ${log || ''}`);
  return r.stdout.trim();
}
let owned;
try {
  const files = run('git', ['ls-files', '--cached', '--others', '--exclude-standard']).split('\n').filter(Boolean);
  const hashes = run('git', ['hash-object', '--stdin-paths'], undefined, files.join('\n') + '\n').split('\n');
  save('SOURCE_BLOBS.json', Object.fromEntries(files.map((p,i) => [p,hashes[i]])));
  owned = run('docker', ['run', '-d', '--rm', '--pull=never', '--name', name, '--label', 'tahili.mission=v1-clinical', '--memory', '768m', '--cpus', '2', '--tmpfs', '/var/lib/postgresql/data:rw,size=512m', '-p', '127.0.0.1:45432:5432', '-e', 'POSTGRES_USER=acceptance', '-e', 'POSTGRES_PASSWORD', '-e', `POSTGRES_DB=${database}`, 'sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea'], 'DOCKER_RUN.log');
  const info = JSON.parse(run('docker', ['inspect', owned]))[0];
  if (info.Name !== `/${name}` || info.Mounts.some(m => m.Type === 'volume') || info.NetworkSettings.Ports['5432/tcp'][0].HostIp !== '127.0.0.1') throw Error('Isolation violation');
  save('ISOLATION.json', { name, owned, mounts: info.Mounts.map(m => ({ type: m.Type, destination: m.Destination })), loopbackOnly: true, qaAccess: false });
  let ready = false;
  for (let i = 0; i < 40; i++) { if (cp.spawnSync('docker', ['exec', owned, 'pg_isready', '-h', '127.0.0.1', '-U', 'acceptance'], { windowsHide: true }).status === 0) { ready = true; break; } Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250); }
  if (!ready) throw Error('Postgres not ready');
  const onlyV1 = process.argv[3] === 'v1-only';
  if (!onlyV1) {
  // Install every committed migration on an independent empty database.
  run('docker', ['exec', owned, 'createdb', '-U', 'acceptance', 'fresh_v1'], 'CREATEDB.log');
  run(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], 'FRESH_INSTALL.log', undefined, { ...env, DATABASE_URL: env.DATABASE_URL.replace('/' + database, '/fresh_v1') });
  save('FRESH_INSTALL.json', { status: 'PASS', actualMigrateDeploy: true, migrations: fs.readdirSync(path.join(root, 'prisma/migrations')).filter(n => fs.existsSync(path.join(root, 'prisma/migrations', n, 'migration.sql'))) });
  }
  // Legacy rows predate M46: execute historical schema DDL, then actual additive SQL.
  const schema = path.join(out, 'BASE.prisma'); fs.writeFileSync(schema, run('git', ['show', 'f1401602d1b75c2d604e54e9de658ca2200fe615:prisma/schema.prisma']));
  const ddl = run(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'diff', '--from-empty', '--to-schema-datamodel', schema, '--script']);
  run('docker', ['exec', '-i', owned, 'psql', '-U', 'acceptance', '-d', database, '-v', 'ON_ERROR_STOP=1'], 'BASE_DDL.log', ddl);
  if (onlyV1) run('docker', ['exec', '-i', owned, 'psql', '-U', 'acceptance', '-d', database, '-v', 'ON_ERROR_STOP=1'], 'M46_MIGRATION.log', fs.readFileSync(path.join(root, 'prisma/migrations/20261027090000_care_stage_operational_completion/migration.sql'), 'utf8'));
  const batches = onlyV1 ? [['CLINICAL', ['tests/integration/v1-clinical-db.test.ts']]] : [
    ['LEGACY', ['tests/integration/care-stage-legacy-db.test.ts']],
    ['CLINICAL', ['tests/integration/center-stage-completion-db.test.ts', 'tests/integration/care-stage-concurrency-db.test.ts', 'tests/integration/v1-clinical-db.test.ts']],
    ['UNIT', ['tests/unit/care-stage-controls.test.tsx', 'tests/unit/serializable-retry.test.ts', 'tests/unit/permission-store.test.ts', 'tests/unit/perms.test.ts']],
  ];
  for (const [key, include] of batches) {
    if (key === 'CLINICAL') {
      const legacyBefore = run('docker', ['exec', owned, 'psql', '-U', 'acceptance', '-d', database, '-Atc', 'SELECT json_agg(s ORDER BY id) FROM "CareStage" s']);
      const sql = fs.readFileSync(path.join(root, 'prisma/migrations/20261027110000_v1_clinical_review/migration.sql'), 'utf8');
      run('docker', ['exec', '-i', owned, 'psql', '-U', 'acceptance', '-d', database, '-v', 'ON_ERROR_STOP=1'], 'ADDITIVE_MIGRATION.log', sql);
      const legacyAfter = run('docker', ['exec', owned, 'psql', '-U', 'acceptance', '-d', database, '-Atc', 'SELECT json_agg(s ORDER BY id) FROM "CareStage" s']);
      if (legacyBefore !== legacyAfter) throw Error('Historical care stages changed during V1 migration');
      save('ADDITIVE_PRESERVATION.json', { historicalStagesUnchanged: true, rowCount: (JSON.parse(legacyAfter || 'null') || []).length });
    }
    const config = path.join(out, `${key}.config.mjs`);
    fs.writeFileSync(config, `import {defineConfig} from 'vitest/config';import path from 'node:path';export default defineConfig({test:{environment:'node',include:${JSON.stringify(include)},fileParallelism:false,testTimeout:30000},resolve:{alias:{'@':path.resolve('src')}}});`);
    run(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--config', config, '--reporter=json', '--outputFile=' + path.join(out, key + '_RESULTS.json')], key + '.log');
  }
  run(process.execPath, ['node_modules/typescript/bin/tsc', '--noEmit', '--incremental', 'false'], 'TYPESCRIPT.log');
  save('RESULT.json', { status: 'PASS', shaAtRun: run('git', ['rev-parse', 'HEAD']), syntheticOnly: true });
  console.log('Focused clinical validation PASS');
} catch (e) { save('ERROR.json', { message: clean(e.message) }); process.exitCode = 1; console.log('Validation failed; inspect sanitized evidence'); }
finally {
  if (owned) { const info = JSON.parse(run('docker', ['inspect', owned]))[0]; if (info.Name !== `/${name}` || info.Config.Labels['tahili.mission'] !== 'v1-clinical') throw Error('Refusing stop'); run('docker', ['stop', owned], 'STOP.log'); }
  save('PRESERVATION.json', { temporaryDatabaseStopped: !!owned, qaAccess: false, productionAccess: false, githubMutation: false });
}
