// Data Management Center: the single contract for every import domain. Templates, preview validation and APPLY all read THIS file,
// and its enumerations come from the application's own definitions (labels.ts, permissions.ts, validate.ts), so they cannot drift.
// There is no generic table importer: every importable column is an explicit, reviewed field of an existing application workflow.
import { CASE_TYPE, GENDER, KINSHIP, MARITAL, PATIENT_STATUS } from "@/lib/labels";
import { CENTER_MEMBERSHIP_ROLE_LABELS } from "@/lib/center-membership";
import { ROLE_LABELS } from "@/lib/permissions";
import { ROLES } from "@/lib/validate";

export const OFFICIAL_BRANCH_NAME = "مجمع الرسول الاعظم التاهيلي"; // resolved by exact normalized name at runtime, never by a fixed id
export const TEMPLATE_VERSION = "2.0";
export const STAFF_TEMPLATE_VERSION = "1.1";

export type FieldType = "text" | "int" | "percent" | "year" | "phone" | "enum" | "yesno" | "date" | "username" | "email" | "ref";
/** Reference lists come from the live database (reference.ts); suggestions are optional lists the form also offers but does not enforce. */
export type RefName = "governorates" | "injuryTypes" | "centers" | "ranks" | "formations" | "mobilityAids" | "prostheticTypes";

export type FieldDef = {
  id: string;            // stable machine identifier (template header, first row)
  label: string;         // Arabic label (template second row)
  required: boolean;
  type: FieldType;
  enumMap?: Record<string, string>; // Arabic label (and accepted alias) -> stored value
  choices?: string[];    // the ONLY values offered in the template list (input may still accept documented legacy aliases through enumMap)
  ref?: RefName;         // strict reference lookup (value must exist in the live list)
  suggest?: RefName | string[]; // non-enforced suggestions (the form's combobox allows free text)
  example: string;       // fictional example (help sheet only, never mixed with import rows)
  help: string;          // Arabic explanation
  aliases?: string[];    // accepted legacy headers (documented adapter, never in the canonical template)
};

export type ImportDomainId = "patients" | "staff" | "employees" | "residents" | "specialists" | "accounts" | "memberships";

/** A sheet of a multi-sheet (unified) template. All sheets of one file are planned, previewed and applied together. */
export type TemplateSheet = { id: "personnel" | "accounts" | "memberships"; name: string; title: string; fields: FieldDef[] };

export type ImportDomain = {
  id: ImportDomainId;
  title: string;
  permission: string;            // distinct import permission
  sheetNames: string[];          // preferred sheet names (first match wins; a single-sheet file is accepted)
  authority: string;             // where the authoritative contract lives
  fields: FieldDef[];
  sheets?: TemplateSheet[];       // unified multi-sheet domains: fields live on the sheets
  requires?: string[];            // additional import permissions needed on top of `permission` (the unified file creates users and memberships too)
  advanced?: boolean;             // legacy single-domain importers, kept under "advanced options"
  notImported: { name: string; reason: string }[]; // fields of the same workflow that are intentionally NOT importable
  identityPolicy: string;
  writes: string;
  updatesExisting: false;        // bulk updates of existing records are NOT approved: matches are reported, never overwritten
};

const text = (id: string, label: string, required: boolean, example: string, help: string, aliases: string[] = [], suggest?: FieldDef["suggest"]): FieldDef => ({ id, label, required, type: "text", example, help, aliases, suggest });
const labelMap = (obj: Record<string, string>, extra: Record<string, string> = {}) => ({ ...Object.fromEntries(Object.entries(obj).map(([k, v]) => [v, k])), ...extra });
const YESNO = { "نعم": "1", "لا": "0" };

