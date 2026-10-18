// Synthetic bootstrap for the existing guarded referral integration test only.
const { PrismaClient } = require('@prisma/client');
const fs = require('node:fs');
const target = new URL(process.env.DATABASE_URL || 'postgresql://invalid/invalid');
if (process.env.TAHILI_DISPOSABLE_TEST_DB !== '1' || target.hostname !== '127.0.0.1' || target.port !== '55432' || target.pathname !== '/app_test') {
  throw new Error('Requires an explicitly disposable app_test database on isolated loopback:55432');
}
const test = fs.readFileSync('tests/integration/referral-accept-authorization-db.test.ts', 'utf8');
const match = test.match(/const patientId = "([a-z0-9]+)";/);
if (!match) throw new Error('Integration prerequisite changed; review bootstrap');
const db = new PrismaClient();
(async () => {
  const existing = await db.patient.findUnique({ where: { id: match[1] } });
  if (existing) {
    if (existing.fullName !== 'm082-phase4-synthetic-prerequisite') throw new Error('Refuse to overwrite an existing non-bootstrap patient');
  } else {
    await db.patient.create({ data: { id: match[1], fullName: 'm082-phase4-synthetic-prerequisite' } });
  }
  console.log('One synthetic integration prerequisite verified.');
})().catch(() => { console.error('Disposable integration bootstrap failed'); process.exitCode = 1; }).finally(() => db.$disconnect());
