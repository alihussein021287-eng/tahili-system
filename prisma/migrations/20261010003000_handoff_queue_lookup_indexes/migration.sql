CREATE INDEX "patient_handoffs_acceptedById_status_idx" ON "patient_handoffs"("acceptedById", "status");
CREATE INDEX "QueueEntry_patientId_centerId_createdAt_idx" ON "QueueEntry"("patientId", "centerId", "createdAt");
