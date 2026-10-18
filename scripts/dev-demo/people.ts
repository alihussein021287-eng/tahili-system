// Fictional people for the local demo copy only. Every name and phone number here is invented.

export type DemoRole =
  | "MANAGER" | "DOCTOR" | "THERAPIST" | "VIEWER" | "ACCOUNTANT" | "PHARMACIST" | "RECEPTION" | "SECRETARY"
  | "LAB" | "RADIOLOGY" | "DRESSING" | "PROSTHETICS" | "HEAD_THERAPIST" | "DATA_ENTRY" | "RESIDENT";

export const DEMO_BRANCHES = ["فرع بغداد الرئيسي", "فرع كربلاء"] as const;

export const CENTER = {
  physio: "مركز العلاج الطبيعي",
  psych: "مركز التأهيل النفسي",
  occupational: "مركز العلاج الوظيفي",
  prosthetics: "مركز الأطراف والمساند الصناعية",
  wounds: "مركز علاج الجروح والتقرحات",
} as const;

type Membership = { center: string; role: "CENTER_MANAGEMENT" | "HEAD_THERAPIST" | "THERAPIST" | "DEVICE_OPERATOR" | "SECRETARY" | "RESIDENT" | "SPECIALIST"; specialty?: string };

export type DemoUser = {
  username: string; role: DemoRole; fullName: string; jobTitle: string; department: string;
  /** Centre staff carry no branch: centres serve every branch. */
  branch: (typeof DEMO_BRANCHES)[number] | null; memberships: Membership[];
};

const B = DEMO_BRANCHES[0];
const K = DEMO_BRANCHES[1];

