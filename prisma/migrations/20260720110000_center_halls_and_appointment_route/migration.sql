ALTER TABLE "appointments"
  ADD COLUMN "centerId" INTEGER,
  ADD COLUMN "hallId" INTEGER;

ALTER TABLE "appointments"
  ADD CONSTRAINT "appointments_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "centers"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "appointments_hallId_fkey" FOREIGN KEY ("hallId") REFERENCES "therapy_halls"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "appointments_centerId_scheduledAt_idx" ON "appointments"("centerId", "scheduledAt");
CREATE INDEX "appointments_hallId_scheduledAt_idx" ON "appointments"("hallId", "scheduledAt");

INSERT INTO "centers" ("name") VALUES
  ('مركز العلاج الطبيعي'),
  ('مركز التأهيل النفسي'),
  ('مركز النقاء التخصصي'),
  ('مركز العلاج الوظيفي')
ON CONFLICT ("name") DO NOTHING;

WITH candidate AS (
  SELECT "id" FROM "therapy_halls"
  WHERE "name" IN ('قاعة التمارين الميكانيكية', 'قاعة التمارين الميكانيكي')
  ORDER BY "id"
  LIMIT 1
)
UPDATE "therapy_halls"
SET "name" = 'قاعة العلاج الميكانيكي', "active" = true
WHERE "id" IN (SELECT "id" FROM candidate)
  AND NOT EXISTS (SELECT 1 FROM "therapy_halls" WHERE "name" = 'قاعة العلاج الميكانيكي');

WITH candidate AS (
  SELECT "id" FROM "therapy_halls"
  WHERE "name" IN ('قاعة الأجهزة الفيزياوية', 'القاعة الفيزياوية', 'قاعة العلاج الفيزياوي', 'قاعة العلاج الفيزياوية')
  ORDER BY "id"
  LIMIT 1
)
UPDATE "therapy_halls"
SET "name" = 'قاعة العلاج الفيزيائي', "active" = true
WHERE "id" IN (SELECT "id" FROM candidate)
  AND NOT EXISTS (SELECT 1 FROM "therapy_halls" WHERE "name" = 'قاعة العلاج الفيزيائي');

WITH candidate AS (
  SELECT "id" FROM "therapy_halls"
  WHERE "name" IN ('قاعة الهايبر', 'الهايبر', 'هايبر أوكسجين')
  ORDER BY "id"
  LIMIT 1
)
UPDATE "therapy_halls"
SET "name" = 'الهايبر أوكسجين', "active" = true
WHERE "id" IN (SELECT "id" FROM candidate)
  AND NOT EXISTS (SELECT 1 FROM "therapy_halls" WHERE "name" = 'الهايبر أوكسجين');

WITH candidate AS (
  SELECT "id" FROM "therapy_halls"
  WHERE "name" IN ('الاستشارية')
  ORDER BY "id"
  LIMIT 1
)
UPDATE "therapy_halls"
SET "name" = 'استشارية', "active" = true
WHERE "id" IN (SELECT "id" FROM candidate)
  AND NOT EXISTS (SELECT 1 FROM "therapy_halls" WHERE "name" = 'استشارية');

WITH candidate AS (
  SELECT "id" FROM "therapy_halls"
  WHERE "name" IN ('الأجهزة')
  ORDER BY "id"
  LIMIT 1
)
UPDATE "therapy_halls"
SET "name" = 'أجهزة', "active" = true
WHERE "id" IN (SELECT "id" FROM candidate)
  AND NOT EXISTS (SELECT 1 FROM "therapy_halls" WHERE "name" = 'أجهزة');

WITH candidate AS (
  SELECT "id" FROM "therapy_halls"
  WHERE "name" IN ('القروح والجروح', 'التقرحات', 'جروح')
  ORDER BY "id"
  LIMIT 1
)
UPDATE "therapy_halls"
SET "name" = 'القروح', "active" = true
WHERE "id" IN (SELECT "id" FROM candidate)
  AND NOT EXISTS (SELECT 1 FROM "therapy_halls" WHERE "name" = 'القروح');

WITH candidate AS (
  SELECT "id" FROM "therapy_halls"
  WHERE "name" IN ('طب الألم')
  ORDER BY "id"
  LIMIT 1
)
UPDATE "therapy_halls"
SET "name" = 'الألم', "active" = true
WHERE "id" IN (SELECT "id" FROM candidate)
  AND NOT EXISTS (SELECT 1 FROM "therapy_halls" WHERE "name" = 'الألم');

INSERT INTO "therapy_halls" ("name", "active") VALUES
  ('قاعة العلاج الميكانيكي', true),
  ('قاعة العلاج الفيزيائي', true),
  ('قاعة العلاج المائي', true),
  ('استشارية', true),
  ('أجهزة', true),
  ('تأهيل كبار', true),
  ('تأهيل أطفال', true),
  ('القروح', true),
  ('الألم', true),
  ('الهايبر أوكسجين', true),
  ('التأهيل', true),
  ('الفنون', true)
ON CONFLICT ("name") DO UPDATE SET "active" = true;

WITH desired("centerName", "hallName") AS (
  VALUES
    ('مركز العلاج الطبيعي', 'قاعة العلاج الميكانيكي'),
    ('مركز العلاج الطبيعي', 'قاعة العلاج الفيزيائي'),
    ('مركز العلاج الطبيعي', 'قاعة العلاج المائي'),
    ('مركز التأهيل النفسي', 'استشارية'),
    ('مركز التأهيل النفسي', 'أجهزة'),
    ('مركز التأهيل النفسي', 'تأهيل كبار'),
    ('مركز التأهيل النفسي', 'تأهيل أطفال'),
    ('مركز النقاء التخصصي', 'القروح'),
    ('مركز النقاء التخصصي', 'الألم'),
    ('مركز النقاء التخصصي', 'الهايبر أوكسجين'),
    ('مركز العلاج الوظيفي', 'التأهيل'),
    ('مركز العلاج الوظيفي', 'الفنون')
)
INSERT INTO "center_resources" (
  "id", "centerId", "type", "name", "capacity", "status", "therapyHallId", "createdAt", "updatedAt"
)
SELECT
  'center_hall_' || substr(md5(desired."centerName" || ':' || desired."hallName"), 1, 24),
  "centers"."id",
  'HALL'::"CenterResourceType",
  desired."hallName",
  1,
  'AVAILABLE'::"CenterResourceStatus",
  "therapy_halls"."id",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM desired
JOIN "centers" ON "centers"."name" = desired."centerName"
JOIN "therapy_halls" ON "therapy_halls"."name" = desired."hallName"
ON CONFLICT ("centerId", "name") DO UPDATE
SET
  "type" = 'HALL'::"CenterResourceType",
  "therapyHallId" = EXCLUDED."therapyHallId",
  "updatedAt" = CURRENT_TIMESTAMP;