// ---- enumerations taken from the application (labels.ts / permissions.ts / center-membership.ts) ----
export const PRIVILEGED_ROLES = ["ADMIN", "MANAGER"] as const;
export const ACCOUNT_ROLE_MAP: Record<string, string> = Object.fromEntries(
  ROLES.filter((r) => !(PRIVILEGED_ROLES as readonly string[]).includes(r)).flatMap((r) => [[ROLE_LABELS[r], r], [r, r]]),
);
export const ACCOUNT_ROLE_LABELS: string[] = ROLES.filter((r) => !(PRIVILEGED_ROLES as readonly string[]).includes(r)).map((r) => ROLE_LABELS[r]);
export const STAFF_CATEGORY_MAP: Record<string, string> = {
  "طبيب مقيم (تدرج)": "RESIDENT", "اطباء التدرج": "RESIDENT", "أطباء التدرج": "RESIDENT", RESIDENT: "RESIDENT",
  "طبيب اختصاص": "SPECIALIST", "الاطباء الاختصاص": "SPECIALIST", "الأطباء الاختصاص": "SPECIALIST", SPECIALIST: "SPECIALIST",
  "موظف": "EMPLOYEE", "موظفين المراكز": "EMPLOYEE", EMPLOYEE: "EMPLOYEE",
};
export const STAFF_CATEGORY_CHOICES = ["طبيب مقيم (تدرج)", "طبيب اختصاص", "موظف"]; // the three canonical categories (legacy labels stay accepted as input only)
export const KINSHIP_VALUES = Object.values(KINSHIP) as string[];
export const MEMBERSHIP_ROLE_LABELS = CENTER_MEMBERSHIP_ROLE_LABELS;

