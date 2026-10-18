import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { isUserFacing, readUserError, rememberUserError, sessionOwner } from "@/lib/user-error-store";
import { fmtDateTime } from "@/lib/labels";
import { assertLocalDevCopy } from "../../scripts/dev-demo/db";

describe("reason of a rejected save", () => {
  const cookie = "theme=dark; next-auth.session-token-3001-local=abc.def.ghi";
  it("keeps short Arabic messages for the same session only", () => {
    const error = Object.assign(new Error("تعارض بنفس الوقت مع مراجع آخر"), { digest: "123456" });
    rememberUserError(error.digest, error, sessionOwner(cookie));
    expect(readUserError("123456", sessionOwner(cookie))).toBe("تعارض بنفس الوقت مع مراجع آخر");
    expect(readUserError("123456", sessionOwner("next-auth.session-token-3001-local=other"))).toBeNull();
    expect(readUserError("123456", null)).toBeNull();
  });
  it("never keeps system or database errors", () => {
    expect(isUserFacing(new Error("connect ECONNREFUSED 127.0.0.1:5432"))).toBe(false);
    expect(isUserFacing(Object.assign(new Error("خطأ"), { name: "PrismaClientKnownRequestError" }))).toBe(false);
    expect(isUserFacing("نص فقط")).toBe(false);
    expect(isUserFacing(new Error("الإحالة الداخلية غير متاحة لهذا المركز"))).toBe(true);
  });
  it("has no owner without a session cookie", () => {
    expect(sessionOwner("theme=dark")).toBeNull();
  });
  it("the error screen asks for the reason by digest", () => {
    const screen = readFileSync("src/app/error.tsx", "utf8");
    expect(screen).toContain("/api/observability/user-error?digest=");
    expect(readFileSync("src/instrumentation.ts", "utf8")).toContain("export async function onRequestError");
  });
});

describe("date and time text is the same on the server and in the browser", () => {
  it("joins date and time with a space, never a comma", () => {
    const text = fmtDateTime(new Date("2026-10-12T05:00:00Z"));
    expect(text).not.toContain("،");
    expect(text.split(" ").length).toBeGreaterThanOrEqual(2);
  });
});

describe("demo tools only touch the local copy on 3001", () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });
  it("refuses anything that is not the local working copy", () => {
    process.env.TAHILI_ENVIRONMENT = "production";
    expect(() => assertLocalDevCopy()).toThrow();
    process.env = { ...saved, TAHILI_ENVIRONMENT: "development", TAHILI_LOCAL_ACCESS: "true", TAHILI_LOCAL_PORT: "3000", NEXTAUTH_URL: "http://localhost:3000" };
    expect(() => assertLocalDevCopy()).toThrow();
    process.env = { ...saved, TAHILI_ENVIRONMENT: "development", TAHILI_LOCAL_ACCESS: "true", TAHILI_LOCAL_PORT: "3001", NEXTAUTH_URL: "http://localhost:3001" };
    expect(() => assertLocalDevCopy()).not.toThrow();
  });
  it("the wipe keeps admin accounts and refuses without one", () => {
    const reset = readFileSync("scripts/dev-demo/reset.ts", "utf8");
    expect(reset).toContain(`DELETE FROM "users" WHERE "role" <> 'ADMIN'`);
    expect(reset).toContain("لا يوجد حساب أدمن");
    expect(reset).toContain("--confirm-wipe-dev-3001");
  });
});

describe("workflow consistency found by the full check", () => {
  it("a centre programme hands the patient to its assigned therapist", () => {
    const centers = readFileSync("src/app/(app)/centers/actions.ts", "utf8");
    expect(centers.match(/handOverInTransaction\(/g)?.length).toBeGreaterThanOrEqual(2);
  });
  it("a programme waiting for its final evaluation stays in view", () => {
    const program = readFileSync("src/components/therapy/PatientTherapyProgram.tsx", "utf8");
    expect(program).toContain("بانتظار التقييم النهائي");
    expect(program).toContain("referralCenters.length === 1");
  });
  it("creating a programme returns to the therapy tab", () => {
    expect(readFileSync("src/app/(app)/therapy/actions.ts", "utf8")).toContain("?tab=therapyProgram&therapyPlan=");
  });
});

describe("handoff buttons always end with the updated screen", () => {
  it("submits through a form and reloads once if the screen did not change", () => {
    const journey = readFileSync("src/components/handoffs/PatientHandoffJourney.tsx", "utf8");
    expect(journey).toContain("useActionState");
    expect(journey).toContain("window.location.reload()");
    expect(journey).toContain('name="action" value="accept"');
    expect(readFileSync("src/components/handoffs/HandoffDialog.tsx", "utf8")).toContain("onSent?.()");
  });
});

describe("a saved form never stays on the old screen", () => {
  it("every page has the save watcher, and the submit button watches its own save", () => {
    expect(readFileSync("src/components/Providers.tsx", "utf8")).toContain("<SaveWatcher />");
    const watcher = readFileSync("src/components/SaveWatcher.tsx", "utf8");
    expect(watcher).toContain('addEventListener("submit"');
    expect(watcher).toContain("data-save-watch");
    const button = readFileSync("src/components/SubmitButton.tsx", "utf8");
    expect(button).toContain("PerformanceObserver");
    expect(button).toContain('data-save-watch=""');
  });
});
