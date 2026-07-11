#!/usr/bin/env python3
"""
تطبيق تعديلات 2026-07-06 (نفس التعديلات المطبّقة على بيئة التطوير) على أي نسخة مصدر ثانية.
يفحص كل نص قديم قبل الاستبدال ويتوقف بخطأ واضح لو ما لقاه أو لقاه أكثر من مرة — ما يعدّل شي عمياني.
الاستخدام: python3 apply-2026-07-06-fixes.py /path/to/tahili-system
"""
import sys, os

if len(sys.argv) != 2:
    print("الاستخدام: python3 apply-2026-07-06-fixes.py /path/to/tahili-system")
    sys.exit(1)

BASE = sys.argv[1]
errors = []


def edit(relpath, old, new):
    path = os.path.join(BASE, relpath)
    if not os.path.isfile(path):
        errors.append(f"✘ {relpath}: الملف غير موجود")
        return
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()
    count = content.count(old)
    if count == 0:
        errors.append(f"✘ {relpath}: النص القديم غير موجود (يمكن الملف مختلف بالإنتاج) — لازم تعديل يدوي")
        return
    if count > 1:
        errors.append(f"✘ {relpath}: النص القديم تكرر {count} مرات (غير فريد) — لازم تعديل يدوي")
        return
    content = content.replace(old, new)
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"✔ {relpath}: انطبق التعديل")


def delete(relpath):
    path = os.path.join(BASE, relpath)
    if os.path.isfile(path):
        os.remove(path)
        print(f"✔ حُذف: {relpath}")
    else:
        print(f"- تخطّي (غير موجود أصلاً): {relpath}")


# 1) prisma/schema.prisma — إضافة حقل body لموديل Correspondence
edit(
    "prisma/schema.prisma",
    '  subject   String? // الموضوع\n  bookDate  DateTime? // تاريخ الكتاب',
    '  subject   String? // الموضوع\n  body      String? // نص الكتاب\n  bookDate  DateTime? // تاريخ الكتاب',
)

# 2) src/lib/role-workspaces.ts — تصحيح مفتاح بطاقة الصلاحيات + حذف بطاقة البوابة المكسورة
edit(
    "src/lib/role-workspaces.ts",
    '{ title: "الصلاحيات", description: "إدارة الأدوار والصلاحيات.", href: "/permissions", permission: "roles.manage", priority: 30 },',
    '{ title: "الصلاحيات", description: "إدارة الأدوار والصلاحيات.", href: "/permissions", permission: "users.permissions", priority: 30 },',
)
edit(
    "src/lib/role-workspaces.ts",
    '''  {
    key: "portal",
    title: "بوابة المراجع",
    description: "معلومات محدودة وآمنة للمراجع أو ذويه.",
    cards: [
      { title: "البوابة", description: "عرض معلومات المراجع المتاحة.", href: "/portal", permission: "portal.view", priority: 10 },
    ],
  },
];''',
    '];',
)

# 3) src/components/PatientTabs.tsx — 5 تعديلات
edit(
    "src/components/PatientTabs.tsx",
    '''          <SectionAdm rows={patient.admissions} editable={can("clinical.admission")} patientId={id} centers={centers} rooms={rooms} />
        )}
        {tab === "wounds" && (
          <SectionWound rows={patient.woundAssessments} editable={can("clinical.wound")} patientId={id} />''',
    '''          <SectionAdm rows={patient.admissions} editable={can("clinical.admission")} patientId={id} centers={centers} rooms={rooms} role={role} />
        )}
        {tab === "wounds" && (
          <SectionWound rows={patient.woundAssessments} editable={can("clinical.wound")} patientId={id} role={role} />''',
)
edit(
    "src/components/PatientTabs.tsx",
    'function SectionAdm({ rows, editable, patientId, centers = [], rooms = [] }: any) {',
    'function SectionAdm({ rows, editable, patientId, centers = [], rooms = [], role }: any) {',
)
edit(
    "src/components/PatientTabs.tsx",
    'function SectionWound({ rows, editable, patientId }: any) {',
    'function SectionWound({ rows, editable, patientId, role }: any) {',
)
edit(
    "src/components/PatientTabs.tsx",
    'const ROLES = ["RECEPTION", "DOCTOR", "RESIDENT", "HEAD_THERAPIST", "LAB", "RADIOLOGY", "PHARMACIST", "THERAPIST", "DRESSING", "PROSTHETICS", "ACCOUNTANT"];',
    'const ROLES = ["RECEPTION", "DATA_ENTRY", "DOCTOR", "RESIDENT", "HEAD_THERAPIST", "LAB", "RADIOLOGY", "PHARMACIST", "THERAPIST", "DRESSING", "PROSTHETICS", "ACCOUNTANT"];',
)
edit(
    "src/components/PatientTabs.tsx",
    '''              <Combobox name="direction" allowFree={false} options={[{value:"INCOMING",label:"وارد"},{value:"OUTGOING",label:"صادر"}]} />
              <input name="bookNo" className="input w-28" placeholder="رقم الكتاب" />
              <input name="subject" className="input" placeholder="الموضوع" />
              <input name="bookDate" type="date" className="input" />
            </>} />''',
    '''              <Combobox name="direction" allowFree={false} options={[{value:"INCOMING",label:"وارد"},{value:"OUTGOING",label:"صادر"}]} />
              <input name="bookNo" className="input w-28" placeholder="رقم الكتاب" />
              <input name="subject" className="input" placeholder="الموضوع" />
              <input name="body" className="input min-w-[220px]" placeholder="النص" />
              <input name="bookDate" type="date" className="input" />
            </>} />''',
)

