import { GENDER, MARITAL, PATIENT_STATUS, CASE_TYPE, KINSHIP } from "@/lib/labels";
import { GovernoratePicker } from "./GovernoratePicker";
import { SubmitButton } from "./SubmitButton";
import { Combobox } from "./Combobox";

function Field({ label, name, defaultValue, type = "text", req }: any) {
  return (
    <div>
      <label className="label">{label}{req && <span className="text-red-600"> *</span>}</label>
      <input className="input" name={name} type={type} defaultValue={defaultValue ?? ""} required={!!req}  autoComplete="off" />
    </div>
  );
}
function Select({ label, name, options, defaultValue, req }: any) {
  const opts = Object.entries(options).map(([value, label]: any) => ({ value, label }));
  return <Combobox name={name} label={label} options={opts} defaultValue={defaultValue ?? ""} allowFree={false} required={!!req} />;
}
function LookupSelect({ label, name, items, defaultValue, req }: any) {
  const opts = items.map((i: any) => ({ value: String(i.id), label: i.name }));
  return <Combobox name={name} label={label} options={opts} defaultValue={defaultValue != null ? String(defaultValue) : ""} allowFree={false} required={!!req} />;
}

export function PatientForm({
  action, patient, governorates = [], injuryTypes = [], centers = [], formations = [], ranks = [], employees = [], branches = [], mobilityAids = [], prostheticTypes = [], defaultBranchId,
}: {
  action: (fd: FormData) => void; patient?: any;
  governorates?: any[]; injuryTypes?: any[]; centers?: any[]; formations?: any[]; ranks?: any[]; employees?: any[]; branches?: any[]; mobilityAids?: any[]; prostheticTypes?: any[];
  defaultBranchId?: number | null;
}) {
  const p = patient ?? {};
  const branchValue = p.branchId ?? defaultBranchId ?? null;
  return (
    <form action={action} className="space-y-6" autoComplete="off">
      <section className="card p-5">
        <h2 className="mb-4 font-semibold text-gray-700">البيانات الشخصية</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Field label="الاسم الرباعي" name="fullName" defaultValue={p.fullName} req />
          <div>
            <label className="label">صورة المريض</label>
            <div className="flex items-center gap-2">
              {p.photoUrl && <img src={p.photoUrl} alt="" className="h-10 w-10 rounded-full object-cover" />}
              <input className="input" name="photo" type="file" accept="image/*"  autoComplete="off" />
            </div>
          </div>
          <Field label="اسم الأم" name="motherName" defaultValue={p.motherName} />
          <Select label="الجنس" name="gender" options={GENDER} defaultValue={p.gender} req />
          <div>
            <label className="label">التولد <span className="text-red-600">*</span></label>
            <input className="input" name="birthDate" type="date" defaultValue={p.birthDate ? new Date(p.birthDate).toISOString().slice(0, 10) : ""} required  autoComplete="off" />
          </div>
          <Field label="رقم الهاتف" name="phone" defaultValue={p.phone} req />
          <Select label="الحالة الزوجية" name="maritalStatus" options={MARITAL} defaultValue={p.maritalStatus} />
          <Field label="عدد الأطفال" name="childrenCount" type="number" defaultValue={p.childrenCount} />
          <Field label="عدد الزوجات" name="wivesCount" type="number" defaultValue={p.wivesCount} />
          <Combobox name="kinshipDegree" label="درجة القرابة" options={Object.values(KINSHIP) as string[]} defaultValue={p.kinshipDegree ?? ""} />
          <GovernoratePicker governorates={governorates} govId={p.governorateId} distId={p.districtId} />
          {branches.length > 0 && <LookupSelect label="الفرع" name="branchId" items={branches} defaultValue={branchValue} />}
          <Field label="التحصيل الدراسي" name="education" defaultValue={p.education} />
          <Combobox name="housing" label="السكن" options={["ملك", "إيجار"]} defaultValue={p.housing ?? ""} />
          <div>
            <label className="label">مدخل البيانات</label>
            <input className="input bg-gray-50 text-gray-500" value={p.dataEntryBy ?? "يُسجَّل تلقائياً باسم المستخدم الحالي"} disabled readOnly />
          </div>
        </div>
      </section>

      <section className="card p-5">
        <h2 className="mb-4 font-semibold text-gray-700">الإصابة والإحالة</h2>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Combobox name="rank" label="الصفة" options={ranks.map((r: any) => r.name)} defaultValue={p.rank ?? ""} />
          <Combobox name="formationText" label="التشكيل" allowFree options={formations.map((x: any) => x.name)} defaultValue={p.formationText ?? p.formation?.name ?? ""} />
          <Combobox name="militaryStatus" label="موقف الدائرة" options={["عسكري", "مدني"]} defaultValue={p.militaryStatus ?? ""} />
          <Combobox name="inMobilization" label="ضمن الحشد" allowFree={false} options={[{ value: "1", label: "نعم" }, { value: "0", label: "لا" }]} defaultValue={p.inMobilization === true ? "1" : p.inMobilization === false ? "0" : ""} />
          <Field label="نسبة العجز %" name="disabilityPct" type="number" defaultValue={p.disabilityPct} />
          <Select label="نوع الحالة" name="caseType" options={CASE_TYPE} defaultValue={p.caseType} req />
          <Combobox name="receivesSalary" label="يستلم راتب" allowFree={false} options={[{ value: "1", label: "نعم" }, { value: "0", label: "لا" }]} defaultValue={p.receivesSalary === true ? "1" : p.receivesSalary === false ? "0" : ""} />
          <LookupSelect label="نوع الإصابة" name="injuryTypeId" items={injuryTypes} defaultValue={p.injuryTypeId} req />
          <Field label="سبب الإصابة" name="injuryCause" defaultValue={p.injuryCause} />
          <div>
            <label className="label">تاريخ الإصابة</label>
            <input className="input" name="injuryDate" type="date" defaultValue={p.injuryDate ? new Date(p.injuryDate).toISOString().slice(0, 10) : ""}  autoComplete="off" />
          </div>
          <Field label="الحركة" name="mobility" defaultValue={p.mobility} />
          <Combobox name="mobilityAid" label="مساعد الحركة" allowFree options={mobilityAids.map((x: any) => x.name)} defaultValue={p.mobilityAid ?? ""} placeholder="اكتب أو اختر (كرسي كهرباء...)" />
          <Combobox name="prosthetic" label="طرف صناعي" allowFree options={prostheticTypes.map((x: any) => x.name)} defaultValue={p.prosthetic ?? ""} placeholder="اكتب أو اختر (طرف سفلي...)" />
          <Combobox name="referredToCenter" label="المركز المُحال له" options={centers.map((c: any) => c.name)} defaultValue={p.referredToCenter ?? ""} />
          <Select label="الحالة" name="status" options={PATIENT_STATUS} defaultValue={p.status} />
        </div>
        <div className="mt-4">
          <label className="label">ملاحظات</label>
          <textarea className="input" name="notes" rows={3} defaultValue={p.notes ?? ""} />
        </div>
      </section>

      <div className="flex gap-3">
        <SubmitButton>حفظ</SubmitButton>
      </div>
    </form>
  );
}