export const DEMO_USERS: DemoUser[] = [
  // الإدارة
  { username: "manager1", role: "MANAGER", fullName: "حيدر عبد الأمير الساعدي", jobTitle: "مدير المجمع", department: "الإدارة", branch: B, memberships: [{ center: CENTER.physio, role: "CENTER_MANAGEMENT" }] },
  { username: "manager2", role: "MANAGER", fullName: "سناء كاظم الربيعي", jobTitle: "معاون المدير", department: "الإدارة", branch: B, memberships: [] },
  { username: "manager3", role: "MANAGER", fullName: "رعد جبار التميمي", jobTitle: "مدير فرع كربلاء", department: "الإدارة", branch: K, memberships: [] },
  // الاستقبال
  { username: "reception1", role: "RECEPTION", fullName: "زينب علي الموسوي", jobTitle: "موظفة استقبال", department: "الاستقبال", branch: B, memberships: [] },
  { username: "reception2", role: "RECEPTION", fullName: "مصطفى حسن العبيدي", jobTitle: "موظف استقبال", department: "الاستقبال", branch: B, memberships: [] },
  { username: "reception3", role: "RECEPTION", fullName: "نور الهدى صادق الحسيني", jobTitle: "موظفة استقبال", department: "الاستقبال", branch: K, memberships: [] },
  // إدخال البيانات
  { username: "dataentry1", role: "DATA_ENTRY", fullName: "علي كريم الجبوري", jobTitle: "مدخل بيانات", department: "الإحصاء", branch: B, memberships: [] },
  { username: "dataentry2", role: "DATA_ENTRY", fullName: "مريم فاضل الخفاجي", jobTitle: "مدخلة بيانات", department: "الإحصاء", branch: B, memberships: [] },
  { username: "dataentry3", role: "DATA_ENTRY", fullName: "أحمد ستار الزبيدي", jobTitle: "مدخل بيانات", department: "الإحصاء", branch: K, memberships: [] },
  // سكرتارية المراكز
  { username: "secretary1", role: "SECRETARY", fullName: "هبة عادل الشمري", jobTitle: "سكرتيرة مركز", department: "العلاج الطبيعي", branch: null, memberships: [{ center: CENTER.physio, role: "SECRETARY" }] },
  { username: "secretary2", role: "SECRETARY", fullName: "ضحى ماجد الكعبي", jobTitle: "سكرتيرة مركز", department: "التأهيل النفسي", branch: null, memberships: [{ center: CENTER.psych, role: "SECRETARY" }] },
  { username: "secretary3", role: "SECRETARY", fullName: "ياسر نعمة الدراجي", jobTitle: "سكرتير مركز", department: "العلاج الوظيفي", branch: null, memberships: [{ center: CENTER.occupational, role: "SECRETARY" }] },
  // الأطباء المقيمون
  { username: "resident1", role: "RESIDENT", fullName: "د. سجاد محمد الحلفي", jobTitle: "طبيب مقيم", department: "الاستشارية", branch: null, memberships: [{ center: CENTER.physio, role: "RESIDENT" }] },
  { username: "resident2", role: "RESIDENT", fullName: "د. آيات رحيم البدري", jobTitle: "طبيبة مقيمة", department: "الاستشارية", branch: null, memberships: [{ center: CENTER.psych, role: "RESIDENT" }] },
  { username: "resident3", role: "RESIDENT", fullName: "د. منتظر عباس اللامي", jobTitle: "طبيب مقيم", department: "الاستشارية", branch: null, memberships: [{ center: CENTER.occupational, role: "RESIDENT" }] },
  // أطباء الاختصاص
  { username: "doctor1", role: "DOCTOR", fullName: "د. كاظم جواد الياسري", jobTitle: "اختصاص طب الإصابات والتأهيل", department: "الاستشارية", branch: null, memberships: [{ center: CENTER.physio, role: "SPECIALIST", specialty: "طب التأهيل" }] },
  { username: "doctor2", role: "DOCTOR", fullName: "د. شيماء عبد الحسين الطائي", jobTitle: "اختصاص طب نفسي", department: "الاستشارية", branch: null, memberships: [{ center: CENTER.psych, role: "SPECIALIST", specialty: "طب نفسي" }] },
  { username: "doctor3", role: "DOCTOR", fullName: "د. فراس هادي المالكي", jobTitle: "اختصاص جراحة عظام", department: "الاستشارية", branch: null, memberships: [{ center: CENTER.occupational, role: "SPECIALIST", specialty: "جراحة عظام" }, { center: CENTER.physio, role: "SPECIALIST", specialty: "جراحة عظام" }] },
  // رؤساء المعالجين
  { username: "headtherapist1", role: "HEAD_THERAPIST", fullName: "حسين علوان الفتلاوي", jobTitle: "رئيس المعالجين", department: "العلاج الطبيعي", branch: null, memberships: [{ center: CENTER.physio, role: "HEAD_THERAPIST" }] },
  { username: "headtherapist2", role: "HEAD_THERAPIST", fullName: "رنا صباح العزاوي", jobTitle: "رئيسة المعالجين", department: "التأهيل النفسي", branch: null, memberships: [{ center: CENTER.psych, role: "HEAD_THERAPIST" }] },
  { username: "headtherapist3", role: "HEAD_THERAPIST", fullName: "عمار طالب الكناني", jobTitle: "رئيس المعالجين", department: "العلاج الوظيفي", branch: null, memberships: [{ center: CENTER.occupational, role: "HEAD_THERAPIST" }] },
  // المعالجون
  { username: "therapist1", role: "THERAPIST", fullName: "محمد جاسم السوداني", jobTitle: "معالج طبيعي", department: "العلاج الطبيعي", branch: null, memberships: [{ center: CENTER.physio, role: "THERAPIST", specialty: "علاج طبيعي" }] },
  { username: "therapist2", role: "THERAPIST", fullName: "فاطمة حميد العامري", jobTitle: "معالجة طبيعية", department: "العلاج الطبيعي", branch: null, memberships: [{ center: CENTER.physio, role: "THERAPIST", specialty: "علاج مائي" }] },
  { username: "therapist3", role: "THERAPIST", fullName: "عباس ناظم الشبلي", jobTitle: "معالج وظيفي ونفسي", department: "التأهيل", branch: null, memberships: [{ center: CENTER.psych, role: "THERAPIST", specialty: "تأهيل نفسي" }, { center: CENTER.occupational, role: "THERAPIST", specialty: "علاج وظيفي" }] },
  // الصيدلية
  { username: "pharmacist1", role: "PHARMACIST", fullName: "ص. لمياء خالد النعيمي", jobTitle: "صيدلانية", department: "الصيدلية", branch: B, memberships: [] },
  { username: "pharmacist2", role: "PHARMACIST", fullName: "ص. حسن مهدي الغزي", jobTitle: "صيدلاني", department: "الصيدلية", branch: B, memberships: [] },
  { username: "pharmacist3", role: "PHARMACIST", fullName: "ص. إسراء ثامر الجنابي", jobTitle: "صيدلانية", department: "الصيدلية", branch: K, memberships: [] },
  // المختبر والأشعة
  { username: "lab1", role: "LAB", fullName: "قاسم يوسف الحمداني", jobTitle: "فني مختبر", department: "المختبر", branch: B, memberships: [] },
  { username: "lab2", role: "LAB", fullName: "دعاء سلمان الركابي", jobTitle: "فنية مختبر", department: "المختبر", branch: B, memberships: [] },
  { username: "lab3", role: "LAB", fullName: "باسم شاكر العكيلي", jobTitle: "فني مختبر", department: "المختبر", branch: K, memberships: [] },
  { username: "radiology1", role: "RADIOLOGY", fullName: "وسام عدنان البهادلي", jobTitle: "فني أشعة", department: "الأشعة", branch: B, memberships: [] },
  { username: "radiology2", role: "RADIOLOGY", fullName: "رقية حيدر المحمداوي", jobTitle: "فنية أشعة", department: "الأشعة", branch: B, memberships: [] },
  { username: "radiology3", role: "RADIOLOGY", fullName: "أنور فالح الدليمي", jobTitle: "فني أشعة", department: "الأشعة", branch: K, memberships: [] },
  // التضميد والأطراف
  { username: "dressing1", role: "DRESSING", fullName: "كوثر جليل الأسدي", jobTitle: "ممرضة تضميد", department: "التضميد", branch: B, memberships: [{ center: CENTER.wounds, role: "DEVICE_OPERATOR" }] },
  { username: "dressing2", role: "DRESSING", fullName: "سيف الدين ناصر الحسناوي", jobTitle: "ممرض تضميد", department: "التضميد", branch: B, memberships: [{ center: CENTER.wounds, role: "DEVICE_OPERATOR" }] },
  { username: "dressing3", role: "DRESSING", fullName: "هدى عبد الكريم الخزرجي", jobTitle: "ممرضة تضميد", department: "التضميد", branch: K, memberships: [] },
  { username: "prosthetics1", role: "PROSTHETICS", fullName: "ليث عبد الرزاق العنزي", jobTitle: "فني أطراف صناعية", department: "الأطراف", branch: B, memberships: [{ center: CENTER.prosthetics, role: "DEVICE_OPERATOR" }] },
  { username: "prosthetics2", role: "PROSTHETICS", fullName: "أمل مجيد السلطاني", jobTitle: "فنية مساند", department: "الأطراف", branch: B, memberships: [{ center: CENTER.prosthetics, role: "DEVICE_OPERATOR" }] },
  { username: "prosthetics3", role: "PROSTHETICS", fullName: "مهند قيس الزيدي", jobTitle: "فني أطراف صناعية", department: "الأطراف", branch: K, memberships: [] },
  // المالية
  { username: "accountant1", role: "ACCOUNTANT", fullName: "نادية فؤاد البياتي", jobTitle: "محاسبة", department: "الشعبة المالية", branch: B, memberships: [] },
  { username: "accountant2", role: "ACCOUNTANT", fullName: "جعفر صالح الخالدي", jobTitle: "محاسب", department: "الشعبة المالية", branch: B, memberships: [] },
  { username: "accountant3", role: "ACCOUNTANT", fullName: "تبارك وليد العتابي", jobTitle: "محاسبة", department: "الشعبة المالية", branch: K, memberships: [] },
  // مشاهدة فقط
  { username: "viewer1", role: "VIEWER", fullName: "عقيل حامد الكرعاوي", jobTitle: "مدقق", department: "الرقابة", branch: B, memberships: [] },
  { username: "viewer2", role: "VIEWER", fullName: "سارة إياد الحيدري", jobTitle: "مدققة", department: "الرقابة", branch: B, memberships: [] },
  { username: "viewer3", role: "VIEWER", fullName: "بشير مالك الشويلي", jobTitle: "مدقق", department: "الرقابة", branch: K, memberships: [] },
];

