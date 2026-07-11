"use client";

import { useMemo, useState } from "react";
import { importPatients } from "@/app/(app)/patients/actions";

type Row = {
  line: number;
  fullName: string;
  phone: string;
  motherName: string;
  birthYear: string;
  housing: string;
  notes: string;
  errors: string[];
  key: string;
};

function parseCsvLine(line: string, delim: string) {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i++; }
      else quoted = !quoted;
    } else if (ch === delim && !quoted) {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

function parseRows(raw: string): Row[] {
  const text = raw.replace(/^\uFEFF/, "").replace(/^sep=.\r?\n/i, "");
  const lines = text.split(/\r?\n/).map((line, i) => ({ line: i + 1, text: line.trim() })).filter((x) => x.text);
  const sample = lines[0]?.text || "";
  const delim = sample.includes("\t") ? "\t" : (sample.split(";").length > sample.split(",").length ? ";" : ",");
  const first = lines[0]?.text ? parseCsvLine(lines[0].text, delim).join(" ") : "";
  const hasHeader = /الاسم|full.?name|phone|الهاتف|birth|التولد/i.test(first);
  const rows = lines.slice(hasHeader ? 1 : 0).map((item) => {
    const cols = parseCsvLine(item.text, delim);
    const fullName = (cols[0] || "").trim().replace(/\s+/g, " ");
    const phone = (cols[1] || "").trim();
    const motherName = (cols[2] || "").trim();
    const birthYear = (cols[3] || "").trim();
    const housing = (cols[4] || "").trim();
    const notes = (cols[5] || "").trim();
    const errors: string[] = [];
    if (!fullName || fullName.length < 3) errors.push("الاسم مطلوب");
    if (phone && !/^\d{10,11}$/.test(phone)) errors.push("الهاتف غير صحيح");
    const y = birthYear ? Number(birthYear) : null;
    if (birthYear && (!Number.isInteger(y) || y! < 1900 || y! > new Date().getFullYear())) errors.push("سنة التولد غير صحيحة");
    const key = fullName && phone && birthYear ? `${fullName}|${phone}|${birthYear}` : "";
    return { line: item.line, fullName, phone, motherName, birthYear, housing, notes, errors, key };
  });
  const seen = new Map<string, number>();
  for (const row of rows) {
    if (!row.key) continue;
    const firstLine = seen.get(row.key);
    if (firstLine) row.errors.push(`تكرار داخل الملف مع سطر ${firstLine}`);
    else seen.set(row.key, row.line);
  }
  return rows;
}

export function PatientImportTool() {
  const [data, setData] = useState("");
  const [fileName, setFileName] = useState("");
  const rows = useMemo(() => parseRows(data), [data]);
  const valid = rows.filter((r) => r.errors.length === 0);
  const invalid = rows.filter((r) => r.errors.length > 0);

  return (
    <div className="grid gap-4">
      <div className="card p-5">
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold text-gray-700">رفع أو لصق CSV</h2>
            <p className="mt-1 text-sm text-gray-500">الأعمدة: الاسم الرباعي، الهاتف، اسم الأم، سنة التولد، السكن، ملاحظات.</p>
          </div>
          <a href="/api/export/patients-template" className="btn-ghost">تحميل قالب CSV</a>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <div>
            <label className="label">ملف CSV UTF-8</label>
            <input
              type="file"
              accept=".csv,text/csv"
              className="block w-full rounded-lg border border-gray-200 p-2 text-sm file:mr-3 file:rounded-md file:border-0 file:bg-brand-50 file:px-3 file:py-1.5 file:text-brand-700"
              onChange={async (e) => {
                const f = e.currentTarget.files?.[0];
                if (!f) return;
                setFileName(f.name);
                setData(await f.text());
              }}
            />
            {fileName && <p className="mt-2 text-xs text-gray-400">الملف المحدد: {fileName}</p>}
          </div>
          <div>
            <label className="label">لصق مباشر من Excel أو CSV</label>
            <textarea
              rows={8}
              className="input font-mono text-sm"
              dir="ltr"
              value={data}
              onChange={(e) => setData(e.target.value)}
              placeholder={"الاسم الرباعي,الهاتف,اسم الأم,سنة التولد,السكن,ملاحظات\nعلي حسين قاسم محمد,07701234567,زينب,1990,بغداد,مثال"}
            />
          </div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        <div className="card p-4"><div className="text-2xl font-bold text-gray-800">{rows.length}</div><div className="text-sm text-gray-500">سطر مقروء</div></div>
        <div className="card p-4"><div className="text-2xl font-bold text-emerald-700">{valid.length}</div><div className="text-sm text-gray-500">جاهز للحفظ</div></div>
        <div className="card p-4"><div className="text-2xl font-bold text-red-700">{invalid.length}</div><div className="text-sm text-gray-500">يحتاج تصحيح</div></div>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr><th className="th">السطر</th><th className="th">الاسم</th><th className="th">الهاتف</th><th className="th">الأم</th><th className="th">التولد</th><th className="th">الحالة</th></tr></thead>
          <tbody>
            {rows.slice(0, 80).map((r) => (
              <tr key={`${r.line}-${r.fullName}`} className={r.errors.length ? "bg-red-50/50" : "hover:bg-gray-50"}>
                <td className="td">{r.line}</td>
                <td className="td font-medium">{r.fullName || "—"}</td>
                <td className="td">{r.phone || "—"}</td>
                <td className="td">{r.motherName || "—"}</td>
                <td className="td">{r.birthYear || "—"}</td>
                <td className="td">{r.errors.length ? <span className="text-red-700">{r.errors.join("، ")}</span> : <span className="text-emerald-700">صحيح</span>}</td>
              </tr>
            ))}
            {rows.length === 0 && <tr><td className="td text-center text-gray-400" colSpan={6}>اختر ملفاً أو الصق بيانات لعرض المعاينة.</td></tr>}
          </tbody>
        </table>
        {rows.length > 80 && <div className="border-t border-gray-100 px-4 py-2 text-xs text-gray-400">تظهر أول 80 سطراً فقط في المعاينة، وسيتم إرسال كل البيانات للحفظ.</div>}
      </div>

      <form action={importPatients} className="card flex flex-wrap items-center justify-between gap-3 p-4">
        <input type="hidden" name="data" value={data} />
        <div className="text-sm text-gray-500">الحفظ النهائي يعيد التحقق من الأخطاء والتكرار القوي داخل قاعدة البيانات.</div>
        <button className="btn-primary" type="submit" disabled={!valid.length}>حفظ السجلات الصحيحة</button>
      </form>
    </div>
  );
}
