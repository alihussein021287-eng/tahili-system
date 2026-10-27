/** Signed-form dates are calendar dates in the institution's Baghdad timezone. */
export function consentCalendarDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en", { timeZone: "Asia/Baghdad", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const value = (type: string) => parts.find(p => p.type === type)!.value;
  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function parseConsentSignedDate(value: string, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error("تاريخ التوقيع غير صالح");
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value || value > consentCalendarDate(now)) throw new Error("تاريخ التوقيع غير صالح أو مستقبلي");
  // UTC midnight is only the stored representation of that calendar date.
  return date;
}
