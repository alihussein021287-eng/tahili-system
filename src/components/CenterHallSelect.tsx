"use client";

import { useEffect, useMemo, useState } from "react";
import type { CenterHallOption } from "@/lib/center-halls";

type Center = { id: number; name: string };

export function CenterHallSelect({
  centers,
  halls,
  centerFieldName = "centerId",
  hallFieldName = "hallId",
  hallValue = "id",
  defaultCenterId = "",
  defaultHallValue = "",
  centerLabel = "المركز",
  hallLabel = "الفرع/القاعة",
  centerPlaceholder = "اختر المركز",
  hallPlaceholder = "اختر الفرع/القاعة",
  requiredCenter = true,
  requiredHall = false,
  className = "grid gap-3 md:grid-cols-2",
}: {
  centers: Center[];
  halls: CenterHallOption[];
  centerFieldName?: string;
  hallFieldName?: string;
  hallValue?: "id" | "name";
  defaultCenterId?: string | number | null;
  defaultHallValue?: string | number | null;
  centerLabel?: string;
  hallLabel?: string;
  centerPlaceholder?: string;
  hallPlaceholder?: string;
  requiredCenter?: boolean;
  requiredHall?: boolean;
  className?: string;
}) {
  const [centerId, setCenterId] = useState(defaultCenterId ? String(defaultCenterId) : "");
  const [selectedHall, setSelectedHall] = useState(defaultHallValue ? String(defaultHallValue) : "");
  const filtered = useMemo(
    () => halls.filter((hall) => String(hall.centerId) === centerId && hall.active && hall.status === "AVAILABLE"),
    [centerId, halls],
  );

  useEffect(() => {
    if (!selectedHall) return;
    const valid = filtered.some((hall) => String(hallValue === "id" ? hall.hallId : hall.hallName) === selectedHall);
    if (!valid) setSelectedHall("");
  }, [filtered, hallValue, selectedHall]);

  return (
    <div className={className}>
      <label className="label">
        {centerLabel}
        <select
          name={centerFieldName}
          className="input mt-1"
          value={centerId}
          required={requiredCenter}
          onChange={(event) => setCenterId(event.target.value)}
        >
          <option value="">{centerPlaceholder}</option>
          {centers.map((center) => (
            <option key={center.id} value={center.id}>{center.name}</option>
          ))}
        </select>
      </label>
      <label className="label">
        {hallLabel}
        <select
          name={hallFieldName}
          className="input mt-1"
          value={selectedHall}
          required={requiredHall}
          disabled={!centerId}
          onChange={(event) => setSelectedHall(event.target.value)}
        >
          <option value="">{hallPlaceholder}</option>
          {filtered.map((hall) => (
            <option key={`${hall.centerId}-${hall.resourceId}`} value={hallValue === "id" ? hall.hallId : hall.hallName}>
              {hall.hallName}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
