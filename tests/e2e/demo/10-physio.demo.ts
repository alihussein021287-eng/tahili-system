// Physical therapy path, start to finish, for the six «physio» patients:
// reception → (data entry) → centre secretary → resident → specialist → referral → head therapist
// → programme → therapist sessions → final evaluation → back to the specialist.
import { test } from "@playwright/test";
import { DEMO_PATIENTS, CENTER } from "../../../scripts/dev-demo/people";
import { act, as, cred, done, journey, rememberPatient } from "./helpers";
import {
  acceptHandoff, addDiagnosis, checkIn, completeData, createProgram, expectHolder, finalizeProgram, finishHandoff,
  internalReferral, recordTodaySession, referralButton, registerPatient, rescheduleFromFile, residentReview, sendHandoff,
} from "./flows";

const physio = DEMO_PATIENTS.filter((patient) => patient.scenario === "physio");
const AREA = "مسار العلاج الطبيعي";

test.describe.configure({ mode: "serial" });

for (const [index, patient] of physio.entries()) {
  test(`${AREA}: ${patient.fullName}`, async ({ browser }) => {
    const reception = index % 2 ? "reception2" : "reception1";
    const doctor = index % 3 === 2 ? "doctor3" : "doctor1";
    const therapist = index % 2 ? "therapist2" : "therapist1";
    const suggest = index % 2 === 0; // half the referrals carry the doctor's suggested therapist
    const finish = index < 3; // the first three walk to the very end; the rest stay mid-programme
    let patientId = "";

    await journey(async () => {
      let page = await as(browser, reception, AREA);
      await act(page, AREA, "تسجيل المراجع بالاستقبال", async () => { patientId = await registerPatient(page, patient); });
      rememberPatient(patient.fullName, { id: patientId, scenario: patient.scenario });
      await act(page, AREA, "تسجيل حضور اليوم", () => checkIn(page, patient.fullName), "متوسط").catch(() => undefined);
      if (index % 2 === 0) {
        await act(page, AREA, "تحويل لإدخال البيانات", () => sendHandoff(page, patientId, { role: "DATA_ENTRY", note: "إكمال بيانات المراجع" }));
        await done(page);
        page = await as(browser, "dataentry1", AREA);
        await act(page, AREA, "إدخال البيانات يستلم", () => acceptHandoff(page, patientId));
        await act(page, AREA, "إكمال البيانات", () => completeData(page, patientId), "متوسط").catch(() => undefined);
        await act(page, AREA, "تحويل لسكرتارية المركز", () => sendHandoff(page, patientId, { center: CENTER.physio, role: "SECRETARY" }));
      } else {
        await act(page, AREA, "تحويل لسكرتارية المركز", () => sendHandoff(page, patientId, { center: CENTER.physio, role: "SECRETARY" }));
      }
      await expectHolder(page, patientId, "سكرتارية", AREA);
      await done(page);

      page = await as(browser, "secretary1", AREA);
      await act(page, AREA, "السكرتارية تستلم", () => acceptHandoff(page, patientId));
      await act(page, AREA, "تحويل للطبيب المقيم", () => sendHandoff(page, patientId, { center: CENTER.physio, role: "RESIDENT", person: cred("resident1").fullName }));
      await done(page);

      page = await as(browser, "resident1", AREA);
      await act(page, AREA, "المقيم يستلم", () => acceptHandoff(page, patientId));
      await act(page, AREA, "تقييم المقيم والعلامات الحيوية", () => residentReview(page, patientId));
      await act(page, AREA, "تحويل لطبيب الاختصاص", () => sendHandoff(page, patientId, { center: CENTER.physio, role: "DOCTOR", person: cred(doctor).fullName }));
      await done(page);

      page = await as(browser, doctor, AREA);
      await act(page, AREA, "الاختصاص يستلم", () => acceptHandoff(page, patientId));
      await act(page, AREA, "تشخيص الاختصاص", () => addDiagnosis(page, patientId, "ضعف عضلي بالطرف السفلي بعد الإصابة — يحتاج تأهيل حركي"));
      let referralId = "";
      await act(page, AREA, "إحالة داخلية لمركز العلاج الطبيعي", async () => {
        referralId = await internalReferral(page, patientId, { center: CENTER.physio, service: "برنامج علاج طبيعي", therapist: suggest ? cred(therapist).fullName : undefined });
      });
      rememberPatient(patient.fullName, { referralId });
      await act(page, AREA, "تحويل لرئيس المعالجين", () => sendHandoff(page, patientId, { center: CENTER.physio, role: "HEAD_THERAPIST" }));
      await done(page);

      page = await as(browser, "headtherapist1", AREA);
      await act(page, AREA, "رئيس المعالجين يستلم", () => acceptHandoff(page, patientId));
      await act(page, AREA, "قبول الإحالة الداخلية", () => referralButton(page, referralId, "قبول الإحالة الداخلية"));
      await act(page, AREA, "إنشاء البرنامج وجدولة الجلسات", () => createProgram(page, patientId, { center: CENTER.physio,
        therapist: suggest ? undefined : cred(therapist).fullName, expectSuggested: suggest ? cred(therapist).fullName : undefined,
        doctor: cred(doctor).fullName, hall: index % 2 ? "قاعة العلاج المائي" : "قاعة العلاج الميكانيكي", sessions: finish ? 1 : 10, time: `${String(8 + index).padStart(2, "0")}:00`,
      }));
      await expectHolder(page, patientId, cred(therapist).fullName, AREA);
      if (!finish) await act(page, AREA, "رئيس المعالجين ينقل الجلسة الثالثة", () => rescheduleFromFile(page, patientId, 3, 5 + index, `${String(12 + index).padStart(2, "0")}:30`), "متوسط").catch(() => undefined);
      await done(page);

      page = await as(browser, therapist, AREA);
      await act(page, AREA, "المعالج يستلم", () => acceptHandoff(page, patientId), "متوسط").catch(() => undefined);
      await act(page, AREA, "المعالج يسجل جلسة اليوم", () => recordTodaySession(page, patient.fullName));
      await done(page);
      if (!finish) return;

      page = await as(browser, "headtherapist1", AREA);
      await act(page, AREA, "التقييم النهائي وإنهاء البرنامج", () => finalizeProgram(page, patientId));
      await expectHolder(page, patientId, cred(doctor).fullName, AREA);
      await done(page);

      page = await as(browser, doctor, AREA);
      await act(page, AREA, "الاختصاص يستلم بعد البرنامج", () => acceptHandoff(page, patientId));
      await act(page, AREA, "الاختصاص ينهي المتابعة", () => finishHandoff(page, patientId));
      await done(page);
    });
  });
}
