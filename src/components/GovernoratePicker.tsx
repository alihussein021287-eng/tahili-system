"use client";
import { useState } from "react";
import { Combobox } from "./Combobox";

type Gov = { id: number; name: string; districts: { id: number; name: string }[] };

export function GovernoratePicker({
  governorates, govId, distId,
}: { governorates: Gov[]; govId?: number | null; distId?: number | null }) {
  const [selected, setSelected] = useState<number | "">(govId ?? "");
  const districts = governorates.find((g) => g.id === selected)?.districts ?? [];

  return (
    <>
      <Combobox
        name="governorateId"
        label="المحافظة"
        required
        allowFree={false}
        options={governorates.map((g) => ({ value: String(g.id), label: g.name }))}
        defaultValue={govId != null ? String(govId) : ""}
        onValueChange={(v) => setSelected(v ? Number(v) : "")}
      />
      <Combobox
        key={selected}
        name="districtId"
        label="المنطقة"
        allowFree={false}
        options={districts.map((d) => ({ value: String(d.id), label: d.name }))}
        defaultValue={distId != null ? String(distId) : ""}
      />
    </>
  );
}
