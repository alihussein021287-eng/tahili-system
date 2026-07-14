ALTER TABLE "OrgSetting"
ADD COLUMN "adminConfig" JSONB NOT NULL DEFAULT '{}'::jsonb;
