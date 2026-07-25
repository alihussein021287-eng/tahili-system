#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");

function walk(dir, predicate, result = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file, predicate, result);
    else if (predicate(file)) result.push(file);
  }
  return result.sort();
}

function source(file) {
  return fs.readFileSync(file, "utf8");
}

function routeFromFile(file, suffix) {
  let route = path.relative(path.join(ROOT, "src/app"), file).replaceAll(path.sep, "/");
  route = route.slice(0, -suffix.length).replace(/\/page$/, "").replace(/\/route$/, "");
  route = route.split("/").filter((part) => !/^\(.+\)$/.test(part)).join("/");
  return `/${route}`.replace(/\/+$/, "") || "/";
}

const moduleRules = [
  [/^\/(patients|patients-care|visits|queue|appointments|referrals|care-board|station-kpis|search)/, ["المرضى والرعاية", "/patients-care"]],
  [/^\/(therapy|therapy-centers|centers|beds|meds|workload)/, ["العلاج والمراكز", "/therapy-centers"]],
  [/^\/(pharmacy|pharmacy-inventory|inventory)/, ["الصيدلية والمخزون", "/pharmacy-inventory"]],
  [/^\/(finance|reports|reports-finance|official-docs|approvals|analytics)/, ["التقارير والمالية", "/reports-finance"]],
  [/^\/(staff|tasks|attendance|shifts|users)/, ["الموظفون والإدارة", "/staff"]],
  [/^\/(settings|permissions|audit|login-log|backup|maintenance|readiness)/, ["النظام", "/settings"]],
  [/^\/collaboration/, ["التعاون", "/collaboration"]],
  [/^\/notifications/, ["التنبيهات", "/notifications"]],
  [/^\/(my-work|workspaces)?$/, ["العمل اليومي", "/"]],
  [/^\/(login|setup|account)/, ["الوصول والحساب", "مستقلة"]],
  [/^\/(display|portal)/, ["واجهات مستقلة", "مستقلة"]],
];

const legacyRoutes = {
  "/attendance": "/staff?tab=attendance",
  "/shifts": "/staff?tab=shifts|leaves",
  "/tasks": "/staff?tab=tasks",
};

const printPattern = /\/(qr|receipt|voucher|official|card|care-print|journey-print|medical-report\/\[reportId\]|report|sick-leave)(\/|$)/;
const medicalPattern = /\/(patients|visits|queue|referrals|care-board|beds|meds)(\/|$)/;
const therapyPattern = /\/(therapy|therapy-centers|centers|workload)(\/|$)/;
const financePattern = /\/(finance|reports-finance|approvals)(\/|$)/;
const securityPattern = /\/(permissions|users|settings|audit|backup|maintenance|readiness|login-log)(\/|$)/;

function moduleFor(route) {
  return moduleRules.find(([pattern]) => pattern.test(route))?.[1] ?? ["أخرى", "مستقلة"];
}

function tabFor(route, hub) {
  if (legacyRoutes[route]) return legacyRoutes[route].split("tab=")[1] ?? "-";
  if (route === hub) return "من query `tab`";
  const leaf = route.split("/").filter(Boolean).at(-1);
  return hub === "مستقلة" || route.includes("[") ? "-" : leaf ?? "-";
}

function categoryFor(route) {
  if (printPattern.test(route)) return "طباعة";
  if (medicalPattern.test(route)) return "طبية";
  if (therapyPattern.test(route)) return "علاجية";
  if (financePattern.test(route)) return "مالية";
  if (securityPattern.test(route)) return "إدارية حساسة";
  if (/\/(collaboration|notifications|my-work|workspaces|display)/.test(route)) return "تشغيلية";
  return "إدارية";
}

function classificationFor(route) {
  const tags = [];
  if (legacyRoutes[route]) tags.push("🔁", "🧭");
  if (printPattern.test(route)) tags.push("🖨️");
  if (securityPattern.test(route)) tags.push("🔒");
  if (financePattern.test(route) || medicalPattern.test(route) || therapyPattern.test(route)) tags.push("⚠️");
  else tags.push("✅");
  return [...new Set(tags)].join(" ");
}

