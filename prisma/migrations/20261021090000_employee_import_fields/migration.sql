-- Personnel records keep the department, specialty, capacity and import provenance of the source list (all nullable, additive).
ALTER TABLE "Employee" ADD COLUMN "department" TEXT, ADD COLUMN "specialty" TEXT, ADD COLUMN "capacity" TEXT, ADD COLUMN "sourceKey" TEXT;
CREATE UNIQUE INDEX "Employee_sourceKey_key" ON "Employee"("sourceKey");
