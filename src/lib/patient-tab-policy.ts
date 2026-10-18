export const PATIENT_TABS = [
  { key:"overview", label:"نظرة عامة", icon:"▦", group:"followup", permissions:["patients.view"] },
  { key:"timeline", label:"الخط الزمني", icon:"◷", group:"followup", permissions:["patients.view"] },
  { key:"journey", label:"مسار المتابعة", icon:"◇", group:"followup", permissions:["journey.view"] },
  { key:"diag", label:"الاستشارية الطبية", icon:"+", group:"medical", permissions:["clinical.view","clinical.diagnosis","clinical.report"] },
  { key:"resident", label:"الطبيب المقيم", icon:"○", group:"medical", permissions:["clinical.view","clinical.wound","clinical.metrics"] },
  { key:"referrals", label:"الفحوص والإحالات", icon:"↗", group:"medical", permissions:["referrals.view","referrals.create"] },
  { key:"sessions", label:"الجلسات العلاجية", icon:"▷", group:"therapy", permissions:["clinical.session","therapy.view","therapy.session.record"] },
  { key:"therapyProgram", label:"برنامج العلاج الطبيعي", icon:"▤", group:"therapy", permissions:["therapy.view"] },
  { key:"centerPrograms", label:"برامج المراكز", icon:"⌂", group:"therapy", permissions:["centers.view"] },
  { key:"plan", label:"الخطة العلاجية", icon:"◎", group:"therapy", permissions:["clinical.plan","therapy.view"] },
  { key:"metrics", label:"المقاييس", icon:"↗", group:"therapy", permissions:["clinical.metrics"] },
  { key:"care", label:"التداوي والتضميد", icon:"✚", group:"therapy", permissions:["clinical.care"] },
  { key:"expenses", label:"الصرفيات المالية", icon:"¤", group:"admin", permissions:["expenses.view"] },
  { key:"rx", label:"الوصفات والتجهيز", icon:"⊕", group:"admin", permissions:["clinical.prescription","pharmacy.view"] },
  { key:"adm", label:"الرقود", icon:"□", group:"admin", permissions:["clinical.admission","beds.view"] },
  { key:"official", label:"الإجراءات الرسمية", icon:"§", group:"admin", permissions:["officialdocs.view"] },
  { key:"sickleave", label:"الإجازات المرضية", icon:"△", group:"admin", permissions:["sickleave.view"] },
  { key:"corr", label:"المخاطبات", icon:"✉", group:"admin", permissions:["clinical.report"] },
  { key:"files", label:"المرفقات", icon:"⌕", group:"admin", permissions:["clinical.view","officialdocs.view"] },
  { key:"rel", label:"ذوو القربى", icon:"⋈", group:"admin", permissions:["patients.view"] },
  { key:"activity", label:"سجل النشاط", icon:"≡", group:"system", permissions:["audit.view"] },
] as const;

export type PatientTab = (typeof PATIENT_TABS)[number]["key"];
export const isKnownPatientTab = (tab: string): tab is PatientTab => PATIENT_TABS.some((item) => item.key === tab);
export const canViewPatientTab = (tab: string, permissions: ReadonlySet<string>) => isKnownPatientTab(tab) && PATIENT_TABS.find((item) => item.key === tab)!.permissions.some((permission) => permissions.has(permission));
// `vitals` is internal data needed by the visible resident tab; it is never a visible tab.
export const patientDataAuthorizationTab = (tab: string) => tab === "vitals" ? "resident" : tab;

// What the file's side menu shows: 13 entries in four groups. Each entry opens one or more of the
// sections above (the sections keep their own permissions and data loading). The entry's key is its
// first section, so every old ?tab= link still lands in the right place.
export const PATIENT_NAV_GROUPS = {
  file: "الملف",
  medical: "الطبي",
  therapy: "العلاج",
  admin: "الإداري",
} as const;

export const PATIENT_NAV: readonly { key: PatientTab; label: string; icon: string; group: keyof typeof PATIENT_NAV_GROUPS; sections: readonly PatientTab[] }[] = [
  { key: "overview", label: "نظرة عامة", icon: "▦", group: "file", sections: ["overview"] },
  { key: "timeline", label: "السجل", icon: "◷", group: "file", sections: ["timeline", "journey", "activity"] },
  { key: "rel", label: "البيانات وذوو القربى", icon: "⋈", group: "file", sections: ["rel"] },
  { key: "diag", label: "الاستشارية الطبية", icon: "+", group: "medical", sections: ["diag"] },
  { key: "resident", label: "الطبيب المقيم", icon: "○", group: "medical", sections: ["resident"] },
  { key: "referrals", label: "الفحوص والإحالات", icon: "↗", group: "medical", sections: ["referrals"] },
  { key: "rx", label: "الوصفات", icon: "⊕", group: "medical", sections: ["rx"] },
  { key: "care", label: "التداوي والتضميد", icon: "✚", group: "medical", sections: ["care"] },
  { key: "therapyProgram", label: "العلاج الطبيعي", icon: "▤", group: "therapy", sections: ["therapyProgram", "sessions", "metrics", "plan"] },
  { key: "centerPrograms", label: "برامج المراكز", icon: "⌂", group: "therapy", sections: ["centerPrograms"] },
  { key: "adm", label: "الرقود", icon: "□", group: "therapy", sections: ["adm"] },
  { key: "expenses", label: "الصرفيات المالية", icon: "¤", group: "admin", sections: ["expenses"] },
  { key: "official", label: "الكتب والوثائق", icon: "§", group: "admin", sections: ["official", "sickleave", "corr", "files"] },
];

/** The menu entry that holds a section (or the entry itself when given an entry key). */
export const patientNavFor = (key: string | null | undefined) => PATIENT_NAV.find((item) => item.sections.includes(key as PatientTab));
