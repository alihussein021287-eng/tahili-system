-- Link handoff notices to the handoff they represent. This makes their lifecycle explicit.
ALTER TABLE "Notification" ADD COLUMN "handoffId" TEXT;

-- Preserve existing notices that used the established handoff-number body format.
UPDATE "Notification" AS notification
SET "handoffId" = handoff."id"
FROM "patient_handoffs" AS handoff
WHERE notification."handoffId" IS NULL
  AND notification."body" = ('رقم التسليم: ' || handoff."id");

-- A completed, returned, or cancelled handoff is no longer an actionable unread notice.
UPDATE "Notification" AS notification
SET "read" = true
FROM "patient_handoffs" AS handoff
WHERE notification."handoffId" = handoff."id"
  AND handoff."status" IN ('DONE', 'RETURNED', 'CANCELLED');

CREATE INDEX "Notification_handoffId_read_idx" ON "Notification"("handoffId", "read");

ALTER TABLE "Notification"
ADD CONSTRAINT "Notification_handoffId_fkey"
FOREIGN KEY ("handoffId") REFERENCES "patient_handoffs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
