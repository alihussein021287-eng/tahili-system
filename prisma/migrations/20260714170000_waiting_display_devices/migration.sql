CREATE TYPE "DisplayDeviceStatus" AS ENUM ('UNPAIRED', 'PAIRING', 'ACTIVE', 'REVOKED');
CREATE TYPE "DisplayNameMode" AS ENUM ('FULL', 'INITIALS', 'QUEUE_NUMBER');

ALTER TABLE "QueueEntry" ADD COLUMN "centerId" INTEGER;

CREATE TABLE "display_devices" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "centerId" INTEGER,
    "halls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "DisplayDeviceStatus" NOT NULL DEFAULT 'UNPAIRED',
    "nameMode" "DisplayNameMode" NOT NULL DEFAULT 'INITIALS',
    "callDisplaySeconds" INTEGER NOT NULL DEFAULT 45,
    "credentialHash" TEXT,
    "pairedAt" TIMESTAMP(3),
    "pairingCodeHash" TEXT,
    "pairingExpiresAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "display_devices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "display_devices_credentialHash_key" ON "display_devices"("credentialHash");
CREATE UNIQUE INDEX "display_devices_pairingCodeHash_key" ON "display_devices"("pairingCodeHash");
CREATE INDEX "QueueEntry_centerId_createdAt_idx" ON "QueueEntry"("centerId", "createdAt");
CREATE INDEX "display_devices_centerId_status_idx" ON "display_devices"("centerId", "status");
CREATE INDEX "display_devices_status_lastSeenAt_idx" ON "display_devices"("status", "lastSeenAt");

ALTER TABLE "QueueEntry" ADD CONSTRAINT "QueueEntry_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "display_devices" ADD CONSTRAINT "display_devices_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
