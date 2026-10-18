import { describe, it, expect } from "vitest";
import { roleDefaultSet, ALL_PERMS, PERM_GROUPS } from "@/lib/perms";
import { ROLE_LABELS } from "@/lib/permissions";
import { ROLE_SIDEBAR_RULES } from "@/lib/work-registry";

describe("roleDefaultSet", () => {
  it("grants handoff keys only to the intended operating roles", () => {
    const granted = new Set(["ADMIN", "RECEPTION", "DATA_ENTRY", "SECRETARY", "DOCTOR", "RESIDENT", "HEAD_THERAPIST", "THERAPIST", "MANAGER"]);
    for (const role of Object.keys(ROLE_LABELS)) {
      for (const key of ["handoff.send", "handoff.receive"]) {
        expect(roleDefaultSet(role as keyof typeof ROLE_LABELS).has(key)).toBe(granted.has(role));
      }
    }
  });

  it("grants handoff management only to managers and admins", () => {
    expect(ALL_PERMS).toContain("handoff.manage");
    const granted = new Set(["ADMIN", "MANAGER"]);
    for (const role of Object.keys(ROLE_LABELS)) {
      expect(roleDefaultSet(role as keyof typeof ROLE_LABELS).has("handoff.manage")).toBe(granted.has(role));
    }
  });

  it("يحصر تسجيل حضور المراجع بالاستقبال والأدمن", () => {
    const granted = new Set(["ADMIN", "RECEPTION"]);
    for (const role of Object.keys(ROLE_LABELS)) {
      expect(roleDefaultSet(role as keyof typeof ROLE_LABELS).has("visits.manage")).toBe(granted.has(role));
    }
  });

  it("يحصر إدارة الطابور بالاستقبال والأدمن", () => {
    const granted = new Set(["ADMIN", "RECEPTION"]);
    for (const role of Object.keys(ROLE_LABELS)) {
      expect(roleDefaultSet(role as keyof typeof ROLE_LABELS).has("queue.manage")).toBe(granted.has(role));
    }
  });

  it("يحصر دور الاستقبال بالملف الإداري والمواعيد والحضور والطابور والتسليم", () => {
    expect([...roleDefaultSet("RECEPTION")].sort()).toEqual([
      "appointments.create", "appointments.edit", "appointments.view",
      "chat.create", "chat.send", "collaboration.view",
      "dashboard.view",
      "files.download", "files.edit", "files.share", "files.upload", "files.view",
      "handoff.receive", "handoff.send",
      "patients.edit", "patients.print", "patients.view",
      "queue.manage", "queue.view",
      "visits.manage", "visits.view",
    ].sort());
    expect(roleDefaultSet("DATA_ENTRY").has("patients.create")).toBe(true);
    expect(roleDefaultSet("RECEPTION").has("patients.create")).toBe(false);
  });

  it("يحصر مدخل البيانات بإنشاء الملف وتجهيزه والإحالة الإدارية", () => {
    expect([...roleDefaultSet("DATA_ENTRY")].sort()).toEqual([
      "appointments.create", "appointments.edit", "appointments.view",
      "chat.create", "chat.send", "collaboration.view",
      "dashboard.view",
      "files.download", "files.edit", "files.share", "files.upload", "files.view",
      "handoff.receive", "handoff.send",
      "patients.create", "patients.edit", "patients.print", "patients.view",
      "queue.view",
      "referrals.print", "referrals.recordResult", "referrals.updateStatus", "referrals.view",
      "visits.view",
    ].sort());
    const dataEntry = roleDefaultSet("DATA_ENTRY");
    for (const key of ["queue.manage", "visits.manage", "clinical.view", "patients.portal", "referrals.create", "referrals.reviewResult"]) {
      expect(dataEntry.has(key)).toBe(false);
    }
  });

  it("يحصر السكرتارية بمتابعة الملفات والمواعيد والإحالة الإدارية والتسليم", () => {
    const secretary = roleDefaultSet("SECRETARY");
    expect([...secretary].sort()).toEqual([
      "appointments.create", "appointments.edit", "appointments.view",
      "chat.create", "chat.send", "collaboration.view",
      "dashboard.view",
      "files.download", "files.edit", "files.share", "files.upload", "files.view",
      "handoff.receive", "handoff.send",
      "patients.edit", "patients.print", "patients.view",
      "queue.view",
      "referrals.print", "referrals.updateStatus", "referrals.view",
      "reports.print", // approved 2026-10: medical secretary prints reports inside her/his branch scope
      "visits.view",
    ].sort());
    for (const key of ["patients.create", "patients.portal", "queue.manage", "visits.manage", "referrals.recordResult", "clinical.view", "tasks.create", "officialdocs.manage"]) {
      expect(secretary.has(key)).toBe(false);
    }
    expect(ROLE_LABELS.SECRETARY).toBe("سكرتارية");
    expect(ROLE_SIDEBAR_RULES.SECRETARY).toEqual(ROLE_SIDEBAR_RULES.RECEPTION);
  });

  it("يعطي أدوار الاستقبال ومدخل البيانات والسكرتارية تعاوناً أساسياً دون إدارة", () => {
    for (const role of ["RECEPTION", "DATA_ENTRY", "SECRETARY"] as const) {
      const permissions = roleDefaultSet(role);
      for (const key of [
        "collaboration.view", "chat.create", "chat.send",
        "files.view", "files.upload", "files.download", "files.edit", "files.share",
      ]) {
        expect(permissions.has(key), `${role} يحتاج ${key}`).toBe(true);
      }
      for (const key of ["chat.manage.members", "chat.moderate", "files.delete", "files.restore", "files.audit", "files.admin"]) {
        expect(permissions.has(key), `${role} لا يحتاج ${key}`).toBe(false);
      }
    }
  });
  it("الأدمن يملك كل الصلاحيات دائماً", () => {
    const set = roleDefaultSet("ADMIN" as any);
    expect(set.size).toBe(ALL_PERMS.length);
  });

  it("كل الأدوار المعرّفة برجّع Set صحيح بدون كراش", () => {
    const roles = ["MANAGER", "DOCTOR", "THERAPIST", "ACCOUNTANT", "VIEWER", "PHARMACIST", "RECEPTION"];
    for (const r of roles) {
      const set = roleDefaultSet(r as any);
      expect(set).toBeInstanceOf(Set);
    }
  });

  it("لا يوجد مفتاح صلاحية مكرر بكل الكتالوج", () => {
    const keys = ALL_PERMS;
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("كل مفتاح صلاحية فريد ضمن قسمه (تنبيه مبكر لغلطة نسخ-لصق)", () => {
    for (const group of PERM_GROUPS) {
      const keys = group.items.map((i) => i.key);
      expect(new Set(keys).size).toBe(keys.length);
    }
  });

  it("يفصل الصلاحيات الطبية والإدارية للإحالات", () => {
    const resident = roleDefaultSet("RESIDENT" as any);
    const doctor = roleDefaultSet("DOCTOR" as any);
    const manager = roleDefaultSet("MANAGER" as any);
    const dataEntry = roleDefaultSet("DATA_ENTRY" as any);
    expect(resident.has("referrals.create")).toBe(true);
    expect(resident.has("referrals.print")).toBe(false);
    expect(doctor.has("referrals.reviewResult")).toBe(true);
    expect(manager.has("referrals.print")).toBe(true);
    expect(manager.has("referrals.create")).toBe(false);
    expect(manager.has("referrals.reviewResult")).toBe(false);
    expect(dataEntry.has("referrals.recordResult")).toBe(true);
    expect(dataEntry.has("referrals.reviewResult")).toBe(false);
  });

  it("يعطي الطبيب والمقيم نطاقهما الفعلي بدون تكرار أعمال التسجيل", () => {
    const resident = roleDefaultSet("RESIDENT" as any);
    const doctor = roleDefaultSet("DOCTOR" as any);

    for (const key of ["clinical.diagnosis", "referrals.create", "referrals.recordResult", "clinical.session"]) {
      expect(resident.has(key), `المقيم يحتاج ${key}`).toBe(true);
    }
    for (const key of ["clinical.prescription", "clinical.admission", "referrals.reviewResult", "referrals.accept"]) {
      expect(resident.has(key), `المقيم لا يحتاج ${key}`).toBe(false);
    }

    for (const key of ["clinical.diagnosis", "clinical.prescription", "clinical.admission", "referrals.reviewResult", "referrals.accept", "beds.assign"]) {
      expect(doctor.has(key), `الطبيب يحتاج ${key}`).toBe(true);
    }
    for (const key of ["patients.create", "patients.import", "patients.archive", "appointments.create", "appointments.edit", "queue.manage", "visits.manage", "referrals.recordResult", "inventory.manage"]) {
      expect(doctor.has(key), `الطبيب لا ينفذ ${key}`).toBe(false);
    }

    for (const role of [resident, doctor]) {
      expect(role.has("handoff.send")).toBe(true);
      expect(role.has("handoff.receive")).toBe(true);
    }
  });

  it("يبقي السجل السريري وإجراءات المقيم خارج دور الاستقبال", () => {
    const reception = roleDefaultSet("RECEPTION" as any);
    const resident = roleDefaultSet("RESIDENT" as any);
    const viewer = roleDefaultSet("VIEWER" as any);
    expect(reception.has("clinical.view")).toBe(false);
    expect(reception.has("clinical.metrics")).toBe(false);
    expect(resident.has("clinical.metrics")).toBe(true);
    expect(viewer.has("clinical.metrics")).toBe(false);
  });

  it("يفصل باقي المحطات عن الأعمال الطبية والإدارية غير التابعة لها", () => {
    const therapist = roleDefaultSet("THERAPIST" as any);
    const headTherapist = roleDefaultSet("HEAD_THERAPIST" as any);
    const lab = roleDefaultSet("LAB" as any);
    const radiology = roleDefaultSet("RADIOLOGY" as any);
    const dressing = roleDefaultSet("DRESSING" as any);
    const prosthetics = roleDefaultSet("PROSTHETICS" as any);
    const pharmacist = roleDefaultSet("PHARMACIST" as any);
    const accountant = roleDefaultSet("ACCOUNTANT" as any);
    const viewer = roleDefaultSet("VIEWER" as any);

    expect(therapist.has("therapy.session.record")).toBe(true);
    expect(therapist.has("therapy.plan.manage")).toBe(false);
    for (const key of ["appointments.create", "appointments.edit", "meds.manage", "patients.portal", "queue.manage", "visits.manage"]) {
      expect(therapist.has(key), `المعالج لا ينفذ ${key}`).toBe(false);
    }

    expect(headTherapist.has("therapy.plan.manage")).toBe(true);
    expect(headTherapist.has("centers.programs.manage")).toBe(true);
    for (const key of ["therapy.session.record", "appointments.create", "appointments.edit", "queue.manage", "visits.manage"]) {
      expect(headTherapist.has(key), `رئيس المعالجين لا ينفذ ${key}`).toBe(false);
    }

    for (const station of [lab, radiology]) {
      expect(station.has("clinical.report")).toBe(true);
      for (const key of ["referrals.recordResult", "referrals.create", "clinical.diagnosis", "clinical.prescription"]) {
        expect(station.has(key), `المحطة لا تنفذ ${key}`).toBe(false);
      }
    }
    expect(dressing.has("clinical.wound")).toBe(true);
    expect(dressing.has("clinical.care")).toBe(true);
    expect(dressing.has("clinical.diagnosis")).toBe(false);
    expect(prosthetics.has("devices.create")).toBe(true);
    expect(prosthetics.has("devices.maintain")).toBe(true);
    expect(prosthetics.has("clinical.care")).toBe(false);

    expect(pharmacist.has("inventory.manage")).toBe(true);
    expect(pharmacist.has("pharmacy.dispense")).toBe(true);
    for (const key of ["clinical.prescription", "finance.payment", "expenses.approve", "approvals.approve"]) {
      expect(pharmacist.has(key), `الصيدلي لا ينفذ ${key}`).toBe(false);
    }
    expect(accountant.has("finance.payment")).toBe(true);
    expect(accountant.has("expenses.pay")).toBe(true);
    for (const key of ["pharmacy.dispense", "inventory.manage", "clinical.prescription", "expenses.approve"]) {
      expect(accountant.has(key), `المحاسب لا ينفذ ${key}`).toBe(false);
    }
    expect(viewer.has("tasks.create")).toBe(true);
    expect(viewer.has("patients.edit")).toBe(false);
  });
});
