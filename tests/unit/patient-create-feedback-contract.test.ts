import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("new patient validation feedback", () => {
  it("keeps the new-patient form in place and shows a persistent error", () => {
    const actions = readFileSync("src/app/(app)/patients/actions.ts", "utf8");
    const form = readFileSync("src/components/PatientForm.tsx", "utf8");
    const create = actions.slice(actions.indexOf("export async function createPatient"), actions.indexOf("export async function updatePatient"));

    expect(create).toContain('return { error: v.error.issues[0]?.message || "بيانات غير صحيحة" }');
    expect(create).toContain("return { error: duplicateMessage(dup) }");
    expect(create).not.toContain('redirect(`/patients/new?saved=');
    expect(form).toContain("useActionState(action, { error: null })");
    expect(form).toContain('role="alert"');
  });
});