function riskFor(route) {
  if (financePattern.test(route) || /\/(referrals|therapy|beds|pharmacy|approvals)/.test(route)) return "عال";
  if (medicalPattern.test(route) || securityPattern.test(route) || route.includes("[token]")) return "متوسط";
  return "منخفض";
}

function immovableFor(route) {
  if (financePattern.test(route)) return "المبالغ، الموافقات، القيود، الحالات وServer Actions";
  if (/\/referrals/.test(route)) return "آلة حالات الإحالة، الأدوار، المستندات والانتقالات";
  if (/\/(therapy|centers|beds)/.test(route)) return "الخطة والجلسة والعضوية والرقود وانتقالاتها";
  if (/\/(patients|visits|queue|care-board|meds)/.test(route)) return "الحقول الطبية والسجل السريري وحالات الرعاية";
  if (/\/pharmacy/.test(route)) return "قواعد الأهلية والمخزون وFEFO والصرف الذري";
  if (securityPattern.test(route)) return "الصلاحيات، المصادقة، التدقيق والنسخ";
  return "السلوك والroute والـdeep links والصلاحيات القائمة";
}

function quotedMatches(text, regex) {
  return [...text.matchAll(regex)].map((match) => match[1]);
}

const appFiles = walk(path.join(ROOT, "src/app"), (file) => /\.(ts|tsx)$/.test(file));
const pageFiles = appFiles.filter((file) => file.endsWith("/page.tsx"));
const routeFiles = appFiles.filter((file) => file.endsWith("/route.ts"));
const actionFiles = appFiles.filter((file) => file.endsWith("/actions.ts") || file.endsWith("-actions.ts"));
const componentFiles = walk(path.join(ROOT, "src/components"), (file) => file.endsWith(".tsx"));
const libFiles = walk(path.join(ROOT, "src/lib"), (file) => file.endsWith(".ts"));
const testFiles = walk(path.join(ROOT, "tests"), (file) => /\.(test|spec)\.ts$/.test(file));