export const IMPORT_DOMAINS: ImportDomain[] = [
  {
    id: "staff", title: "الكادر الطبي والإداري (ملف موحّد)", permission: "datacenter.import.personnel", requires: ["datacenter.import.accounts", "datacenter.import.memberships"],
    sheetNames: ["الأشخاص"],
    authority: "سجل الموظف `Employee` وإنشاء المستخدم `createUser` وعضوية المركز؛ الفئات بقرار المالك (اطباء التدرج=RESIDENT، الاطباء الاختصاص=DOCTOR)",
    identityPolicy: "رمز الشخص ثابت في كل الأوراق؛ لا يُنشأ سجل موظف مكرر؛ يُطابَق سجل قائم فقط عند تطابق الاسم والفئة والوظيفة/الاختصاص والقسم في الفرع نفسه؛ الاسم المكرر بتفاصيل مختلفة يُحجز؛ لا يُحدَّث أي سجل قائم",
    writes: "سجلات موظفين + حسابات غير مفعّلة مرتبطة بها (واحد لواحد) + عضويات مراكز صريحة؛ كل ذلك في عملية واحدة متكاملة ولا شيء يُفعَّل",
    updatesExisting: false, fields: [],
    sheets: [
      {
        id: "personnel", name: "الأشخاص", title: "الأشخاص (سجلات الموظفين)",
        fields: [
          { id: "personKey", label: "رمز الشخص", required: true, type: "text", example: "P001", help: "معرّف ثابت تستخدمه ورقتا الحسابات والعضويات؛ لا يتكرر لشخصين" },
          text("fullName", "الاسم الكامل", true, "طبيب مقيم تجريبي", "الاسم الرباعي (3 أحرف على الأقل)"),
          { id: "category", label: "الفئة", required: true, type: "enum", enumMap: STAFF_CATEGORY_MAP, choices: STAFF_CATEGORY_CHOICES, example: "طبيب مقيم (تدرج)", help: "اختر من القائمة: طبيب مقيم (تدرج) = RESIDENT، طبيب اختصاص = SPECIALIST، موظف = EMPLOYEE" },
          text("job", "الوظيفة / العنوان الوظيفي", false, "طبيب تدرج", "مطلوب للطبيب المقيم؛ للموظف كما هي دون استنتاج دور منها"),
          text("specialty", "الاختصاص", false, "", "مطلوب لطبيب الاختصاص"),
          text("department", "القسم", false, "", "اختياري"),
          text("capacity", "الصفة", false, "", "اختياري"),
          { id: "phone", label: "رقم الهاتف", required: false, type: "phone", example: "07700000000", help: "10 أو 11 رقماً (اختياري)" },
        ],
      },
      {
        id: "accounts", name: "الحسابات", title: "الحسابات المطلوبة (غير مفعّلة)",
        fields: [
          { id: "personKey", label: "رمز الشخص", required: true, type: "text", example: "P001", help: "يجب أن يوجد في ورقة الأشخاص" },
          { id: "username", label: "اسم المستخدم", required: true, type: "username", example: "test.user1", help: "حروف وأرقام إنجليزية فقط (. _ - مسموحة)، 3 أحرف على الأقل" },
          { id: "role", label: "الدور المطلوب", required: false, type: "enum", enumMap: ACCOUNT_ROLE_MAP, example: "", help: "الطبيب المقيم = طبيب مقيم، طبيب الاختصاص = طبيب (يُشتق إن ترك فارغاً)؛ الموظف: إلزامي مع التحقق؛ مدير النظام والمدير الإداري يحتاجان اعتماداً منفصلاً" },
          { id: "roleVerified", label: "تم التحقق من الدور", required: false, type: "yesno", enumMap: YESNO, example: "", help: "إلزامي لحسابات الموظفين: نعم = تحقق المسؤول من الدور حسب الوظيفة والقسم الفعليين" },
          { id: "email", label: "البريد", required: false, type: "email", example: "name@example.test", help: "اختياري" },
        ],
      },
      {
        id: "memberships", name: "العضويات", title: "عضويات المراكز المطلوبة",
        fields: [
          { id: "personKey", label: "رمز الشخص", required: true, type: "text", example: "P001", help: "شخص له حساب في ورقة الحسابات أو حساب قائم مرتبط به" },
          { id: "centerName", label: "اسم المركز", required: true, type: "ref", ref: "centers", example: "", help: "اختر من القائمة (المراكز الفعّالة)" },
          text("specialty", "الاختصاص", false, "", "اختياري"),
          { id: "startDate", label: "تاريخ البدء", required: false, type: "date", example: "2026-01-01", help: "اختياري (YYYY-MM-DD)؛ الافتراضي اليوم" },
        ],
      },
    ],
    notImported: [
      { name: "كلمة السر", reason: "لا تُستورد ولا تُصدَّر؛ الحسابات تُنشأ غير مفعّلة والتفعيل خطوة منفصلة آمنة" },
      { name: "الصلاحيات الفردية", reason: "تُدار من صفحة الحساب فقط" },
      { name: "الفرع", reason: "يُحدَّد صراحةً في معالج الاستيراد لا في الملف" },
      { name: "دور من المسمى الوظيفي", reason: "لا يُستنتج؛ الموظف يحتاج دوراً صريحاً مع تحقق" },
      { name: "ADMIN / MANAGER", reason: "يحتاجان اعتماداً منفصلاً ولا يُنشآن بالاستيراد" },
    ],
  },
  {
    id: "patients", title: "المراجعون", permission: "datacenter.import.patients", sheetNames: ["البيانات", "data", "المراجعون", "patients"],
    authority: "نموذج تسجيل مراجع جديد (createPatient / patientSchema) في `patients/actions.ts`",
    identityPolicy: "الهوية = الاسم + الهاتف + سنة التولد معاً (كما يفعل النظام عند التسجيل)؛ تكرار الهاتف لا يدمج أحداً؛ لا يُختلق تاريخ ميلاد",
    writes: "ملف مراجع نشط في الفرع المحدد برقم ملف جديد متسلسل، مع رقم الملف السابق كمرجع ومفتاح مصدر ثابت",
    updatesExisting: false,
    fields: [
      text("fullName", "الاسم الرباعي", true, "اسم تجريبي أول ثاني ثالث", "3 أحرف على الأقل", ["الاسم", "الاسم الكامل", "اسم المراجع", "اسم المريض"]),
      { id: "gender", label: "الجنس", required: true, type: "enum", enumMap: labelMap(GENDER, { male: "MALE", female: "FEMALE", "انثى": "FEMALE" }), example: "ذكر", help: "اختر من القائمة", aliases: ["الجنس"] },
      { id: "birthYear", label: "سنة التولد", required: true, type: "year", example: "1985", help: "سنة من 4 أرقام (1900 حتى السنة الحالية)", aliases: ["التولد", "سنة التولد"] },
      { id: "phone", label: "رقم الهاتف", required: true, type: "phone", example: "07700000000", help: "10 أو 11 رقماً (الأرقام فقط)", aliases: ["الهاتف", "رقم الهاتف"] },
      { id: "governorate", label: "المحافظة", required: true, type: "ref", ref: "governorates", example: "بغداد", help: "اختر من القائمة (محافظات النظام)", aliases: ["المحافظة"] },
      { id: "injuryType", label: "نوع الإصابة", required: true, type: "ref", ref: "injuryTypes", example: "كسر", help: "اختر من القائمة (أنواع الإصابة في النظام)", aliases: ["نوع الإصابة"] },
      { id: "caseType", label: "نوع الحالة", required: true, type: "enum", enumMap: labelMap(CASE_TYPE), example: "جريح", help: "اختر من القائمة" },
      { id: "birthDate", label: "تاريخ التولد", required: false, type: "date", example: "1985-03-15", help: "اختياري (YYYY-MM-DD)؛ إن وُجد فسنته يجب أن تطابق سنة التولد" },
      text("motherName", "اسم الأم", false, "اسم أم تجريبي", "اختياري"),
      { id: "maritalStatus", label: "الحالة الزوجية", required: false, type: "enum", enumMap: labelMap(MARITAL), example: "متزوج", help: "اختر من القائمة" },
      { id: "childrenCount", label: "عدد الأطفال", required: false, type: "int", example: "2", help: "رقم صحيح" },
      { id: "wivesCount", label: "عدد الزوجات", required: false, type: "int", example: "1", help: "رقم صحيح" },
      text("kinshipDegree", "درجة القرابة", false, "نفسه", "قيمة مقترحة من النموذج، ويقبل النموذج كتابة غيرها", [], KINSHIP_VALUES),
      text("housing", "السكن", false, "ملك", "قيمة مقترحة (ملك / إيجار)، ويقبل النموذج كتابة غيرها", ["السكن"], ["ملك", "إيجار"]),
      text("education", "التحصيل الدراسي", false, "إعدادية", "اختياري"),
      text("rank", "الصفة", false, "", "من قائمة الصفات في النظام (مقترحة)", [], "ranks"),
      text("formationText", "التشكيل", false, "", "من قائمة التشكيلات في النظام (مقترحة)", [], "formations"),
      text("militaryStatus", "موقف الدائرة", false, "عسكري", "قيمة مقترحة (عسكري / مدني)", [], ["عسكري", "مدني"]),
      { id: "inMobilization", label: "ضمن الحشد", required: false, type: "yesno", enumMap: YESNO, example: "نعم", help: "نعم أو لا" },
      { id: "receivesSalary", label: "يستلم راتب", required: false, type: "yesno", enumMap: YESNO, example: "لا", help: "نعم أو لا" },
      { id: "disabilityPct", label: "نسبة العجز %", required: false, type: "percent", example: "40", help: "رقم من 0 إلى 100" },
      text("injuryCause", "سبب الإصابة", false, "", "اختياري"),
      { id: "injuryDate", label: "تاريخ الإصابة", required: false, type: "date", example: "2024-06-01", help: "اختياري (YYYY-MM-DD)" },
      text("mobility", "الحركة", false, "", "اختياري"),
      text("mobilityAid", "مساعد الحركة", false, "", "من قائمة مساعدات الحركة في النظام (مقترحة)", [], "mobilityAids"),
      text("prosthetic", "طرف صناعي", false, "", "من قائمة الأطراف الصناعية في النظام (مقترحة)", [], "prostheticTypes"),
      text("referredToCenter", "المركز المُحال له", false, "", "من مراكز النظام (مقترحة)", [], "centers"),
      { id: "status", label: "الحالة", required: false, type: "enum", enumMap: labelMap(PATIENT_STATUS), example: "نشط", help: "اختر من القائمة؛ تُترك فارغة = نشط", aliases: ["الحالة"] },
      text("notes", "ملاحظات", false, "", "اختياري"),
      text("legacyFileNumber", "رقم الملف السابق", false, "1001", "مرجع من النظام القديم فقط؛ رقم الملف الجديد يُولَّد تلقائياً", ["رقم الملف", "file number"]),
    ],
    notImported: [
      { name: "رقم الملف", reason: "يُولَّد تلقائياً ولا يُستورد" },
      { name: "الفرع", reason: "يُحدَّد صراحةً في معالج الاستيراد لا في الملف" },
      { name: "مدخل البيانات", reason: "يُسجَّل تلقائياً بهوية عملية الاستيراد" },
      { name: "الصورة", reason: "ملفات الصور لا تُستورد" },
      { name: "المديرية / التشكيل المرجعي", reason: "تُختار من قوائم النظام يدوياً؛ التشكيل النصي مدعوم" },
      { name: "حقول الإحالة والمتابعة والتشخيص والجلسات", reason: "سجلات سريرية/تشغيلية خارج نطاق الاستيراد" },
    ],
  },
  {
    id: "employees", title: "الموظفون", permission: "datacenter.import.personnel", sheetNames: ["البيانات", "data", "ورقة1", "employees"],
    authority: "سجل الموظف `Employee` (صفحة سجلات الموظفين)",
    identityPolicy: "الاسم + الوظيفة + القسم؛ الاسم المتكرر بتفاصيل مختلفة يُحجز لقرار المالك؛ لا إنشاء حساب ولا استنتاج دور",
    writes: "سجل موظف (فئة EMPLOYEE) في الفرع المحدد بلا تسجيل دخول", updatesExisting: false,
    fields: [
      text("fullName", "الاسم الكامل", true, "موظف تجريبي", "الاسم الرباعي (3 أحرف على الأقل)", ["الاسم", "الاسم الرباعي واللقب", "اسم الموظف", "الاسم الرباعي"]),
      text("job", "الوظيفة", false, "إداري", "المسمى الوظيفي كما هو (لا يُستنتج منه دور)", ["الوظيفة", "الوظيفة الأساسية"]),
      text("department", "القسم", false, "الاستعلامات", "القسم كنص", ["القسم", "المركز"]),
      text("capacity", "الصفة", false, "تعيين", "اختياري", ["الصفة"]),
      { id: "phone", label: "رقم الهاتف", required: false, type: "phone", example: "07700000000", help: "10 أو 11 رقماً (اختياري)" },
    ],
    notImported: [{ name: "الدور / الصلاحيات", reason: "لا يُستنتجان من المسمى؛ تُحدَّد عند ربط/تجهيز حساب" }, { name: "الفرع", reason: "يُحدَّد في معالج الاستيراد" }, { name: "الحضور والدوام", reason: "سجلات تشغيلية" }],
  },
  {
    id: "residents", title: "الأطباء المقيمون (التدرج)", permission: "datacenter.import.personnel", sheetNames: ["البيانات", "data", "ورقة1", "residents"],
    authority: "سجل الموظف `Employee` بفئة RESIDENT (اطباء التدرج = RESIDENT)",
    identityPolicy: "الاسم + العنوان الوظيفي", writes: "سجل طبيب مقيم (فئة RESIDENT) بلا تسجيل دخول", updatesExisting: false,
    fields: [
      text("fullName", "اسم الطبيب", true, "طبيب مقيم تجريبي", "الاسم الكامل (3 أحرف على الأقل)", ["اسم الطبيب", "الاسم", "الاسم الرباعي"]),
      text("job", "العنوان الوظيفي", true, "طبيب تدرج", "مثل: طبيب مقيم أقدم / طبيب تدرج", ["العنوان الوظيفي", "الوظيفة"]),
      text("department", "القسم", false, "", "اختياري", ["القسم"]),
      { id: "phone", label: "رقم الهاتف", required: false, type: "phone", example: "07700000000", help: "10 أو 11 رقماً (اختياري)" },
    ],
    notImported: [{ name: "حساب الدخول والدور", reason: "يُجهَّز لاحقاً من ملف الموظف (الدور RESIDENT بقرار المالك)" }, { name: "عضوية المركز", reason: "تُضاف صراحةً بعد التحقق" }],
  },
  {
    id: "specialists", title: "أطباء الاختصاص", permission: "datacenter.import.personnel", sheetNames: ["البيانات", "data", "ورقة1", "specialists"],
    authority: "سجل الموظف `Employee` بفئة SPECIALIST (الاطباء الاختصاص = DOCTOR)",
    identityPolicy: "الاسم + الاختصاص", writes: "سجل طبيب اختصاص (فئة SPECIALIST) بلا تسجيل دخول", updatesExisting: false,
    fields: [
      text("fullName", "اسم الطبيب", true, "طبيب اختصاص تجريبي", "الاسم الكامل (3 أحرف على الأقل)", ["اسم الطبيب", "الاسم", "الاسم الرباعي"]),
      text("specialty", "الاختصاص", true, "جراحة عظام", "الاختصاص كما هو", ["الاختصاص", "التخصص"]),
      text("department", "القسم", false, "", "اختياري", ["القسم"]),
      { id: "phone", label: "رقم الهاتف", required: false, type: "phone", example: "07700000000", help: "10 أو 11 رقماً (اختياري)" },
    ],
    notImported: [{ name: "حساب الدخول والدور", reason: "يُجهَّز لاحقاً من ملف الموظف (الدور DOCTOR بقرار المالك)" }, { name: "عضوية المركز", reason: "تُضاف صراحةً بعد التحقق" }],
  },
  {
    id: "accounts", title: "هويات الحسابات", permission: "datacenter.import.accounts", sheetNames: ["البيانات", "data", "المستخدمون", "users"],
    authority: "إنشاء مستخدم (createUser / userCreateSchema) في `users/actions.ts`",
    identityPolicy: "اسم المستخدم فريد؛ عدة حسابات لاسم واحد تُحجز؛ لا تفعيل ولا كلمات سر",
    writes: "حساب غير مفعّل (isActive=false) بكلمة سر عشوائية غير قابلة للاستخدام؛ ADMIN/MANAGER تُحجز لاعتماد منفصل", updatesExisting: false,
    fields: [
      { id: "username", label: "اسم المستخدم", required: true, type: "username", example: "test.user1", help: "حروف وأرقام إنجليزية فقط (. _ - مسموحة)، 3 أحرف على الأقل، بلا فراغات", aliases: ["اسم المستخدم"] },
      text("fullName", "الاسم الكامل", true, "مستخدم تجريبي", "الاسم الكامل (حرفان على الأقل)", ["الاسم"]),
      { id: "role", label: "الدور", required: true, type: "enum", enumMap: ACCOUNT_ROLE_MAP, example: ACCOUNT_ROLE_LABELS[0] ?? "", help: "من أدوار النظام؛ مدير النظام والمدير الإداري لا يُستوردان (اعتماد منفصل)", aliases: ["الدور"] },
      text("jobTitle", "المسمى الوظيفي", false, "موظف استقبال", "معلومة فقط (لا تحدد صلاحية)"),
      text("department", "القسم", false, "", "اختياري"),
      { id: "phone", label: "رقم الهاتف", required: false, type: "phone", example: "07700000001", help: "10 أو 11 رقماً (اختياري)" },
      { id: "email", label: "البريد", required: false, type: "email", example: "name@example.test", help: "اختياري" },
    ],
    notImported: [
      { name: "كلمة السر", reason: "لا تُستورد ولا تُصدَّر؛ التفعيل خطوة منفصلة آمنة" },
      { name: "الصلاحيات الفردية", reason: "تُدار من صفحة الحساب فقط" },
      { name: "ربط الحساب بسجل موظف", reason: "يتم من ملف الموظف بدليل قاطع؛ لا يوجد عمود ربط في القالب" },
    ],
  },
  {
    id: "memberships", title: "عضويات المراكز الموثّقة", permission: "datacenter.import.memberships", sheetNames: ["البيانات", "data", "memberships"],
    authority: "عضوية مركز (center-membership.ts / users/actions.ts)",
    identityPolicy: "المركز + المستخدم + صفة العضوية؛ الصفة تُشتق من دور الحساب ولا تُدخل في الملف؛ العضوية القائمة تُعدّ مطابقة",
    writes: "عضوية مركز فعّالة لحساب موجود في الفرع نفسه (الصفة = المقابلة لدور الحساب)", updatesExisting: false,
    fields: [
      { id: "username", label: "اسم المستخدم", required: true, type: "username", example: "test.user1", help: "حساب موجود في فرع العملية" },
      { id: "centerName", label: "اسم المركز", required: true, type: "ref", ref: "centers", example: "", help: "اختر من القائمة (المراكز الفعّالة)" },
      text("specialty", "الاختصاص", false, "", "اختياري"),
      { id: "startDate", label: "تاريخ البدء", required: false, type: "date", example: "2026-01-01", help: "اختياري (YYYY-MM-DD)؛ الافتراضي اليوم" },
    ],
    notImported: [{ name: "صفة العضوية", reason: "تُشتق تلقائياً من دور الحساب (centerRoleForUserRole)" }, { name: "تاريخ الانتهاء", reason: "إنهاء العضوية يتم من صفحة الحساب" }],
  },
];