export type DemoPatient = {
  fullName: string; gender: "MALE" | "FEMALE"; birthYear: number; phone: string; governorate: string;
  injury: string; formation: string; rank: string; branch: (typeof DEMO_BRANCHES)[number];
  /** The path this patient walks in the full check. */
  scenario: "physio" | "psych" | "occupational" | "pharmacy" | "lab" | "radiology" | "dressing" | "prosthetics" | "admission" | "sickleave" | "official" | "finance" | "intake-only" | "resident-stop" | "specialist-stop";
};

const P = (fullName: string, gender: "MALE" | "FEMALE", birthYear: number, n: number, governorate: string, injury: string, formation: string, rank: string, scenario: DemoPatient["scenario"], branch: (typeof DEMO_BRANCHES)[number] = B): DemoPatient => ({
  fullName, gender, birthYear, phone: `0770000${String(n).padStart(4, "0")}`, governorate, injury, formation, rank, branch, scenario,
});

export const DEMO_PATIENTS: DemoPatient[] = [
  P("عبد الله حسين جاسم الكربلائي", "MALE", 1991, 1, "بغداد", "إصابة بطلق ناري", "هيئة الحشد الشعبي", "منتسب", "physio"),
  P("حسن علي كاظم الفريجي", "MALE", 1988, 2, "بغداد", "إصابة الحبل الشوكي", "وزارة الدفاع", "عريف", "physio"),
  P("مرتضى جبار عبد الزهرة", "MALE", 1995, 3, "البصرة", "كسر", "وزارة الداخلية", "جندي أول", "physio"),
  P("أمير صلاح مهدي العلي", "MALE", 1990, 4, "بابل", "إصابة أعصاب", "هيئة الحشد الشعبي", "منتسب", "physio"),
  P("كرار عدنان سلمان", "MALE", 1993, 5, "ذي قار", "بتر طرف سفلي", "هيئة الحشد الشعبي", "منتسب", "physio"),
  P("محمد رضا عبد الحسين", "MALE", 1985, 6, "النجف", "إصابة بشظايا", "وزارة الدفاع", "نائب ضابط", "physio"),
  P("زهراء محسن عبد الواحد", "FEMALE", 1998, 7, "بغداد", "حادث سير", "مدني", "مدني", "psych"),
  P("علي أكبر فاضل جواد", "MALE", 1992, 8, "كربلاء", "انفجار عبوة ناسفة", "هيئة الحشد الشعبي", "منتسب", "psych"),
  P("ميثم حامد عبود", "MALE", 1987, 9, "ميسان", "إصابة الرأس والدماغ", "وزارة الداخلية", "رئيس عرفاء", "psych"),
  P("رسل باسم عبد الأمير", "FEMALE", 2000, 10, "بغداد", "حروق", "مدني", "مدني", "psych"),
  P("سيف علاء حسين", "MALE", 1994, 11, "واسط", "قطع أو تمزق أوتار", "وزارة الدفاع", "جندي", "occupational"),
  P("حيدر نزار كريم", "MALE", 1989, 12, "القادسية", "بتر طرف علوي", "هيئة الحشد الشعبي", "منتسب", "occupational"),
  P("أحمد عبد الستار جميل", "MALE", 1996, 13, "الأنبار", "كسر", "جهاز مكافحة الإرهاب", "ملازم", "occupational"),
  P("سجى رائد إبراهيم", "FEMALE", 1997, 14, "بغداد", "إصابة مزمنة", "مدني", "مدني", "occupational"),
  P("حسين فلاح عبد علي", "MALE", 1986, 15, "البصرة", "إصابة بطلق ناري", "وزارة الدفاع", "نقيب", "pharmacy"),
  P("عمار ياسين طه", "MALE", 1990, 16, "صلاح الدين", "إصابة بشظايا", "هيئة الحشد الشعبي", "منتسب", "pharmacy"),
  P("نرجس كامل حسون", "FEMALE", 1993, 17, "بغداد", "حالة مرضية غير رضّية", "مدني", "مدني", "pharmacy"),
  P("جاسم محمد خلف", "MALE", 1984, 18, "نينوى", "إصابة سحقية", "وزارة الداخلية", "عريف", "lab"),
  P("مصطفى ضياء عبد الله", "MALE", 1999, 19, "بابل", "إصابة بطلق ناري", "هيئة الحشد الشعبي", "منتسب", "lab"),
  P("ليلى عبد الرضا هاشم", "FEMALE", 1991, 20, "النجف", "سقوط من ارتفاع", "مدني", "مدني", "radiology"),
  P("أيمن قاسم عيدان", "MALE", 1995, 21, "ذي قار", "خلع مفصل", "وزارة الدفاع", "جندي أول", "radiology"),
  P("صادق مجيد حمزة", "MALE", 1988, 22, "بغداد", "حروق", "هيئة الحشد الشعبي", "منتسب", "dressing"),
  P("عباس جعفر موسى", "MALE", 1992, 23, "كربلاء", "إصابة بشظايا", "هيئة الحشد الشعبي", "منتسب", "dressing", K),
  P("ابتهال حسن علوان", "FEMALE", 1989, 24, "بغداد", "إصابة مزمنة", "مدني", "مدني", "dressing"),
  P("ضياء حمزة كاظم", "MALE", 1990, 25, "المثنى", "بتر طرف سفلي", "وزارة الدفاع", "رائد", "prosthetics"),
  P("مهدي عبد الكاظم جبر", "MALE", 1983, 26, "بغداد", "بتر متعدد", "هيئة الحشد الشعبي", "منتسب", "prosthetics"),
  P("علي حسين عبد الجليل", "MALE", 1996, 27, "كربلاء", "بتر طرف علوي", "هيئة الحشد الشعبي", "منتسب", "prosthetics", K),
  P("يوسف صباح نوري", "MALE", 1994, 28, "بغداد", "إصابة الحبل الشوكي", "وزارة الداخلية", "منتسب", "admission"),
  P("طه عبد المنعم راضي", "MALE", 1987, 29, "ديالى", "إصابة الرأس والدماغ", "جهاز الأمن الوطني", "مقدم", "admission"),
  P("هاشم وليد فاضل", "MALE", 1991, 30, "بغداد", "كسر", "وزارة الدفاع", "جندي", "sickleave"),
  P("منى عبد الجبار سعيد", "FEMALE", 1990, 31, "البصرة", "حادث سير", "مدني", "مدني", "sickleave"),
  P("رياض عبد الهادي ناصر", "MALE", 1982, 32, "بغداد", "إصابة بطلق ناري", "وزارة الدفاع", "عقيد", "official"),
  P("بلال سامي حسن", "MALE", 1997, 33, "كركوك", "انفجار عبوة ناسفة", "هيئة الحشد الشعبي", "منتسب", "official"),
  P("عادل شهيد عبد الأمير", "MALE", 1986, 34, "بغداد", "إصابة بشظايا", "هيئة الحشد الشعبي", "منتسب", "finance"),
  P("غفران مهند عبد الله", "FEMALE", 1995, 35, "بابل", "حروق", "مدني", "مدني", "finance"),
  P("تحسين كريم عزيز", "MALE", 1993, 36, "بغداد", "كسر", "وزارة الداخلية", "منتسب", "intake-only"),
  P("زيد ماهر عبد الرحمن", "MALE", 1998, 37, "كربلاء", "قطع أو تمزق أوتار", "هيئة الحشد الشعبي", "منتسب", "intake-only", K),
  P("إسراء جواد كاظم", "FEMALE", 1994, 38, "بغداد", "إصابة أعصاب", "مدني", "مدني", "resident-stop"),
  P("حمزة عبد الأمير راضي", "MALE", 1989, 39, "النجف", "إصابة بطلق ناري", "هيئة الحشد الشعبي", "منتسب", "resident-stop"),
  P("قيصر عبد الحميد صالح", "MALE", 1985, 40, "بغداد", "بتر طرف سفلي", "وزارة الدفاع", "نائب عريف", "specialist-stop"),
];
