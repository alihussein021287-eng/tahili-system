// One focused batch against an identified synthetic PostgreSQL tmpfs database.
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process'), crypto = require('node:crypto');
const root = path.resolve(__dirname, '../..');
const out = path.resolve(root, process.argv[2] || 'release-evidence/v1-two-defect-20261027/cycle1');
if (fs.existsSync(out)) throw Error('Refusing overwrite');
fs.mkdirSync(out, { recursive: true });
const id = crypto.randomBytes(6).toString('hex'), password = crypto.randomBytes(24).toString('hex');
const name = `tahili-acceptance-${id}-end-appointment`;
const env = { ...process.env, NODE_ENV: 'test', TAHILI_ENVIRONMENT: 'acceptance', TAHILI_DISPOSABLE_TEST_DB: '1', ACCEPTANCE_RUN_ID: id,
  COMPOSE_PROJECT_NAME: `tahili-acceptance-${id}`, ACCEPTANCE_APP_PORT: '38649', ACCEPTANCE_DB_PORT: '45432', ACCEPTANCE_DB_PASSWORD: password,
  E2E_BASE_URL: 'http://127.0.0.1:38649', NEXTAUTH_URL: 'http://127.0.0.1:38649', NEXTAUTH_URL_INTERNAL: 'http://127.0.0.1:38649',
  DATABASE_URL: `postgresql://acceptance:${password}@127.0.0.1:45432/acceptance_${id}`, POSTGRES_PASSWORD: password,
  END_APPOINTMENT_STATE: path.join(out, 'PERSISTED_STATE.json') };
for (const k of ['DIRECT_URL', 'SHADOW_DATABASE_URL', 'DOTENV_CONFIG_PATH', 'NODE_OPTIONS']) delete env[k];
require('./guard.cjs').assertIsolatedTarget(env);
const clean = s => String(s || '').split(password).join('[REDACTED]');
const save = (name, value) => fs.writeFileSync(path.join(out, name), clean(JSON.stringify(value, null, 2)));
function run(exe, args, log, input) {
  const r = cp.spawnSync(exe, args, { cwd: root, env, input, encoding: 'utf8', windowsHide: true, timeout: 240000, maxBuffer: 20 * 1024 * 1024 });
  if (log) fs.writeFileSync(path.join(out, log), clean((r.stdout || '') + (r.stderr || '')));
  if (r.status !== 0 || r.error) throw Error(`${path.basename(exe)} failed: ${log || ''}`);
  return r.stdout.trim();
}
let owned;
try {
  const files = run('git', ['ls-files', '--cached', '--others', '--exclude-standard']).split('\n');
  const hashes = run('git', ['hash-object', '--stdin-paths'], null, files.join('\n') + '\n').split('\n');
  save('SOURCE_BLOBS.json', Object.fromEntries(files.map((p, i) => [p, hashes[i]])));
  owned = run('docker', ['run', '-d', '--rm', '--pull=never', '--name', name, '--label', 'tahili.mission=v1-end-appointment', '--memory', '768m', '--cpus', '2',
    '--tmpfs', '/var/lib/postgresql/data:rw,size=512m', '-p', '127.0.0.1:45432:5432', '-e', 'POSTGRES_USER=acceptance', '-e', 'POSTGRES_PASSWORD', '-e', `POSTGRES_DB=acceptance_${id}`,
    'sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea'], 'DATABASE_START.log');
  const info = JSON.parse(run('docker', ['inspect', owned]))[0];
  if (info.Name !== '/' + name || info.Mounts.some(m => m.Type === 'volume') || info.NetworkSettings.Ports['5432/tcp'][0].HostIp !== '127.0.0.1') throw Error('Isolation mismatch');
  save('ISOLATION.json', { name, owned, loopbackOnly: true, tmpfsOnly: true, qaAccess: false, productionAccess: false });
  let ready = false;
  for (let i = 0; i < 40; i++) {
    if (cp.spawnSync('docker', ['exec', owned, 'pg_isready', '-U', 'acceptance'], { windowsHide: true }).status === 0) { ready = true; break; }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
  }
  if (!ready) throw Error('Synthetic PostgreSQL unavailable');
  run(process.execPath, ['node_modules/prisma/build/index.js', 'migrate', 'deploy'], 'SYNTHETIC_MIGRATIONS.log');
  const config = path.join(out, 'FOCUSED.config.mjs');
  fs.writeFileSync(config, "import {defineConfig} from 'vitest/config';import path from 'node:path';export default defineConfig({test:{environment:'node',include:['tests/integration/v1-appointment-end-db.test.ts'],fileParallelism:false,testTimeout:30000},resolve:{alias:{'@':path.resolve('src')}}});");
  const args = ['node_modules/vitest/vitest.mjs', 'run', '--config', config, '--reporter=json', '--outputFile=' + path.join(out, 'FOCUSED_RESULTS.json')];
  if (process.argv[3]) args.push('-t', process.argv[3]);
  run(process.execPath, args, 'FOCUSED.log');
  save('RESULT.json', { status: 'PASS', sourceAtRun: run('git', ['rev-parse', 'HEAD']), database: 'synthetic only', liveMigrations: false });
  console.log('Focused appointment/END batch PASS');
} catch (e) { save('ERROR.json', { message: clean(e.message) }); process.exitCode = 1; console.log('Focused batch failed; inspect evidence'); }
finally {
  if (owned) {
    const info = JSON.parse(run('docker', ['inspect', owned]))[0];
    if (info.Name !== '/' + name || info.Config.Labels['tahili.mission'] !== 'v1-end-appointment') throw Error('Refusing stop');
    run('docker', ['stop', owned], 'DATABASE_STOP.log');
  }
  save('PRESERVATION.json', { syntheticDatabaseStopped: !!owned, sharedVolumesTouched: false, githubMutation: false, qaAccess: false, productionAccess: false });
}
