import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { canViewPatientTab } from "@/lib/patient-tab-policy";
import { roleDefaultSet } from "@/lib/perms";

const page = readFileSync("src/app/(app)/patients/[id]/page.tsx", "utf8");
const tabs = readFileSync("src/components/PatientTabs.tsx", "utf8");
const journey = readFileSync("src/components/handoffs/PatientHandoffJourney.tsx", "utf8");
const actions = readFileSync("src/app/(app)/patients/actions.ts", "utf8");

describe("patient handoff route wiring", () => {
  it("loads handoff history after patient authorization and shows the journey for patients with handoffs", () => {
    expect(page.indexOf('await requirePerm("patients.view")')).toBeLessThan(page.indexOf("prisma.patientHandoff.findMany"));
    expect(page).toContain("<PatientHandoffJourney");
    expect(page).toContain("step={currentHandoffStep(visibleHandoffs)}");
    expect(page).toContain("path={isSecretary ? [] : path.stages} next={isSecretary ? null : path.next} showPath={!isSecretary}");
    expect(journey).toContain("لا توجد تحويلة مفتوحة");
    expect(page).toContain("acceptedBy: { select: { fullName: true } }");
    expect(page).toContain("acceptedAt: true");
  });

  it("offers and auto-opens the dialog only with handoff.send", () => {
    expect(page).toContain('canSend={perms.has("handoff.send")}');
    expect(journey).toContain("canSend ? <HandoffDialog");
    expect(page).toContain('autoOpen={query.handoff === "1"}');
  });

  it("reads only the patient history newest first and displays it inside journey", () => {
    expect(page).toContain('!isSecretary && perms.has("journey.view") ? prisma.patientHandoff.findMany');
    expect(page).toContain('where: { patientId: id }');
    expect(page).toContain('orderBy: [{ sentAt: "desc" }, { id: "desc" }]');
    expect(tabs).toContain('shows("journey") && <div');
    expect(tabs).toContain('<HandoffHistory rows={handoffHistory} />');
    expect(tabs).toContain('سجل التحويلات');
    expect(tabs).toContain('handoffStatusLabel(row.status)');
    expect(tabs).toContain('row.returnReason');
  });

  it("redirects authorized creators to the open dialog and keeps the old redirect otherwise", () => {
    const create = actions.slice(actions.indexOf("export async function createPatient"), actions.indexOf("export async function updatePatient"));
    expect(create.indexOf("prisma.patient.create")).toBeLessThan(create.indexOf('currentPerms()).has("handoff.send")'));
    expect(create).toContain('redirect(`/patients/${p.id}?handoff=1`)');
    expect(create).toContain('redirect(`/patients/${p.id}?saved=1`)');
    expect(roleDefaultSet("DATA_ENTRY").has("handoff.send")).toBe(true);
  });

  it("keeps secretary out of medical tabs", () => {
    const secretary = roleDefaultSet("SECRETARY");
    expect(canViewPatientTab("diag", secretary)).toBe(false);
    expect(canViewPatientTab("resident", secretary)).toBe(false);
    expect(canViewPatientTab("journey", secretary)).toBe(false);
    expect(page).toContain("<SecretaryHandoffHistory rows={secretaryHistory} />");
    expect(page).toContain("loadSecretaryHandoffHistory({ userId: myUserId, role: \"SECRETARY\", permissions: perms }, id)");
  });

  it("shows one path whose current stage comes from the open handoff, with no separate stage cards", () => {
    expect(page).toContain("derivePatientPath({ ...patient, handoffs: handoffHistory })");
    expect(page).not.toContain("PatientJourneySummary");
    expect(page).not.toContain("تفاصيل المسار السريري");
    expect(journey).toContain('aria-label="مراحل مسار المراجع"');
    expect(page).not.toContain('لا يملك حسابك هذا الإجراء');
  });

  it("offers the existing transition actions only when the viewer can use them", () => {
    expect(page).toContain('canAccept={canAcceptHandoff} canFinish={canFinishHandoff} canCancel={canCancelHandoff}');
    expect(page).toContain('perms.has("handoff.receive")');
    expect(page).toContain('openHandoff.acceptedById === myUserId');
    expect(page).toContain('openHandoff.fromUserId === myUserId');
    expect(journey).toContain('canAccept ? <button');
    expect(journey).toContain('canFinish ? <button');
    expect(journey).toContain('canCancel ? <button');
    expect(journey).toContain('acceptHandoffAction(handoffId)');
    expect(journey).toContain('finishHandoffAction(handoffId)');
    expect(journey).toContain('cancelHandoffAction(handoffId)');
  });
});
