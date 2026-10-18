-- Additive: the doctor may suggest a therapist for an internal-centre referral.
ALTER TABLE "referral_requests" ADD COLUMN "suggestedTherapistId" TEXT;
