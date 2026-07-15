"use client";

import { useRouter } from "next/navigation";

type AdminTab = {
  key: string;
  label: string;
  href: string;
};

export function AdminTabSelect({ tabs, active, label = "اختيار تبويب الصفحة" }: { tabs: AdminTab[]; active: string; label?: string }) {
  const router = useRouter();
  const activeHref = tabs.find((tab) => tab.key === active)?.href ?? tabs[0]?.href ?? "";

  return (
    <label className="block md:hidden">
      <span className="sr-only">{label}</span>
      <select className="input" value={activeHref} onChange={(event) => router.push(event.target.value)}>
        {tabs.map((tab) => (
          <option key={tab.key} value={tab.href}>
            {tab.label}
          </option>
        ))}
      </select>
    </label>
  );
}
