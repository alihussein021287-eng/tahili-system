CREATE TYPE "CenterMembershipRole" AS ENUM ('CENTER_MANAGEMENT', 'HEAD_THERAPIST', 'THERAPIST', 'DEVICE_OPERATOR');
CREATE TYPE "CenterMembershipStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED');
CREATE TYPE "CenterServiceType" AS ENUM ('PSYCHOLOGICAL', 'OCCUPATIONAL_MEDICAL', 'OCCUPATIONAL_ART', 'ULCER_CARE', 'PAIN_MEDICINE', 'HYPERBARIC', 'OZONE');
CREATE TYPE "CenterProgramStatus" AS ENUM ('ASSESSMENT', 'ACTIVE', 'COMPLETED', 'CANCELLED');
CREATE TYPE "CenterSessionMode" AS ENUM ('INDIVIDUAL', 'GROUP');
CREATE TYPE "CenterSessionStatus" AS ENUM ('SCHEDULED', 'ATTENDED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');
CREATE TYPE "CenterResourceType" AS ENUM ('DEVICE', 'ROOM', 'HALL');
CREATE TYPE "CenterResourceStatus" AS ENUM ('AVAILABLE', 'MAINTENANCE', 'OUT_OF_SERVICE');

CREATE TABLE "center_memberships" (
  "id" TEXT NOT NULL, "centerId" INTEGER NOT NULL, "userId" TEXT NOT NULL,
  "role" "CenterMembershipRole" NOT NULL, "specialty" TEXT,
  "status" "CenterMembershipStatus" NOT NULL DEFAULT 'ACTIVE',
  "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "endDate" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "center_memberships_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "center_resources" (
  "id" TEXT NOT NULL, "centerId" INTEGER NOT NULL, "type" "CenterResourceType" NOT NULL,
  "name" TEXT NOT NULL, "serviceType" "CenterServiceType", "capacity" INTEGER NOT NULL DEFAULT 1,
  "status" "CenterResourceStatus" NOT NULL DEFAULT 'AVAILABLE', "roomId" INTEGER, "therapyHallId" INTEGER,
  "unavailableFrom" TIMESTAMP(3), "unavailableTo" TIMESTAMP(3), "maintenanceNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "center_resources_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "center_programs" (
  "id" TEXT NOT NULL, "centerId" INTEGER NOT NULL, "patientId" TEXT NOT NULL,
  "referralRequestId" TEXT, "serviceType" "CenterServiceType" NOT NULL, "track" TEXT,
  "mode" "CenterSessionMode" NOT NULL DEFAULT 'INDIVIDUAL', "assignedToId" TEXT,
  "status" "CenterProgramStatus" NOT NULL DEFAULT 'ASSESSMENT', "goals" TEXT, "protocol" TEXT,
  "plannedSessions" INTEGER, "startDate" TIMESTAMP(3), "expectedEndDate" TIMESTAMP(3),
  "initialSummary" TEXT, "finalSummary" TEXT, "improvementLevel" TEXT, "recommendation" TEXT,
  "returnToConsultancy" BOOLEAN NOT NULL DEFAULT false, "closedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "center_programs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "center_assessments" (
  "id" TEXT NOT NULL, "programId" TEXT NOT NULL, "patientId" TEXT NOT NULL, "kind" TEXT NOT NULL,
  "functionalCapacity" TEXT, "summary" TEXT, "sensitiveNotes" TEXT, "improvementLevel" TEXT,
  "recommendation" TEXT, "createdById" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "center_assessments_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "center_sessions" (
  "id" TEXT NOT NULL, "centerId" INTEGER NOT NULL, "programId" TEXT NOT NULL, "patientId" TEXT NOT NULL,
  "assignedToId" TEXT, "resourceId" TEXT, "appointmentId" TEXT, "scheduledAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL, "mode" "CenterSessionMode" NOT NULL DEFAULT 'INDIVIDUAL',
  "status" "CenterSessionStatus" NOT NULL DEFAULT 'SCHEDULED', "attended" BOOLEAN,
  "procedure" TEXT, "result" TEXT, "progress" TEXT, "notes" TEXT, "sensitiveNotes" TEXT,
  "completedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "center_sessions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "center_memberships_centerId_userId_role_key" ON "center_memberships"("centerId", "userId", "role");
CREATE INDEX "center_memberships_userId_status_idx" ON "center_memberships"("userId", "status");
CREATE INDEX "center_memberships_centerId_status_idx" ON "center_memberships"("centerId", "status");
CREATE UNIQUE INDEX "center_resources_centerId_name_key" ON "center_resources"("centerId", "name");
CREATE INDEX "center_resources_centerId_serviceType_status_idx" ON "center_resources"("centerId", "serviceType", "status");
CREATE UNIQUE INDEX "center_programs_referralRequestId_key" ON "center_programs"("referralRequestId");
CREATE INDEX "center_programs_centerId_status_idx" ON "center_programs"("centerId", "status");
CREATE INDEX "center_programs_assignedToId_status_idx" ON "center_programs"("assignedToId", "status");
CREATE INDEX "center_programs_patientId_centerId_idx" ON "center_programs"("patientId", "centerId");
CREATE INDEX "center_assessments_programId_kind_idx" ON "center_assessments"("programId", "kind");
CREATE INDEX "center_assessments_patientId_createdAt_idx" ON "center_assessments"("patientId", "createdAt");
CREATE UNIQUE INDEX "center_sessions_appointmentId_key" ON "center_sessions"("appointmentId");
CREATE UNIQUE INDEX "center_sessions_programId_scheduledAt_key" ON "center_sessions"("programId", "scheduledAt");
CREATE INDEX "center_sessions_centerId_scheduledAt_idx" ON "center_sessions"("centerId", "scheduledAt");
CREATE INDEX "center_sessions_assignedToId_scheduledAt_idx" ON "center_sessions"("assignedToId", "scheduledAt");
CREATE INDEX "center_sessions_resourceId_scheduledAt_endsAt_idx" ON "center_sessions"("resourceId", "scheduledAt", "endsAt");
CREATE INDEX "center_sessions_patientId_scheduledAt_idx" ON "center_sessions"("patientId", "scheduledAt");

ALTER TABLE "center_memberships" ADD CONSTRAINT "center_memberships_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "centers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "center_memberships" ADD CONSTRAINT "center_memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "center_resources" ADD CONSTRAINT "center_resources_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "centers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "center_resources" ADD CONSTRAINT "center_resources_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "center_resources" ADD CONSTRAINT "center_resources_therapyHallId_fkey" FOREIGN KEY ("therapyHallId") REFERENCES "therapy_halls"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "center_programs" ADD CONSTRAINT "center_programs_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "center_programs" ADD CONSTRAINT "center_programs_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "center_programs" ADD CONSTRAINT "center_programs_referralRequestId_fkey" FOREIGN KEY ("referralRequestId") REFERENCES "referral_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "center_programs" ADD CONSTRAINT "center_programs_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "center_assessments" ADD CONSTRAINT "center_assessments_programId_fkey" FOREIGN KEY ("programId") REFERENCES "center_programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "center_assessments" ADD CONSTRAINT "center_assessments_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "center_sessions" ADD CONSTRAINT "center_sessions_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "centers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "center_sessions" ADD CONSTRAINT "center_sessions_programId_fkey" FOREIGN KEY ("programId") REFERENCES "center_programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "center_sessions" ADD CONSTRAINT "center_sessions_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "center_sessions" ADD CONSTRAINT "center_sessions_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "center_sessions" ADD CONSTRAINT "center_sessions_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "center_resources"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "center_sessions" ADD CONSTRAINT "center_sessions_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "appointments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

INSERT INTO "centers" ("name") VALUES ('مركز النقاء التخصصي') ON CONFLICT ("name") DO NOTHING;
