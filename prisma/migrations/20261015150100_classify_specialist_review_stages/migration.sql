-- Classify only stages whose creating referral is stored and proves the relationship:
-- INTERNAL_SPECIALIST referral, linked by referral_requests."careStageId", accepted by its assigned reviewer.
-- The reviewer is recorded as assignee only when still unassigned. All other NULL stages are left untouched.
UPDATE "CareStage" AS stage
SET "responsibilityScope" = 'SPECIALIST_REVIEW',
    "assignedUserId" = COALESCE(stage."assignedUserId", referral."assignedReviewerId"),
    "assignedAt" = COALESCE(stage."assignedAt", referral."acceptedAt")
FROM "referral_requests" AS referral
WHERE referral."careStageId" = stage."id"
  AND referral."destinationScope" = 'INTERNAL_SPECIALIST'
  AND referral."assignedReviewerId" IS NOT NULL
  AND referral."acceptedById" = referral."assignedReviewerId"
  AND stage."responsibilityScope" IS NULL
  AND (stage."assignedUserId" IS NULL OR stage."assignedUserId" = referral."assignedReviewerId");
