import { prisma } from "@/lib/db";
import { getOrg } from "@/lib/org";
import { notFound } from "next/navigation";
import Link from "next/link";
import { fmtDate, numToArabicWords } from "@/lib/labels";
import { PrintButton } from "@/components/PrintButton";
import { requirePerm } from "@/lib/access";
import { refCode } from "@/lib/refcode";

export const dynamic = "force-dynamic";

export default async function OfficialSickLeave({ params }: { params: Promise<{ id: string; lid: string }> }) {
  await requirePerm("sickleave.view");
  const { id, lid } = await params;
  const [org, patient, leave, setting] = await Promise.all([
    getOrg(),
    prisma.patient.findUnique({ where: { id }, include: { governorate: true, injuryType: true, formation: true } }),
    prisma.sickLeave.findUnique({ where: { id: lid } }),
    prisma.orgSetting.findUnique({ where: { id: 1 } }),
  ]);
  if (!patient || !leave || leave.patientId !== id) notFound();
  const approval = await prisma.reportApproval.findUnique({ where: { kind_refKey: { kind: "sick-leave", refKey: lid } } });
  const approverIds = [leave.approved1ById, leave.approved2ById, leave.approved3ById].filter(Boolean) as string[];
  const approvers = approverIds.length ? await prisma.user.findMany({ where: { id: { in: approverIds } }, select: { id: true, fullName: true } }) : [];
  const approverName = (uid?: string | null) => approvers.find((u) => u.id === uid)?.fullName;

  // حساب الإجازات السابقة (قبل هذه) — تلقائياً من السجل
  const prior = await prisma.sickLeave.findMany({
    where: { patientId: id, createdAt: { lt: leave.createdAt } },
    select: { days: true },
  });
  const priorCount = prior.length;
  const priorDays = prior.reduce((sum, x) => sum + (x.days || 0), 0);

  // البرنامج العلاجي — من آخر جلسة مجدولة
  const session = await prisma.therapySession.findFirst({
    where: { patientId: id, weekdays: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { totalSessions: true, weekdays: true },
  });
  const perWeek = session?.weekdays ? session.weekdays.split(",").filter(Boolean).length : null;

  const code = refCode(patient as any);
  const s: any = setting || {};

  // قيم افتراضية للترويسة (تُعدّل من الإعدادات)
  const h1 = s.officialHeader1 || "هيئة الحشد الشعبي";
  const h2 = s.officialHeader2 || "المديرية العامة للسلامة والعلاقات والخدمات الاجتماعية";
  const h3 = s.officialHeader3 || "مديرية الحماية الاجتماعية والرعاية الصحية";
  const h4 = s.officialHeader4 || org.name;
  const motto = s.officialMotto || "\"قضاء عمر الإنسان لإرضاء الله سبحانه وتعالى يكون في خدمة الناس\"";
  const mottoSub = s.officialMottoSub || "(الشهيد القائد أبو مهدي المهندس)";
  const address = s.officialAddress || "بغداد – الاعظمية – قصر السجود";
  const phone = s.officialPhone || "";
  const toOffice = s.officialToOffice || "مكتب مدير مديرية الحماية الاجتماعية والرعاية الصحية";

  const directorate = leave.directorate || patient.formation?.name || "";
  const empty = "\u00A0\u00A0";

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <style>{`
        @media print {
          @page { size: A4; margin: 8mm; }
          html, body { height: auto; }
          #report, #report * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          #report { padding: 0 !important; line-height: 1.6 !important; font-size: 12px !important; }
          #report .official-body p { margin: 2px 0 !important; line-height: 1.9 !important; }
          #report img { width: 78px !important; height: 78px !important; }
          #report .committee-block { margin-top: 14px !important; }
          #report .committee-block .sig-gap { height: 28px !important; }
          #report .sig-block { margin-top: 10px !important; }
          #report .motto-block { margin: 8px 0 6px !important; }
          #report .director-block { margin-top: 14px !important; }
          #report .director-block .dsp { margin-top: 18px !important; }
        }
      `}</style>
      <div className="flex items-center justify-between print:hidden">
        <Link href={`/patients/${id}`} className="btn-ghost">↩ رجوع</Link>
        <PrintButton />
      </div>

      <div className="card bg-white p-8 text-black print:border-0 print:shadow-none" id="report" style={{ lineHeight: 1.9 }}>
        {/* الترويسة */}
        <div className="flex items-start justify-between">
          <div className="min-w-[130px] text-[13px] leading-[2.2]">
            العدد : {leave.officialNumber || empty} /&nbsp;&nbsp;/&nbsp;&nbsp;<br />
            التاريخ : {leave.officialDate ? fmtDate(leave.officialDate) : `${empty}/${empty}/${empty}`}
          </div>
          <div className="flex-1 text-center font-bold leading-[1.9]">
            <div className="text-base">{h1}</div>
            <div className="text-[13.5px]">{h2}</div>
            <div className="text-[13.5px]">{h3}</div>
            <div className="text-[13.5px]">{h4}</div>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/official/hashd-logo.png" alt="شعار" className="h-24 w-24 shrink-0" />
        </div>

        <div className="motto-block mt-4 mb-2 text-center text-[13.5px] font-bold">
          {motto}
          <div className="text-[11.5px] font-normal text-gray-700">{mottoSub}</div>
        </div>

        <div className="mt-3 text-center text-[14.5px] font-bold">الى / {toOffice}</div>
        <div className="text-center text-[14.5px] font-bold">م / إجازة مرضية</div>
        <div className="my-2 text-center text-sm">تحية طيبة ....</div>

        {/* المتن — وسط */}
        <div className="official-body text-center text-sm" style={{ lineHeight: 2.4 }}>
          <p>إشارة الى كتاب الإرسال ذي العدد ( {leave.sendBookNumber || empty} ) في ( {leave.sendBookDate || `${empty}/${empty}/${empty}`} ) الصادر من ( {leave.sendBookFrom || empty} )</p>
          <p>منح المجاهد ( <b className="border-b border-dotted border-gray-500 px-1">{patient.fullName}</b> ) المنسوب الى هيئة الحشد الشعبي / مديرية <b className="border-b border-dotted border-gray-500 px-6">{directorate || "\u00A0\u00A0\u00A0\u00A0"}</b></p>
          <p>إجازة مرضية مدتها <b className="border-b border-dotted border-gray-500 px-1">{leave.days}</b> ... رقماً ( <b className="border-b border-dotted border-gray-500 px-1">{leave.days}</b> ) .. كتابة ( <b className="border-b border-dotted border-gray-500 px-1">{numToArabicWords(leave.days)}</b> ) يراجع خلالها وبعدها لغرض اكمال برنامجه العلاجي .</p>
          <p>تبدأ من تاريخ ( <b className="border-b border-dotted border-gray-500 px-1">{fmtDate(leave.startDate)}</b> ) ولغاية ( <b className="border-b border-dotted border-gray-500 px-1">{fmtDate(leave.endDate)}</b> )</p>
          <p>بسبب معاناته من ( <b className="border-b border-dotted border-gray-500 px-1">{leave.diagnosisText}</b> )</p>
          <p>علماً ان عدد الاجازات المرضية الممنوحه له سابقاً ( <b className="border-b border-dotted border-gray-500 px-1">{priorCount}</b> ) اجازة وعدد مجموع أيام الاجازات السابقة ( <b className="border-b border-dotted border-gray-500 px-1">{priorDays}</b> ) يوم</p>
          <p>وخصص له برنامج علاجي مكون من ( <b className="border-b border-dotted border-gray-500 px-1">{session?.totalSessions ?? empty}</b> ) جلسات بواقع ( <b className="border-b border-dotted border-gray-500 px-1">{perWeek ?? empty}</b> ) جلسة في الأسبوع</p>
        </div>

        <div className="sig-block mt-4 text-center text-sm">توقيع الطبيب الاختصاص المعالج ( د. <b>{leave.doctorName || empty}</b> / اختصاص {leave.doctorSpecialty || empty} )</div>
        <div className="text-center text-sm">مصادقة اللجنة الطبية المختصة .....</div>

        {/* اللجنة: رئيس + عضوين */}
        <div className="committee-block mt-6 flex justify-around gap-4 text-center text-[13px]">
          {[
            { role: "رئيس اللجنة", name: leave.committee1, at: leave.approved1At, by: approverName(leave.approved1ById) },
            { role: "عضواً", name: leave.committee2, at: leave.approved2At, by: approverName(leave.approved2ById) },
            { role: "عضواً", name: leave.committee3, at: leave.approved3At, by: approverName(leave.approved3ById) },
          ].filter((c) => c.name).map((c, i) => (
            <div key={i} className="flex-1">
              <div className="role font-bold">{c.role}</div>
              <div className="sig-gap" style={{ height: "38px" }}></div>
              <div className="font-bold">د. {c.name}</div>
              {c.at ? <><div className="text-[11px] text-emerald-700">✔ صادق إلكترونياً</div><div className="text-[11.5px] text-gray-600">{fmtDate(c.at)}</div></> : <div className="text-[11px] text-gray-400">/ &nbsp;/ 2026</div>}
              {c.at && c.by && <div className="text-[10.5px] text-gray-500">بواسطة {c.by}</div>}
            </div>
          ))}
        </div>

        <div className="mt-5 text-center text-[13px]">علماً ان عدد الاجازات السابقة ( <b className="border-b border-dotted border-gray-500 px-1">{priorCount}</b> ) ومجموع عدد أيام الاجازات السابقة ( <b className="border-b border-dotted border-gray-500 px-1">{priorDays}</b> )</div>
        <div className="mt-3 text-center text-sm font-bold">لاتخاذ ما يلزم واعلامنا مع التقدير..</div>

        <div className="director-block mt-6 w-52 text-center text-sm font-bold">
          مدير المجمع
          {approval ? <div className="dsp mt-5 text-[12px] font-normal text-emerald-700">معتمد إلكترونياً: {approval.approvedBy}{approval.title ? ` - ${approval.title}` : ""}<br />{fmtDate(approval.approvedAt)}</div> : <div className="dsp mt-7 text-[13px] font-normal">{empty}/{empty}/{empty}</div>}
        </div>

        <div className="mt-2 flex items-start justify-between">
          <div className="text-[11px] text-gray-700">
            <div className="font-bold underline">صورة منه الى ..</div>
            <div>-المركز المعالج .. للحفظ في اضبارة المريض مع التقدير</div>
            <div>-وحدة الوثائق والأرشفة الإلكترونية .. للحفظ مع التقدير</div>
          </div>
          <div className="text-xs">
            <div className="font-bold underline">المرافقات</div>
            <div>-كتاب الإرسال المرقم ( {empty} )</div>
            <div>- الأوليات</div>
          </div>
        </div>

        <div className="mt-4 border-t border-gray-400 pt-2 text-center text-[11px] text-gray-600">
          العنوان : {address}{phone ? `\u00A0\u00A0\u00A0 هاتف : ${phone}` : ""}
        </div>
      </div>
    </div>
  );
}
