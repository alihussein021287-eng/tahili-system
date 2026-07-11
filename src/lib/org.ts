import { prisma } from "@/lib/db";

export async function getOrg() {
  let o: any = null;
  try { o = await prisma.orgSetting.findUnique({ where: { id: 1 } }); } catch {}
  return {
    name: o?.name || "المجمع التأهيلي الطبي",
    subtitle: o?.subtitle || "",
    address: o?.address || "",
    phone: o?.phone || "",
    logoUrl: o?.logoUrl || "",
    officialHeader1: o?.officialHeader1 || "",
    officialHeader2: o?.officialHeader2 || "",
    officialHeader3: o?.officialHeader3 || "",
    officialHeader4: o?.officialHeader4 || "",
    officialAddress: o?.officialAddress || "",
    officialPhone: o?.officialPhone || "",
    officialMotto: o?.officialMotto || "",
    officialMottoSub: o?.officialMottoSub || "",
  };
}
