const DAY_MS = 86_400_000;

export function positiveInt(value: FormDataEntryValue | null, label: string, max = 3650) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > max) throw new Error(`${label} يجب أن يكون رقماً صحيحاً موجباً`);
  return parsed;
}

export function recoveryPercent(value: FormDataEntryValue | null) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100) throw new Error("نسبة الشفاء أو التحسن يجب أن تكون بين 0 و100");
  return parsed;
}

export function expectedTreatmentEnd(start: Date, treatmentDays: number) {
  const end = new Date(start);
  end.setHours(23, 59, 59, 999);
  end.setDate(end.getDate() + treatmentDays - 1);
  return end;
}

export function boundedSessionDates(start: Date, end: Date, weekdays: number[], count: number, time: string) {
  const [hours, minutes] = time.split(":").map(Number);
  const dates: Date[] = [];
  const cursor = new Date(start);
  cursor.setHours(0, 0, 0, 0);
  while (dates.length < count && cursor.getTime() <= end.getTime()) {
    if (weekdays.includes(cursor.getDay())) {
      const date = new Date(cursor);
      date.setHours(hours, minutes, 0, 0);
      if (date <= end) dates.push(date);
    }
    cursor.setTime(cursor.getTime() + DAY_MS);
  }
  if (dates.length !== count) throw new Error("عدد الجلسات وأيام الأسبوع لا يتسعان ضمن مدة الخطة. عدّل عدد الأيام أو الجلسات");
  return dates;
}

export function evaluationDue(plan: { startDate: Date | null; reviewEverySessions: number | null; reviewEveryDays: number | null; periodicEvaluations: { evaluatedAt: Date }[]; sessions: { actualSessions: number | null }[] }, now = new Date()) {
  const completed = plan.sessions[0]?.actualSessions || 0;
  const last = plan.periodicEvaluations.at(-1)?.evaluatedAt || plan.startDate;
  if (!last) return false;
  const sessionDue = Boolean(plan.reviewEverySessions && completed >= plan.reviewEverySessions * (plan.periodicEvaluations.length + 1));
  const dayDue = Boolean(plan.reviewEveryDays && now.getTime() - last.getTime() >= plan.reviewEveryDays * DAY_MS);
  return sessionDue || dayDue;
}
