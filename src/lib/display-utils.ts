export const BAGHDAD_TIMEZONE = "Asia/Baghdad";

export function baghdadDayRange(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BAGHDAD_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(now);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const start = new Date(Date.UTC(value("year"), value("month") - 1, value("day"), -3));
  return { start, end: new Date(start.getTime() + 86_400_000) };
}

export function maskDisplayName(fullName: string, mode: "FULL" | "INITIALS" | "QUEUE_NUMBER", queueNumber: number) {
  if (mode === "QUEUE_NUMBER") return `رقم الانتظار ${queueNumber}`;
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (mode === "FULL" || parts.length < 2) return parts.join(" ");
  return `${parts[0]} ${parts.slice(1).map((part) => `${part[0]}.`).join(" ")}`;
}
