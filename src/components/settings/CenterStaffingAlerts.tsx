import type { RequiredStaffingRole } from "@/lib/center-staffing";

const MISSING_ROLE_LABELS: Record<RequiredStaffingRole, string> = {
  SECRETARY: "لا سكرتارية",
  RESIDENT: "لا طبيب مقيم",
  DOCTOR: "لا اختصاص",
  HEAD_THERAPIST: "لا رئيس معالجين",
};

export function CenterStaffingAlerts({
  gaps,
}: {
  gaps: readonly { centerId: number; centerName: string; missingRoles: readonly RequiredStaffingRole[] }[];
}) {
  const incomplete = gaps.filter((center) => center.missingRoles.length > 0);
  if (incomplete.length === 0) return null;

  return (
    <div className="space-y-2" aria-label="نواقص ملاك المراكز">
      {incomplete.map((center) => (
        <div key={center.centerId} role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-100">
          <p className="font-semibold break-words">{center.centerName}</p>
          <ul className="mt-2 flex flex-wrap gap-2" aria-label={`نواقص ${center.centerName}`}>
            {center.missingRoles.map((role) => (
              <li key={role} className="rounded-md bg-amber-100 px-2 py-1 dark:bg-amber-900/60">{MISSING_ROLE_LABELS[role]}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