export const IMPORT_DOMAIN_BY_ID: Record<string, ImportDomain> = Object.fromEntries(IMPORT_DOMAINS.map((d) => [d.id, d]));

export type ExportDomainId = "patients" | "personnel" | "users" | "reference" | "appointments" | "sessions" | "pharmacy_stock" | "pharmacy_movements" | "finance_invoices";

export type ExportDomainInfo = {
  id: ExportDomainId; title: string; permission: string; requires: string[]; needsRange: boolean; columns: string[]; note: string;
};

// Exports are authorized read-only summaries; they are NOT import templates and never claim to be re-importable.
export const EXPORT_IS_REIMPORTABLE = false;

// Sensitive domains with NO established export policy: disabled and documented (never exposed through a universal button).
export const DISABLED_EXPORTS: { title: string; reason: string }[] = [
  { title: "التقارير الطبية والوثائق الموقعة", reason: "لا توجد سياسة تصدير جماعي معتمدة؛ الطباعة الفردية فقط عبر صلاحياتها" },
  { title: "التشخيصات والملف الطبي الكامل", reason: "سجل سريري حساس: لا تصدير جماعي" },
  { title: "سجل التدقيق", reason: "يُعرض داخل النظام فقط" },
  { title: "المالية العابرة للفروع", reason: "غير معتمدة؛ الملخصات المالية تقتصر على فرع المستخدم وبصلاحية تصدير مالية صريحة" },
  { title: "كلمات السر ورموز الدخول", reason: "لا تُصدَّر أبداً" },
];

/** Domains shown as the two primary categories; the rest are advanced options. */
export const PRIMARY_IMPORT_DOMAINS = ["patients", "staff"] as const;
export const isAdvancedDomain = (id: string) => !(PRIMARY_IMPORT_DOMAINS as readonly string[]).includes(id);

/** Unified-file rows carry their sheet in the row number: personnel 1.., accounts 100000+, memberships 200000+. */
export const STAFF_ROW_BASE = { personnel: 0, accounts: 100_000, memberships: 200_000 } as const;
export function decodeStaffRow(n: number): { sheet: "personnel" | "accounts" | "memberships"; row: number } {
  if (n >= STAFF_ROW_BASE.memberships) return { sheet: "memberships", row: n - STAFF_ROW_BASE.memberships };
  if (n >= STAFF_ROW_BASE.accounts) return { sheet: "accounts", row: n - STAFF_ROW_BASE.accounts };
  return { sheet: "personnel", row: n };
}