# 4) src/lib/perms.ts — نوع adminOnly + تأشير 4 صلاحيات كأدمن فقط
edit(
    "src/lib/perms.ts",
    "export type PermItem = { key: string; label: string };",
    "export type PermItem = { key: string; label: string; adminOnly?: boolean };",
)
edit(
    "src/lib/perms.ts",
    '{ key: "settings.edit", label: "تعديل القوائم وهوية المركز" },',
    '{ key: "settings.edit", label: "تعديل القوائم وهوية المركز (أدمن فقط)", adminOnly: true },',
)
edit(
    "src/lib/perms.ts",
    '''    { key: "users.manage", label: "إضافة/تعطيل/تغيير كلمة سر" },
    { key: "users.permissions", label: "إدارة الصلاحيات" },
    { key: "audit.view", label: "سجل التدقيق" },''',
    '''    { key: "users.manage", label: "إضافة/تعطيل/تغيير كلمة سر (أدمن فقط)", adminOnly: true },
    { key: "users.permissions", label: "إدارة الصلاحيات (أدمن فقط)", adminOnly: true },
    { key: "audit.view", label: "سجل التدقيق (أدمن فقط)", adminOnly: true },''',
)

# 5) src/app/api/files/[...key]/route.ts — Buffer -> Uint8Array
edit(
    "src/app/api/files/[...key]/route.ts",
    "return new Response(buf, {",
    "return new Response(new Uint8Array(buf), {",
)

# 6) src/app/(app)/patients/actions.ts — إضافة body لدالة addCorrespondence
edit(
    "src/app/(app)/patients/actions.ts",
    '''    bookNo: fd.get("bookNo")?.toString() || null, subject: fd.get("subject")?.toString() || null,
    fromParty: fd.get("fromParty")?.toString() || null, toParty: fd.get("toParty")?.toString() || null,
    bookDate: fd.get("bookDate") ? new Date(fd.get("bookDate")!.toString()) : null,
  }});
  await logAudit({ userId: (s?.user as any)?.id, action: "CREATE", tableName: "correspondence", recordId: rec.id });''',
    '''    bookNo: fd.get("bookNo")?.toString() || null, subject: fd.get("subject")?.toString() || null,
    body: fd.get("body")?.toString() || null,
    fromParty: fd.get("fromParty")?.toString() || null, toParty: fd.get("toParty")?.toString() || null,
    bookDate: fd.get("bookDate") ? new Date(fd.get("bookDate")!.toString()) : null,
  }});
  await logAudit({ userId: (s?.user as any)?.id, action: "CREATE", tableName: "correspondence", recordId: rec.id });''',
)

# حذف الميزة المكسورة (باكب JSON export/import)
delete("src/components/BackupRestore.tsx")
delete("src/app/api/backup/export/route.ts")
delete("src/app/api/backup/import/route.ts")
try:
    d = os.path.join(BASE, "src/app/api/backup")
    if os.path.isdir(d) and not os.listdir(d):
        os.rmdir(d)
        print("✔ حُذف مجلد فاضي: src/app/api/backup")
except Exception:
    pass

print()
if errors:
    print(f"⚠ فيه {len(errors)} تعديل ما انطبق تلقائياً — لازم تسويه يدوياً:")
    for e in errors:
        print("  " + e)
    sys.exit(1)
else:
    print("✅ كل التعديلات انطبقت بنجاح.")
