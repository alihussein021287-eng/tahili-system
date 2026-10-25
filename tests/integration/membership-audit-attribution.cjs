// Pure audit criterion, also executable against captured real HTTP/PostgreSQL evidence.
// No database connection, fixture mutation, permission change or mocked production action.
const fs = require('node:fs');
const path = require('node:path');

function assessMembershipAudit({ kind, after, adminId, operatorId, centerA, centerB, oldMembershipId }) {
  const events = after.audit.filter(a => a.tableName === 'center_memberships');
  const expectedCenter = kind === 'transfer' ? centerB : centerA;
  const target = after.memberships.find(m => m.centerId === expectedCenter);
  const event = events[0];
  const checks = {
    exactlyOneEvent: events.length === 1,
    updateEvent: event?.action === 'UPDATE',
    correctMembership: event?.recordId === (kind === 'transfer' ? target?.id : oldMembershipId),
    affectedOperatorRecorded: event?.newValue?.userId === operatorId,
    correctCenter: event?.newValue?.centerId === expectedCenter,
    correctPlacement: event?.newValue?.placement === (kind === 'transfer' ? 'updated' : 'ended'),
    authenticatedAdminActorRecorded: event?.userId === adminId,
  };
  return { pass: Object.values(checks).every(Boolean), checks, expectedActorId: adminId, actualActorId: event?.userId ?? null };
}
module.exports = { assessMembershipAudit };

if (require.main === module) {
  const dir = path.resolve(process.argv[2]);
  const matrix = JSON.parse(fs.readFileSync(path.join(dir, 'FOUR_CASE_MATRIX_RAW.json'), 'utf8'));
  const fixtures = JSON.parse(fs.readFileSync(path.join(dir, 'SYNTHETIC_FIXTURES.json'), 'utf8'));
  const results = matrix.map(row => {
    const f = fixtures.cases.find(x => x.id === row.id);
    return { id: row.id, ...assessMembershipAudit({ ...f, after: row.after, adminId: fixtures.accounts.ADMIN.id, operatorId: fixtures.accounts.PROSTHETICS.id, oldMembershipId: f.membershipId }) };
  });
  fs.writeFileSync(path.join(dir, 'AUDIT_ATTRIBUTION_REGRESSION.json'), JSON.stringify({ evidenceSource: 'Actual captured PostgreSQL rows after authenticated Server Actions', databaseTestsRepeated: false, results, pass: results.filter(x => x.pass).length, fail: results.filter(x => !x.pass).length }, null, 2));
  console.log(JSON.stringify(results.map(x => ({ id: x.id, result: x.pass ? 'PASS' : 'FAIL', actorRecorded: x.checks.authenticatedAdminActorRecorded }))));
  process.exitCode = results.every(x => x.pass) ? 0 : 1;
}
