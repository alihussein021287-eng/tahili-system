import { environmentFingerprint, FINGERPRINT_LABEL } from "./environment";
import { IMPORT_DOMAIN_BY_ID, STAFF_TEMPLATE_VERSION, TEMPLATE_VERSION, type FieldDef, type ImportDomain } from "./registry";
import type { References } from "./reference";
import { sheetLib } from "./spreadsheet";

const TYPE_LABEL: Record<string, string> = { text: "نص", int: "رقم صحيح", percent: "نسبة 0–100", year: "سنة", phone: "هاتف", enum: "قائمة مغلقة", yesno: "نعم/لا", date: "تاريخ", username: "اسم مستخدم", email: "بريد", ref: "قائمة النظام" };
const DATA_ROWS = 2000; // validation range (the importer limit is 5000 rows)

const colName = (i: number) => { let n = i, s = ""; do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0); return s; };

/** The allowed values of a field exactly as the importer will accept them (same lists as the validators). */
export function fieldChoices(f: FieldDef, refs: References): { values: string[]; strict: boolean } | null {
  if (f.choices) return { values: f.choices, strict: true };
  if (f.type === "enum" || f.type === "yesno") return { values: [...new Set(Object.keys(f.enumMap ?? {}).filter((k) => /[؀-ۿ]/.test(k)))], strict: true };
  if (f.type === "ref" && f.ref) return { values: refs[f.ref] ?? [], strict: true };
  if (Array.isArray(f.suggest)) return { values: f.suggest, strict: false };
  if (typeof f.suggest === "string") return { values: refs[f.suggest] ?? [], strict: false };
  return null;
}

/** Official template: row 1 = stable field identifiers, row 2 = Arabic labels. Help and the allowed-value lists live on separate sheets, never in the import rows. */
export type TemplateMeta = { databaseName?: string };

