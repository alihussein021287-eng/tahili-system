-- Per-user read state for role-wide notifications (additive; existing notification rows and flags are untouched).
CREATE TABLE "notification_read_receipts" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_read_receipts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "notification_read_receipts_notificationId_userId_key" ON "notification_read_receipts"("notificationId", "userId");
CREATE INDEX "notification_read_receipts_userId_idx" ON "notification_read_receipts"("userId");

ALTER TABLE "notification_read_receipts" ADD CONSTRAINT "notification_read_receipts_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "notification_read_receipts" ADD CONSTRAINT "notification_read_receipts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
