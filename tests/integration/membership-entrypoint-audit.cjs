// Bounded real HTTP/PostgreSQL regression; imports only the guarded disposable C2 runtime.
// C2_LOCAL_BUILD=1 node tests/integration/membership-entrypoint-audit.cjs <evidence-dir> before|after
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const h = require('./device-membership-http-concurrency.cjs');
const phase = process.argv[3];
assert.ok(['before', 'after'].includes(phase));
const q = x => "'" + String(x).replaceAll("'", "''") + "'";
const results = [];
let writer, subjectId, centerA, centerB, centerC, inactiveCenter;
const saveProgress = () => { h.save('ENTRY_POINT_CASES.json', results); h.checkpoint('SAVED_ENTRY_POINT_' + results.at(-1).id); };

async function snapshot() {
  const { observer, fixture } = h.current();
  return observer.json(`SELECT json_build_object(
    'users',(SELECT json_agg(json_build_object('id',id,'role',role,'authVersion',"authVersion",'active',"isActive") ORDER BY id) FROM users),
    'memberships',(SELECT coalesce(json_agg(to_jsonb(m) ORDER BY id),'[]'::json) FROM center_memberships m),
    'audit',(SELECT coalesce(json_agg(json_build_object('id',id,'userId',"userId",'action',action,'tableName',"tableName",'recordId',"recordId",'newValue',"newValue",'epoch',extract(epoch FROM "createdAt" AT TIME ZONE 'UTC')) ORDER BY "createdAt",id),'[]'::json) FROM audit_logs)
  );`);
}
function form(centerId, role = 'SECRETARY', spoof = null) {
  return { __form: { centerId, role, specialty: 'SYNTHETIC C2R', actorId: spoof || h.current().fixture.accounts.PROSTHETICS.id } };
}
async function invoke(name, targetId, centerId, role = 'SECRETARY', actor = 'ADMIN', membershipId) {
  const fields = form(centerId, role, actor !== 'ADMIN' ? h.current().fixture.accounts.ADMIN.id : null);
  const args = name === 'placeUserInCenter' ? [targetId, fields] : [targetId, membershipId, fields];
  return h.prepare(actor, name, args, '/users', actor !== 'ADMIN');
}
function unchanged(a, b) { assert.deepEqual(a, b, 'No table may change after rejected or rolled-back action'); }
function checkEvent(before, after, { targetId, centerId, role, placement, response, timeBefore, timeAfter }) {
  const { fixture } = h.current();
  assert.equal(response.status, 200); assert.equal(response.errorFrame, false);
  assert.deepEqual(before.users, after.users, 'Account roles and authVersion must not change');
  const added = after.audit.filter(a => !before.audit.some(b => b.id === a.id));
  assert.equal(added.length, 1, 'Exactly one new success audit');
  const event = added[0];
  const member = after.memberships.find(m => m.userId === targetId && m.centerId === centerId && m.role === role);
  assert(member && member.status === 'ACTIVE' && member.endDate === null);
  assert.equal(event.tableName, 'center_memberships'); assert.equal(event.action, 'UPDATE');
  assert.equal(event.recordId, member.id);
  assert.deepEqual(event.newValue, { userId: targetId, centerId, role, placement });
  assert(event.epoch >= timeBefore && event.epoch <= timeAfter, 'Audit timestamp must match DB execution bounds');
  if (phase === 'before') assert.equal(event.userId, null, 'Old implementation must reproduce the missing actor');
  else assert.equal(event.userId, fixture.accounts.ADMIN.id, 'Actor is the real logged-in ADMIN, never target or client actorId');
  assert.notEqual(fixture.accounts.ADMIN.id, targetId);
  return event;
}
async function success(id, name, targetId, centerId, role, placement, extra, membershipId) {
  const { observer } = h.current();
  const before = await snapshot(), hashesBefore = await h.snapshots();
  const timeBefore = Number(await observer.raw('SELECT extract(epoch FROM clock_timestamp());'));
  const request = await invoke(name, targetId, centerId, role, 'ADMIN', membershipId);
  const response = await request.send(), after = await snapshot(), hashesAfter = await h.snapshots();
  const timeAfter = Number(await observer.raw('SELECT extract(epoch FROM clock_timestamp());'));
  const event = checkEvent(before, after, { targetId, centerId, role, placement, response, timeBefore, timeAfter });
  for (const table of Object.keys(hashesBefore)) if (!['center_memberships', 'audit_logs'].includes(table)) assert.deepEqual(hashesBefore[table], hashesAfter[table], table + ' must not change');
  extra?.(before, after);
  results.push({ id, status: phase === 'before' ? 'EXPECTED_REGRESSION_FAILURE_CONFIRMED' : 'PASS', invariant: 'audit.userId equals authenticated ADMIN', actualActorId: event.userId, expectedActorId: h.current().fixture.accounts.ADMIN.id, untrustedActorIgnored: phase !== 'before', response, before, after, hashesBefore, hashesAfter, timeBefore, timeAfter });
  saveProgress();
}
async function deny(id, request) {
  const before = await snapshot(), hashesBefore = await h.snapshots();
  const response = await request.send(), after = await snapshot(), hashesAfter = await h.snapshots();
  assert(response.status >= 400 && response.errorFrame); unchanged(hashesBefore, hashesAfter); unchanged(before, after);
  results.push({ id, status: 'PASS', response, allTablesAndAuditsUnchanged: true, before, after, hashesBefore, hashesAfter }); saveProgress();
}
async function auditRollback() {
  const request = await invoke('placeUserInCenter', subjectId, centerA);
  const before = await snapshot(), hashesBefore = await h.snapshots();
  const { fixture, observer } = h.current();
  const barrier = await new h.PgSession('m41-c2r-audit-fk-barrier').init();
  let response, wait, cancellation;
  try {
    await barrier.raw(`BEGIN; SET LOCAL lock_timeout='1500ms'; SET LOCAL statement_timeout='8000ms'; SET LOCAL idle_in_transaction_session_timeout='10000ms'; SELECT id FROM users WHERE id=${q(fixture.accounts.ADMIN.id)} FOR UPDATE;`);
    const pending = request.send();
    wait = await h.until(g => g.some(x => x.queryClass === 'audit-insert' && x.blockers.includes(barrier.pid)));
    const target = wait.find(x => x.queryClass === 'audit-insert' && x.blockers.includes(barrier.pid));
    assert(target.pid !== barrier.pid && target.pid !== observer.pid);
    cancellation = await observer.json(`SELECT json_build_object('cancelled',pg_cancel_backend(pid),'pid',pid) FROM pg_stat_activity WHERE pid=${target.pid} AND datname=current_database() AND wait_event_type='Lock' AND query~*'INSERT.*audit_logs' AND ${barrier.pid}=ANY(pg_blocking_pids(pid));`);
    assert(cancellation.cancelled); response = await pending;
  } finally { await barrier.raw('COMMIT;'); await barrier.close(); }
  const after = await snapshot(), hashesAfter = await h.snapshots();
  assert(response.status >= 400 && response.errorFrame); unchanged(before, after); unchanged(hashesBefore, hashesAfter);
  results.push({ id: 'D_REAL_AUDIT_INSERT_FAILURE', status: 'PASS', actualAuthenticatedRole: 'ADMIN', wait, barrierPid: barrier.pid, cancellation, response, before, after, hashesBefore, hashesAfter, allRowsAndAuditsUnchanged: true, sourceOrSchemaInstrumentation: false }); saveProgress();
}
(async () => {
  try {
    await h.setup();
    const { fixture, observer } = h.current();
    assert.equal(fixture.cases.length, 0, 'No repeated device/concurrency fixtures');
    writer = await new h.PgSession('m41-c2r-fresh-fixtures').init();
    subjectId = 'synthetic-c2r-' + crypto.randomBytes(8).toString('hex');
    await writer.raw(`INSERT INTO users (id,username,"passwordHash","fullName",role,"branchId","updatedAt") SELECT ${q(subjectId)},${q(subjectId)},"passwordHash",'SYNTHETIC C2R secretary','SECRETARY',"branchId",now() FROM users WHERE id=${q(fixture.accounts.PROSTHETICS.id)};`);
    const centers = await writer.json(`WITH inserted AS (INSERT INTO centers(name,active) VALUES ('SYNTHETIC C2R A',true),('SYNTHETIC C2R B',true),('SYNTHETIC C2R C',true),('SYNTHETIC C2R inactive',false) RETURNING id,name) SELECT json_object_agg(name,id) FROM inserted;`);
    [centerA, centerB, centerC, inactiveCenter] = ['A','B','C','inactive'].map(s => centers['SYNTHETIC C2R ' + s]);
    await writer.close();
    h.save('ENTRY_POINT_FIXTURES.json', { phase, subjectId, subjectRole: 'SECRETARY', centerA, centerB, centerC, inactiveCenter, actors: { ADMIN: fixture.accounts.ADMIN.id, PROSTHETICS: fixture.accounts.PROSTHETICS.id }, credentialsSaved: false, newDisposableDatabaseOnly: true });
    const deadlocksBefore = Number(await observer.raw('SELECT deadlocks FROM pg_stat_database WHERE datname=current_database();'));
    await success('A_AUTHORIZED_PLACEMENT', 'placeUserInCenter', subjectId, centerA, 'SECRETARY', 'active', (_, after) => assert.equal(after.memberships.filter(m => m.userId === subjectId && m.status === 'ACTIVE').length, 1));
    await success('B_SINGLE_CENTER_TRANSFER', 'placeUserInCenter', subjectId, centerB, 'SECRETARY', 'active', (_, after) => {
      const old = after.memberships.find(m => m.userId === subjectId && m.centerId === centerA);
      assert.equal(old.status, 'INACTIVE'); assert(old.endDate); assert.equal(after.memberships.filter(m => m.userId === subjectId && m.status === 'ACTIVE').length, 1);
    });
    if (phase === 'after') {
      await deny('C_NON_ADMIN_WITH_FORGED_ACTOR', await invoke('placeUserInCenter', subjectId, centerA, 'SECRETARY', 'PROSTHETICS'));
      await deny('C_ROLE_MISMATCH', await invoke('placeUserInCenter', subjectId, centerA, 'SPECIALIST'));
      await deny('C_INACTIVE_CENTER', await invoke('placeUserInCenter', subjectId, inactiveCenter));
      await auditRollback();
      await success('E_CLIENT_ACTOR_CANNOT_OVERRIDE_ADMIN', 'placeUserInCenter', subjectId, centerB, 'SECRETARY', 'active');
      const current = await snapshot(), old = current.memberships.find(m => m.userId === subjectId && m.centerId === centerB);
      await success('F_UPDATE_ENTRY_POINT_REGRESSION', 'updateUserCenterMembership', subjectId, centerC, 'SECRETARY', 'updated', (_, after) => {
        assert.equal(after.memberships.find(m => m.id === old.id).status, 'INACTIVE');
        assert.equal(after.memberships.filter(m => m.userId === subjectId && m.status === 'ACTIVE').length, 1);
      }, old.id);
      const operatorId = fixture.accounts.PROSTHETICS.id;
      await success('G_MULTI_CENTER_FIRST', 'placeUserInCenter', operatorId, centerA, 'DEVICE_OPERATOR', 'active');
      await success('G_MULTI_CENTER_SECOND', 'placeUserInCenter', operatorId, centerB, 'DEVICE_OPERATOR', 'active', (_, after) => assert.equal(after.memberships.filter(m => m.userId === operatorId && m.status === 'ACTIVE').length, 2));
      const multi = (await snapshot()).memberships.find(m => m.userId === operatorId && m.centerId === centerB);
      await success('G_MULTI_CENTER_UPDATE', 'updateUserCenterMembership', operatorId, centerC, 'DEVICE_OPERATOR', 'updated', (_, after) => {
        assert.equal(after.memberships.find(m => m.userId === operatorId && m.centerId === centerA).status, 'ACTIVE');
        assert.equal(after.memberships.find(m => m.id === multi.id).status, 'INACTIVE');
        assert.equal(after.memberships.filter(m => m.userId === operatorId && m.status === 'ACTIVE').length, 2);
      }, multi.id);
    }
    const deadlocksAfter = Number(await observer.raw('SELECT deadlocks FROM pg_stat_database WHERE datname=current_database();'));
    const residual = await observer.json("SELECT json_build_object('idleTransactions',count(*) FILTER(WHERE state='idle in transaction'),'lockWaiters',count(*) FILTER(WHERE wait_event_type='Lock')) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid();");
    assert.equal(deadlocksAfter, deadlocksBefore); assert.equal(Number(residual.idleTransactions), 0); assert.equal(Number(residual.lockWaiters), 0);
    h.save('ENTRY_POINT_DATABASE_INTEGRITY.json', { deadlocksBefore, deadlocksAfter, residual, noUnauthorizedMutation: true, noQaAccess: true, phase, scenarioCount: results.length });
    console.log(JSON.stringify({ phase, cases: results.map(x => ({ id: x.id, status: x.status })), noDeadlocks: true }));
  } catch (e) { h.save('ENTRY_POINT_ERROR.json', { type: e.name, message: 'Bounded entry-point assertion/setup failed; inspect sanitized evidence and source assertion', stackLocations: String(e.stack).split('\n').filter(s => /\.cjs:\d+:\d+\)?$/.test(s)).slice(0,5) }); console.error('Entry-point regression failed: '+e.name); process.exitCode = 1; }
  finally { await writer?.close(); await h.cleanup(); h.checkpoint('ENTRY_POINT_RUN_STOPPED_OWNED_RESOURCES_REMOVED'); }
})();