export function buildTemplate(domainId: string, format: "xlsx" | "csv", refs: References, meta: TemplateMeta = {}) {
  const d: ImportDomain | undefined = IMPORT_DOMAIN_BY_ID[domainId];
  if (!d) return null;
  if (d.sheets) return format === "xlsx" ? buildMultiSheetTemplate(d, refs, meta) : null; // the unified file is XLSX only (it has linked sheets)
  const lib = sheetLib();
  const ids = d.fields.map((f) => f.id);
  const labels = d.fields.map((f) => f.label);
  const name = `tahili-template-${d.id}-v${TEMPLATE_VERSION}`;
  if (format === "csv") return { bytes: lib.writeCsv([ids, labels]), filename: `${name}.csv`, contentType: "text/csv; charset=utf-8" };

  const listCols: { label: string; values: string[] }[] = [];
  const validations: { sqref: string; kind: "list" | "whole" | "decimal"; list?: string; min?: number; max?: number; strict?: boolean }[] = [];
  d.fields.forEach((f, ci) => {
    const range = `${colName(ci)}3:${colName(ci)}${DATA_ROWS + 2}`;
    const choices = fieldChoices(f, refs);
    if (choices && choices.values.length) {
      const lc = listCols.length;
      listCols.push({ label: f.label, values: choices.values });
      validations.push({ sqref: range, kind: "list", list: `'القوائم'!$${colName(lc)}$2:$${colName(lc)}$${choices.values.length + 1}`, strict: choices.strict });
    } else if (f.type === "int") validations.push({ sqref: range, kind: "whole", min: 0, max: 999 });
    else if (f.type === "percent") validations.push({ sqref: range, kind: "decimal", min: 0, max: 100 });
  });
  const maxList = Math.max(0, ...listCols.map((c) => c.values.length));
  const listRows: string[][] = [listCols.map((c) => c.label), ...Array.from({ length: maxList }, (_, r) => listCols.map((c) => c.values[r] ?? ""))];

  const help: string[][] = [
    [`قالب ${d.title} — الإصدار ${TEMPLATE_VERSION}`],
    [`المرجع المعتمد لهذا القالب: ${d.authority}`],
    ["الصف الأول في ورقة «البيانات» معرّفات الحقول ولا يُعدَّل؛ الصف الثاني تسميات عربية يُتجاهل؛ ابدأ بياناتك من الصف الثالث."],
    ["القوائم المنسدلة مأخوذة من النظام نفسه وقت تنزيل القالب؛ القيمة خارج القائمة المغلقة تُرفض عند التحقق."],
    ["لا تُستخدم الصيغ (formulas) ولا الماكرو. لا يُحدَّث أي سجل قائم بالاستيراد."],
    [`سياسة الهوية: ${d.identityPolicy}`],
    [`ما يُنشأ عند التنفيذ المعتمد: ${d.writes}`],
    [],
    ["المعرّف", "التسمية", "الإلزام", "النوع", "القيم المسموحة", "مثال خيالي", "الشرح"],
    ...d.fields.map((f) => {
      const c = fieldChoices(f, refs);
      const allowed = c ? (c.values.length > 12 ? `${c.values.length} قيمة في ورقة «القوائم»` : c.values.join(" / ")) : "";
      return [f.id, f.label, f.required ? "مطلوب" : "اختياري", TYPE_LABEL[f.type] ?? f.type, allowed + (c && !c.strict ? " (مقترحة)" : ""), f.example, f.help];
    }),
    [],
    ["حقول من النموذج نفسه غير قابلة للاستيراد عمداً:"],
    ...d.notImported.map((n) => [n.name, n.reason]),
    [],
    ["عناوين بديلة مقبولة من الملفات القديمة (محوّل موثّق، لا تُستعمل في هذا القالب):"],
    ...d.fields.filter((f) => f.aliases?.length).map((f) => [f.id, (f.aliases ?? []).join(" ، ")]),
  ];
  const sheets: Parameters<typeof lib.writeXlsx>[0] = [
    { name: "البيانات", rows: [ids, labels], widths: d.fields.map(() => 24), validations } as never,
    { name: "تعليمات", widths: [22, 22, 12, 14, 36, 24, 60], rows: help },
  ];
  if (listCols.length) sheets.push({ name: "القوائم", rows: listRows, widths: listCols.map(() => 28) });
  return { bytes: lib.writeXlsx(sheets), filename: `${name}.xlsx`, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
}

/** The unified multi-sheet template: one data sheet per linked entity, then instructions and generated lists (neither is imported as data). */
function buildMultiSheetTemplate(d: ImportDomain, refs: References, meta: TemplateMeta) {
  if (!meta.databaseName) throw new Error("the unified template must be generated for a specific environment");
  const lib = sheetLib();
  const listCols: { label: string; values: string[] }[] = [];
  const dataSheets = d.sheets!.map((sh) => {
    const validations: { sqref: string; kind: "list" | "whole" | "decimal"; list?: string; min?: number; max?: number; strict?: boolean }[] = [];
    sh.fields.forEach((f, ci) => {
      const range = `${colName(ci)}3:${colName(ci)}${DATA_ROWS + 2}`;
      const choices = fieldChoices(f, refs);
      if (choices && choices.values.length) {
        const lc = listCols.length;
        listCols.push({ label: `${sh.name} — ${f.label}`, values: choices.values });
        validations.push({ sqref: range, kind: "list", list: `'القوائم'!$${colName(lc)}$2:$${colName(lc)}$${choices.values.length + 1}`, strict: choices.strict });
      } else if (f.type === "int") validations.push({ sqref: range, kind: "whole", min: 0, max: 999 });
      else if (f.type === "percent") validations.push({ sqref: range, kind: "decimal", min: 0, max: 100 });
    });
    return { name: sh.name, rows: [sh.fields.map((f) => f.id), sh.fields.map((f) => f.label)], widths: sh.fields.map(() => 26), validations };
  });
  const maxList = Math.max(0, ...listCols.map((c) => c.values.length));
  const listRows: string[][] = [listCols.map((c) => c.label), ...Array.from({ length: maxList }, (_, r) => listCols.map((c) => c.values[r] ?? ""))];
  const help: string[][] = [
    [`قالب ${d.title} — الإصدار ${STAFF_TEMPLATE_VERSION}`],
    [`المرجع المعتمد: ${d.authority}`],
    [`${FINGERPRINT_LABEL}: ${environmentFingerprint(meta.databaseName)}`, `البيئة: ${meta.databaseName}`, `وقت التنزيل: ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`],
    ["هذا القالب مرتبط بالبيئة التي نُزّل منها (المراكز وسائر القوائم من قاعدة بياناتها)؛ لا يُقبل في بيئة أخرى. نزّل القالب من البيئة التي ستستورد إليها."],
    ["ملف واحد بثلاث أوراق مترابطة: «الأشخاص» ثم «الحسابات» ثم «العضويات»؛ يربط بينها عمود «رمز الشخص» الثابت."],
    ["الصف الأول في كل ورقة بيانات معرّفات الحقول ولا يُعدَّل؛ الصف الثاني تسميات عربية يُتجاهل؛ ابدأ من الصف الثالث. ورقتا «تعليمات» و«القوائم» لا تُستوردان."],
    ["ورقتا «الحسابات» و«العضويات» اختياريتان: يمكن استيراد الأشخاص وحدهم. لا كلمات سر في الملف؛ تُنشأ الحسابات غير مفعّلة ويُفعَّل كل حساب لاحقاً بالمسار الآمن."],
    [`سياسة الهوية: ${d.identityPolicy}`],
    [`ما يُنشأ عند التنفيذ المعتمد: ${d.writes}`],
    [],
    ...d.sheets!.flatMap((sh) => [
      [`ورقة «${sh.name}» — ${sh.title}`],
      ["المعرّف", "التسمية", "الإلزام", "النوع", "القيم المسموحة", "مثال خيالي", "الشرح"],
      ...sh.fields.map((f) => {
        const c = fieldChoices(f, refs);
        const allowed = c ? (c.values.length > 12 ? `${c.values.length} قيمة في ورقة «القوائم»` : c.values.join(" / ")) : "";
        return [f.id, f.label, f.required ? "مطلوب" : "اختياري", TYPE_LABEL[f.type] ?? f.type, allowed, f.example, f.help];
      }),
      [],
    ]),
    ["غير قابل للاستيراد عمداً:"],
    ...d.notImported.map((n) => [n.name, n.reason]),
  ];
  const sheets = [...dataSheets, { name: "تعليمات", widths: [22, 22, 12, 14, 36, 24, 60], rows: help }, ...(listCols.length ? [{ name: "القوائم", rows: listRows, widths: listCols.map(() => 30) }] : [])];
  return { bytes: lib.writeXlsx(sheets as never), filename: `tahili-template-${d.id}-v${STAFF_TEMPLATE_VERSION}.xlsx`, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
}
