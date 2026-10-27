-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('SIGNED', 'WITHDRAWN');

-- AlterTable
ALTER TABLE "CareStage" ADD COLUMN     "serviceAssignedById" TEXT,
ADD COLUMN     "serviceAssignmentId" UUID,
ADD COLUMN     "serviceAuthorityId" UUID;

-- CreateTable
CREATE TABLE "service_responsibilities" (
    "id" UUID NOT NULL,
    "serviceKey" TEXT NOT NULL,
    "branchId" INTEGER NOT NULL,
    "responsibleId" TEXT NOT NULL,
    "designatedById" TEXT NOT NULL,
    "designatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "revocationReason" TEXT,

    CONSTRAINT "service_responsibilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_consents" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "careStageId" TEXT,
    "procedure" TEXT NOT NULL,
    "documentCode" TEXT NOT NULL,
    "documentVersion" TEXT NOT NULL,
    "signerName" TEXT NOT NULL,
    "signerCapacity" TEXT NOT NULL,
    "representationBasis" TEXT,
    "signedAt" TIMESTAMP(3) NOT NULL,
    "status" "ConsentStatus" NOT NULL DEFAULT 'SIGNED',
    "recordedById" TEXT NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "withdrawnById" TEXT,
    "withdrawnAt" TIMESTAMP(3),
    "withdrawalReason" TEXT,
    "storageKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "scanStatus" "FileScanStatus" NOT NULL,

    CONSTRAINT "patient_consents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "service_responsibilities_branchId_serviceKey_idx" ON "service_responsibilities"("branchId", "serviceKey");

-- CreateIndex
CREATE UNIQUE INDEX "patient_consents_storageKey_key" ON "patient_consents"("storageKey");

-- CreateIndex
CREATE INDEX "patient_consents_patientId_recordedAt_idx" ON "patient_consents"("patientId", "recordedAt");

-- CreateIndex
CREATE UNIQUE INDEX "patient_consents_patientId_documentCode_documentVersion_key" ON "patient_consents"("patientId", "documentCode", "documentVersion");

-- AddForeignKey
ALTER TABLE "CareStage" ADD CONSTRAINT "CareStage_serviceAuthorityId_fkey" FOREIGN KEY ("serviceAuthorityId") REFERENCES "service_responsibilities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareStage" ADD CONSTRAINT "CareStage_serviceAssignedById_fkey" FOREIGN KEY ("serviceAssignedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_responsibilities" ADD CONSTRAINT "service_responsibilities_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_responsibilities" ADD CONSTRAINT "service_responsibilities_responsibleId_fkey" FOREIGN KEY ("responsibleId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_responsibilities" ADD CONSTRAINT "service_responsibilities_designatedById_fkey" FOREIGN KEY ("designatedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_responsibilities" ADD CONSTRAINT "service_responsibilities_revokedById_fkey" FOREIGN KEY ("revokedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_consents" ADD CONSTRAINT "patient_consents_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_consents" ADD CONSTRAINT "patient_consents_careStageId_fkey" FOREIGN KEY ("careStageId") REFERENCES "CareStage"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_consents" ADD CONSTRAINT "patient_consents_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_consents" ADD CONSTRAINT "patient_consents_withdrawnById_fkey" FOREIGN KEY ("withdrawnById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Additive only: no legacy values or assignments are inferred.
CREATE UNIQUE INDEX service_responsibility_current ON service_responsibilities ("branchId","serviceKey") WHERE "revokedAt" IS NULL;
ALTER TABLE service_responsibilities ADD CONSTRAINT service_catalog_key CHECK ("serviceKey" IN ('reception','doctor','therapy','pharmacy','devices','dressing','finance','laboratory','radiology','followup'));
ALTER TABLE service_responsibilities ADD CONSTRAINT service_revocation_pair CHECK (("revokedAt" IS NULL AND "revokedById" IS NULL AND "revocationReason" IS NULL) OR ("revokedAt" IS NOT NULL AND "revokedById" IS NOT NULL AND COALESCE(length(trim("revocationReason")),0) > 0));
ALTER TABLE "CareStage" ADD CONSTRAINT service_assignment_provenance CHECK (("serviceAuthorityId" IS NULL AND "serviceAssignmentId" IS NULL AND "serviceAssignedById" IS NULL) OR ("serviceAuthorityId" IS NOT NULL AND "serviceAssignmentId" IS NOT NULL AND "serviceAssignedById" IS NOT NULL AND "assignedUserId" IS NOT NULL AND "assignedAt" IS NOT NULL));
CREATE UNIQUE INDEX service_assignment_identity ON "CareStage" ("serviceAssignmentId");
ALTER TABLE patient_consents ADD CONSTRAINT consent_safe_signed_evidence CHECK ("scanStatus" = 'SAFE' AND size > 0 AND sha256 ~ '^[a-f0-9]{64}$' AND "signerCapacity" IN ('PATIENT','GUARDIAN','REPRESENTATIVE') AND ("signerCapacity" = 'PATIENT' OR COALESCE(length(trim("representationBasis")),0) > 0));
ALTER TABLE patient_consents ADD CONSTRAINT consent_withdrawal_pair CHECK ((status='SIGNED' AND "withdrawnAt" IS NULL AND "withdrawnById" IS NULL AND "withdrawalReason" IS NULL) OR (status='WITHDRAWN' AND "withdrawnAt" IS NOT NULL AND "withdrawnById" IS NOT NULL AND COALESCE(length(trim("withdrawalReason")),0) > 0));
CREATE FUNCTION protect_signed_consent_evidence() RETURNS trigger LANGUAGE plpgsql AS $consent$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Signed consent history cannot be deleted'; END IF;
  IF (to_jsonb(NEW) - ARRAY['status','withdrawnAt','withdrawnById','withdrawalReason']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','withdrawnAt','withdrawnById','withdrawalReason']) THEN
    RAISE EXCEPTION 'Signed consent evidence is immutable';
  END IF;
  IF OLD.status='WITHDRAWN' AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN RAISE EXCEPTION 'Withdrawal history is immutable'; END IF;
  RETURN NEW;
END;
$consent$;
CREATE TRIGGER protect_signed_consent BEFORE UPDATE OR DELETE ON patient_consents FOR EACH ROW EXECUTE FUNCTION protect_signed_consent_evidence();
