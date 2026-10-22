// Local Docker only; Node built-ins on the host, no dotenv or host npm install.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const assert = require('node:assert/strict');
const { spawnSync, execFileSync } = require('node:child_process');
const { randomBytes, createHash } = require('node:crypto');
const { assertIsolatedTarget } = require('./guard.cjs');
const root = path.resolve(__dirname, '../..');
// The only files overlaid when testing a different application commit.
const harnessFiles = [
  'Dockerfile.acceptance', 'Dockerfile.acceptance.dockerignore', 'docker-compose.acceptance.yml',
  'scripts/acceptance/run.cjs', 'scripts/acceptance/inside.cjs', 'scripts/acceptance/guard.cjs', 'scripts/acceptance/guard.test.cjs',
  'tests/e2e/acceptance/helpers.ts', 'tests/e2e/acceptance/auth.setup.ts',
  'tests/e2e/acceptance/playwright.config.ts', 'tests/e2e/acceptance/playwright.critical.config.ts', 'tests/e2e/acceptance/critical-registration.spec.ts',
  'tests/unit/acceptance-no-skips.test.ts', 'docs/ACCEPTANCE_ISOLATION.md', 'ENVIRONMENTS.md',
];
const env = Object.fromEntries(['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'DOCKER_CONFIG', 'ProgramFiles', 'ProgramData', 'ProgramW6432', 'ALLUSERSPROFILE', 'HOMEDRIVE', 'HOMEPATH'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
const git = (...args) => execFileSync('git', args, { cwd: root, env, encoding: 'utf8' }).trim();
const docker = (...args) => execFileSync('docker', args, { cwd: root, env, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }).trim();
const save = (dir, name, data) => fs.writeFileSync(path.join(dir, name), JSON.stringify(data, null, 2));
const inspect = id => JSON.parse(docker('inspect', id))[0];
function qaSnapshot() {
  const ids = docker('ps', '-aq', '--filter', 'label=com.docker.compose.project=tahili-qa-windows').split(/\s+/).filter(Boolean);
  return ids.map(id => { const c = inspect(id); return { id: c.Id, image: c.Image, startedAt: c.State.StartedAt, restartCount: c.RestartCount, running: c.State.Running, mounts: c.Mounts, networks: c.NetworkSettings.Networks }; });
}
async function freePort() {
  for (let attempt = 0; attempt < 20; attempt++) {
    const port = 32000 + randomBytes(4).readUInt32BE() % 17001;
    const server = net.createServer();
    const free = await new Promise(resolve => { server.once('error', () => resolve(false)); server.listen(port, '127.0.0.1', () => resolve(true)); });
    if (free) { await new Promise(resolve => server.close(resolve)); return port; }
  }
  throw new Error('No free guarded loopback port found');
}
async function main() {
  const args = process.argv.slice(2);
  const guardOnly = args.length === 1 && args[0] === '--guard-only';
  const appRef = args.length === 2 && args[0] === '--app-ref' && /^[a-f0-9]{40}$/.test(args[1]) ? args[1] : null;
  if (args.length && !guardOnly && !appRef) throw new Error('Usage: node scripts/acceptance/run.cjs [--guard-only | --app-ref <full-local-commit-sha>]');
  const guard = spawnSync(process.execPath, ['scripts/acceptance/guard.test.cjs'], { cwd: root, env, stdio: 'inherit' });
  assert.equal(guard.status, 0, 'Negative safety guards failed');
  if (guardOnly) return;
  const context = JSON.parse(docker('context', 'inspect'))[0];
  assert.match(context.Endpoints.docker.Host, /^(unix:\/\/|npipe:\/\/)/, 'Remote Docker contexts are not permitted');
  assert.equal(docker('info', '--format', '{{.OSType}}'), 'linux', 'Linux containers are required');
  const harnessCommit = git('rev-parse', 'HEAD');
  if (appRef) {
    assert.equal(git('rev-parse', `${appRef}^{commit}`), appRef);
    assert.equal(git('status', '--porcelain', '--untracked-files=no'), '', 'Commit harness changes before cross-branch verification');
  }
  const id = randomBytes(6).toString('hex');
  const project = `tahili-acceptance-${id}`;
  assert.equal(docker('ps', '-aq', '--filter', `label=com.docker.compose.project=${project}`), '');
  assert.equal(docker('network', 'ls', '-q', '--filter', `label=com.docker.compose.project=${project}`), '');
  const output = path.join(root, 'release-evidence', 'acceptance-run', id);
  fs.mkdirSync(output, { recursive: true });
  const before = qaSnapshot();
  const volumesBefore = docker('volume', 'ls', '-q').split('\n').sort();
  const existing = docker('ps', '-aq', '--no-trunc').split(/\s+/).filter(Boolean);
  save(output, 'qa-before.json', before);
  const temporaryParent = fs.realpathSync(os.tmpdir());
  const temporary = fs.mkdtempSync(path.join(temporaryParent, 'tahili-acceptance-'));
  const source = path.join(temporary, 'source');
  fs.mkdirSync(source);
  let started = false;
  let runCode = null;
  const compose = ['compose', '--env-file', process.platform === 'win32' ? 'NUL' : '/dev/null', '-p', project, '-f', path.join(source, 'docker-compose.acceptance.yml')];
  const call = (...tail) => docker(...compose, ...tail);
  const logged = (name, ...tail) => {
    const fd = fs.openSync(path.join(output, name), 'w');
    try { const r = spawnSync('docker', [...compose, ...tail], { cwd: root, env, stdio: ['ignore', fd, fd] }); if (r.error) throw r.error; return r.status; }
    finally { fs.closeSync(fd); }
  };
  try {
    if (appRef) {
      const archive = path.join(temporary, 'app.tar');
      fs.writeFileSync(archive, execFileSync('git', ['archive', '--format=tar', appRef], { cwd: root, env, maxBuffer: 100 * 1024 * 1024 }));
      execFileSync('tar', ['-xf', archive, '-C', source], { env });
      for (const file of harnessFiles) {
        fs.mkdirSync(path.dirname(path.join(source, file)), { recursive: true });
        fs.writeFileSync(path.join(source, file), execFileSync('git', ['show', `${harnessCommit}:${file}`], { cwd: root, env }));
      }
    } else {
      // Tracked source plus the explicit harness files: never copy hidden local data.
      const files = new Set([...execFileSync('git', ['ls-files', '-z'], { cwd: root, env, encoding: 'utf8' }).split('\0').filter(Boolean), ...harnessFiles]);
      for (const file of files) {
        fs.mkdirSync(path.dirname(path.join(source, file)), { recursive: true });
        fs.cpSync(path.join(root, file), path.join(source, file), { dereference: false });
      }
    }
    const files = execFileSync('git', ['ls-tree', '-r', '--name-only', appRef || harnessCommit], { cwd: root, env, encoding: 'utf8' }).trim().split('\n');
    const hashes = [...new Set([...files, ...harnessFiles])].map(file => ({ path: file, sha256: createHash('sha256').update(fs.readFileSync(path.join(source, file))).digest('hex') }));
    save(output, 'inputs.json', { harnessCommit, applicationCommit: appRef || harnessCommit, workingChanges: appRef ? '' : git('status', '--porcelain', '--untracked-files=no'), overlay: appRef ? harnessFiles : [], files: hashes });
    const port = await freePort();
    const password = randomBytes(24).toString('hex');
    Object.assign(env, { ACCEPTANCE_RUN_ID: id, COMPOSE_PROJECT_NAME: project, ACCEPTANCE_DB_PASSWORD: password, ACCEPTANCE_APP_PORT: String(port), TAHILI_ENVIRONMENT: 'acceptance', TAHILI_DISPOSABLE_TEST_DB: '1', ACCEPTANCE_EVIDENCE_DIR: output });
    env.E2E_BASE_URL = env.NEXTAUTH_URL = env.NEXTAUTH_URL_INTERNAL = `http://127.0.0.1:${port}`;
    env.DATABASE_URL = `postgresql://acceptance:${password}@127.0.0.1:55432/acceptance_${id}`;
    assertIsolatedTarget(env);
    const config = JSON.parse(call('config', '--format', 'json'));
    assert.equal(config.networks.isolated.internal, true);
    assert.equal(config.services.tests.network_mode, 'service:postgres');
    assert.equal(config.volumes, undefined);
    console.log(`Disposable project ${project}; origin ${env.E2E_BASE_URL}; evidence ${output}`);
    assert.equal(logged('build.log', 'build', 'tests'), 0, 'Acceptance image build failed; see build.log');
    const image = JSON.parse(docker('image', 'inspect', `tahili-acceptance-${id}:local`))[0];
    save(output, 'image.json', { id: image.Id, platform: image.Os, arch: image.Architecture });
    started = true;
    call('up', '-d', '--wait', '--wait-timeout', '60', 'postgres');
    const db = inspect(call('ps', '-q', 'postgres'));
    assert.equal(db.Config.Labels['com.docker.compose.project'], project);
    assert.ok(!existing.includes(db.Id));
    assert.equal(db.Mounts.length, 0);
    assert.ok(Object.hasOwn(db.HostConfig.Tmpfs, '/var/lib/postgresql/data'));
    assert.deepEqual(db.HostConfig.PortBindings, { [`${port}/tcp`]: [{ HostIp: '127.0.0.1', HostPort: String(port) }] });
    assert.equal(Object.keys(db.NetworkSettings.Networks).length, 1);
    const network = JSON.parse(docker('network', 'inspect', Object.keys(db.NetworkSettings.Networks)[0]))[0];
    assert.equal(network.Internal, true);
    assert.equal(network.Labels['com.docker.compose.project'], project);
    save(output, 'isolation.json', { postgres: db.Id, tmpfs: db.HostConfig.Tmpfs, mounts: db.Mounts, ports: db.HostConfig.PortBindings, network: network.Id, internal: network.Internal });
    runCode = logged('worker.log', 'run', '--rm', '--no-deps', 'tests');
    assert.equal(runCode, 0, 'Acceptance failed; original trace/report preserved in this run directory');
    const results = JSON.parse(fs.readFileSync(path.join(output, 'acceptance-results.json'), 'utf8'));
    assert.equal(results.stats.expected, 9);
    assert.equal(results.stats.unexpected, 0);
    assert.equal(results.stats.skipped, 0);
    assert.equal(results.stats.flaky, 0);
    console.log('PASS: 9/9 browser cases, no skips/retries/flaky results');
  } finally {
    if (started) {
      const ids = call('ps', '-aq').split(/\s+/).filter(Boolean);
      for (const container of ids) { const c = inspect(container); assert.equal(c.Config.Labels['com.docker.compose.project'], project); assert.ok(!existing.includes(c.Id)); }
      save(output, 'cleanup-scope.json', { project, containerIds: ids, volumesDeleted: [] });
      call('down', '--timeout', '10');
      assert.equal(docker('ps', '-aq', '--filter', `label=com.docker.compose.project=${project}`), '');
      assert.equal(docker('network', 'ls', '-q', '--filter', `label=com.docker.compose.project=${project}`), '');
    }
    const after = qaSnapshot();
    save(output, 'qa-after.json', after);
    assert.deepEqual(after, before, 'Protected QA identity changed');
    assert.deepEqual(docker('volume', 'ls', '-q').split('\n').sort(), volumesBefore, 'Volume inventory changed');
    save(output, 'completion.json', { runCode, qaUnchanged: true, volumesUnchanged: true, temporaryProjectRemoved: true });
    // Only the freshly created snapshot, after checking its resolved parent and link identity.
    assert.equal(path.dirname(fs.realpathSync(temporary)), temporaryParent);
    assert.ok(path.basename(temporary).startsWith('tahili-acceptance-'));
    assert.ok(!fs.lstatSync(temporary).isSymbolicLink());
    fs.rmSync(temporary, { recursive: true });
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
