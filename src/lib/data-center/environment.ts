import crypto from "node:crypto";

/** A template is bound to the database it was generated from, so QA reference values (e.g. synthetic centers) can never be used against another environment. */
export function environmentFingerprint(databaseName: string) {
  return crypto.createHash("sha256").update(`tahili-environment:${databaseName}`).digest("hex").slice(0, 12);
}
export const FINGERPRINT_LABEL = "بصمة البيئة";