const schema = source(path.join(ROOT, "prisma/schema.prisma"));
const models = quotedMatches(schema, /^model\s+(\w+)/gm);
const enums = quotedMatches(schema, /^enum\s+(\w+)/gm);
const permissionsSource = source(path.join(ROOT, "src/lib/perms.ts"));
const permissions = [...new Set(quotedMatches(permissionsSource, /key:\s*"([^"]+)"/g))].sort();
const rolesSource = source(path.join(ROOT, "src/lib/permissions.ts"));
const roles = [...new Set(quotedMatches(rolesSource, /^\s{2}([A-Z_]+):\s*"/gm))].sort();

const actionExports = actionFiles.flatMap((file) => {
  const text = source(file);
  return [...text.matchAll(/export\s+(?:async\s+)?function\s+(\w+)/g)].map((match) => ({
    name: match[1],
    file: path.relative(ROOT, file),
  }));
});

const pages = pageFiles.map((file) => {
  const text = source(file);
  const route = routeFromFile(file, ".tsx");
  const [module, hub] = moduleFor(route);
  const prismaModels = [...new Set(
    [...text.matchAll(/prisma\.(\w+)/g)].map((match) => match[1]),
  )].sort();
  const pagePermissions = permissions.filter((permission) => text.includes(`"${permission}"`) || text.includes(`'${permission}'`));
  const importedActions = [...new Set([
    ...[...text.matchAll(/import\s*\{([^}]+)\}\s*from\s*["'][^"']*actions["']/gs)]
      .flatMap((match) => match[1].split(",").map((item) => item.trim().split(/\s+as\s+/)[0]).filter(Boolean)),
    ...[...text.matchAll(/action=\{(\w+)/g)].map((match) => match[1]),
  ])].sort();
  const legacy = legacyRoutes[route] ?? "-";
  const responsive = /(?:sm|md|lg|xl):|overflow-x|grid-cols|flex-wrap/.test(text) ? "نعم" : "ضمن الغلاف/تحقق";
  const designSystem = /PageHeader|AdminPageSections|Card|Tabs|className="(?:card|input|btn-|table)/.test(text) ? "مشترك/جزئي" : "خاص";
  const empty = /لا توجد|لا يوجد|empty|length\s*===\s*0|\.length\s*\?/.test(text) ? "موجودة" : "ضمنية/تحتاج تحقق";
  const loading = route.startsWith("/login") ? "محلي" : "`(app)/loading.tsx`";
  const error = route.startsWith("/login") || route.startsWith("/display") || route.startsWith("/portal")
    ? "`app/error.tsx`"
    : "`app/error.tsx` + not-found";
  const dark = "يرث theme؛ راجع الألوان الخاصة";
  const permissionText = pagePermissions.length ? pagePermissions.slice(0, 5).join(", ") : "حراسة server/session أو route parent";
  const dataText = prismaModels.length ? prismaModels.slice(0, 6).join(", ") : "lib/API/props أو بلا بيانات";
  const actionText = importedActions.length ? importedActions.slice(0, 6).join(", ") : "قراءة فقط/route handler";
  return {
    route,
    file: path.relative(ROOT, file),
    module,
    permission: permissionText,
    hub,
    tab: tabFor(route, hub),
    dataSource: dataText,
    actions: actionText,
    category: categoryFor(route),
    classification: classificationFor(route),
    uiPolicy: "يمكن تعديل العرض فقط مع مقارنة السلوك",
    immovable: immovableFor(route),
    legacy,
    duplication: legacy !== "-" || (hub !== "مستقلة" && route !== hub) ? "يعرض أيضاً عبر hub/تبويب؛ لا تحذف route" : "-",
    responsive,
    designSystem,
    theme: dark,
    states: `${empty}; ${loading}; ${error}`,
    risk: riskFor(route),
  };
}).sort((a, b) => a.route.localeCompare(b.route));

const summary = {
  generatedFrom: "repository source only",
  pages: pages.length,
  layouts: appFiles.filter((file) => file.endsWith("/layout.tsx")).length,
  loadingFiles: appFiles.filter((file) => file.endsWith("/loading.tsx")).length,
  errorFiles: appFiles.filter((file) => file.endsWith("/error.tsx")).length,
  notFoundFiles: appFiles.filter((file) => file.endsWith("/not-found.tsx")).length,
  apiRoutes: routeFiles.length,
  actionFiles: actionFiles.length,
  exportedServerActions: actionExports.length,
  componentFiles: componentFiles.length,
  libFiles: libFiles.length,
  prismaModels: models.length,
  prismaEnums: enums.length,
  permissions: permissions.length,
  roles: roles.length,
  tests: testFiles.length,
  migrations: fs.readdirSync(path.join(ROOT, "prisma/migrations"), { withFileTypes: true }).filter((entry) => entry.isDirectory()).length,
  unclassifiedPages: pages.filter((page) => !page.classification || !page.module || !page.risk).length,
};

const output = { summary, roles, permissions, models, enums, actions: actionExports, pages };

if (process.argv.includes("--markdown")) {
  console.log("# UI Information Architecture");
  console.log("");
  console.log("هذا الملف مولد من الكود بواسطة `node scripts/audit-project.mjs --markdown`. لا يحتوي بيانات تشغيلية.");
  console.log("");
  console.log("## Summary");
  console.log("");
  for (const [key, value] of Object.entries(summary)) console.log(`- ${key}: ${value}`);
  console.log("");
  console.log("## Page Classification");
  console.log("");
  console.log("| route | الوحدة | الصلاحية | hub/tab | البيانات / Actions | النوع والحكم | حدود التعديل | legacy/تكرار | العرض والثيم والحالات | الخطر |");
  console.log("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const page of pages) {
    const clean = (value) => String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
    console.log(`| \`${page.route}\` | ${clean(page.module)} | ${clean(page.permission)} | ${clean(page.hub)} / ${clean(page.tab)} | ${clean(page.dataSource)}; ${clean(page.actions)} | ${clean(page.category)} ${page.classification} | ${clean(page.uiPolicy)}؛ **ممنوع:** ${clean(page.immovable)} | ${clean(page.legacy)}؛ ${clean(page.duplication)} | responsive: ${clean(page.responsive)}؛ DS: ${clean(page.designSystem)}؛ ${clean(page.theme)}؛ ${clean(page.states)} | ${page.risk} |`);
  }
} else {
  console.log(JSON.stringify(output, null, 2));
}

if (summary.unclassifiedPages !== 0) process.exitCode = 2;
