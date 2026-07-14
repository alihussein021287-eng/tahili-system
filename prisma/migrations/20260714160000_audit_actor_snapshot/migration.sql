ALTER TABLE "audit_logs" ADD COLUMN "actorUsername" TEXT, ADD COLUMN "actorName" TEXT;

UPDATE "audit_logs" a
SET "actorUsername" = u.username, "actorName" = u."fullName"
FROM users u
WHERE a."userId" = u.id;

ALTER TABLE "audit_logs" DROP CONSTRAINT IF EXISTS "audit_logs_userId_fkey";
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES users(id) ON DELETE SET NULL ON UPDATE CASCADE;
