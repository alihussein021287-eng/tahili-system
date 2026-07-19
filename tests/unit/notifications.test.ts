import { describe, expect, it } from "vitest";
import { canOpenNotification, notificationKind, permissionForLink } from "@/lib/notifications";

describe("notification helpers", () => {
  it("يصنف فلاتر الإحالات والتعاون من الروابط والعناوين", () => {
    expect(notificationKind({ link: "/patients-care?tab=referrals", title: "طلب جديد" })).toBe("referrals");
    expect(notificationKind({ link: "/referrals/abc", title: "طلب جديد" })).toBe("referrals");
    expect(notificationKind({ link: "/notifications", title: "إحالة تحتاج مراجعة" })).toBe("referrals");
    expect(notificationKind({ link: "/collaboration/files", title: "ملف جديد" })).toBe("collaboration");
    expect(notificationKind({ link: "/notifications", title: "تمت الإشارة إليك" })).toBe("collaboration");
  });

  it("يصنف روابط اللوحات الجامعة حسب التبويب", () => {
    expect(notificationKind({ link: "/staff?tab=tasks" })).toBe("tasks");
    expect(notificationKind({ link: "/patients-care?tab=appointments" })).toBe("appointments");
    expect(notificationKind({ link: "/pharmacy-inventory?tab=stock&stockState=low" })).toBe("inventory");
  });

  it("يحمي روابط اللوحات الجامعة بصلاحية التبويب المقصود", () => {
    expect(canOpenNotification("/staff?tab=tasks", new Set(["tasks.view"]))).toBe(true);
    expect(canOpenNotification("/staff?tab=tasks", new Set(["users.view"]))).toBe(false);
    expect(canOpenNotification("/patients-care?tab=referrals", new Set(["referrals.view"]))).toBe(true);
    expect(canOpenNotification("/patients-care?tab=referrals", new Set(["patients.view"]))).toBe(false);
    expect(canOpenNotification("/pharmacy-inventory?tab=stock", new Set(["inventory.view"]))).toBe(true);
  });

  it("يبقي permissionForLink متوافقاً مع النداء القديم", () => {
    expect(permissionForLink("/staff?tab=tasks")).toBe("tasks.view");
  });
});
