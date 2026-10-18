/**
 * Physical-document attestation helpers for cross-branch check-in.
 * The application never claims the document is authentic: a staff member inspects it and attests that the details
 * match; the server only compares what was typed against the registered values and refuses on any doubt.
 */
export const VERIFICATION_METHOD = "PHYSICAL_DOCUMENT_ATTESTED";
export const VERIFICATION_FIELDS = "BIRTH_DATE+MOTHER_NAME";
export const VERIFICATION_WINDOW_MS = 15 * 60 * 1000;
export const MAX_FAILED_PER_PATIENT = 3;
export const MAX_FAILED_PER_USER = 8;

/** Arabic-aware comparison form: spacing, diacritics, tatweel and common letter variants are ignored. */
export function normalizeArabicName(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKC")
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[آأإٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function isoDay(value: Date) {
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-${String(value.getUTCDate()).padStart(2, "0")}`;
}

export type StoredIdentity = { birthDate: Date | null; motherName: string | null };
export type EnteredIdentity = { birthDate: string; motherName: string };
export type VerificationOutcome = "OK" | "INSUFFICIENT_RECORD" | "MISSING_INPUT" | "MISMATCH";

export function verifyDocumentDetails(stored: StoredIdentity, entered: EnteredIdentity): VerificationOutcome {
  // The stored record must carry both comparison fields; otherwise the procedure is not defensible.
  if (!stored.birthDate || normalizeArabicName(stored.motherName).length < 3) return "INSUFFICIENT_RECORD";
  const day = /^\d{4}-\d{2}-\d{2}$/.test(entered.birthDate.trim()) ? entered.birthDate.trim() : "";
  if (!day || normalizeArabicName(entered.motherName).length < 3) return "MISSING_INPUT";
  const dateOk = isoDay(stored.birthDate) === day;
  const motherOk = normalizeArabicName(stored.motherName) === normalizeArabicName(entered.motherName);
  return dateOk && motherOk ? "OK" : "MISMATCH";
}
