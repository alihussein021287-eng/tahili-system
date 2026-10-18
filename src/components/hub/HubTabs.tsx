import { AdminSectionTabs } from "@/components/AdminPageSections";
import { visibleHubTabs, type HubNavItem } from "@/lib/hub-nav";

/** The section's tab bar, shown on every page of the section so it reads as one place. */
export function HubTabs({ nav, active, label, perms }: { nav: readonly HubNavItem[]; active: string; label: string; perms: ReadonlySet<string> }) {
  const tabs = visibleHubTabs(nav, perms);
  if (tabs.length < 2) return null;
  return <AdminSectionTabs tabs={tabs} active={active} label={label} />;
}
