-- New responsibility classification for specialist review stages (additive enum value).
ALTER TYPE "ResponsibilityScope" ADD VALUE IF NOT EXISTS 'SPECIALIST_REVIEW';
