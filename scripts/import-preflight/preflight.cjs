#!/usr/bin/env node
/**
 * Excel import PREFLIGHT (read-only). Mission 08.8.
 *
 * Reads spreadsheet files from --input-dir (never writes there, never touches a database) and produces, in --out-dir:
 *   preflight-summary.json / .md  sanitized aggregate counts (no personal data) — safe to share with the owner
 *   disposition-ledger.csv        one line per source row: file/sheet/row/kind/disposition/reasons (no personal data)
 *   exceptions.csv                held rows with the actionable missing fields (no personal data)
 *   import-plan.json              PROTECTED: normalized READY records (contains personal data) + stable source keys
 *
 * Policies enforced (owner decisions 2026-10): single destination branch; no fabricated dates; repeated phone numbers never prove
 * identity; exact duplicate snapshots are separated from distinct people; ambiguous rows are HELD, never dropped; appointments,
 * sessions and Excel stock are excluded; accounts are only PROPOSED (created inactive later, after approval).
 *
 *   node scripts/import-preflight/preflight.cjs --input-dir <dir> --out-dir <dir> --branch-name "<canonical branch name>"
 *        [--role-map role-map.csv] [--center-map center-map.csv]
 *   role-map.csv:   family,sourceJob,role      (family = employees|residents|specialists; role = UserRole or NONE)
 *   center-map.csv: sourceCenter,centerName
 */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { readWorkbook, sha256, normName, cleanName, normPhone, normYear } = require("./lib.cjs");
const MAP = require("./mappings.json");

const nrm = (s) => normName(s);

function loadCsvMap(file, cols) {
  if (!file || !fs.existsSync(file)) return new Map();
  const lines = fs.readFileSync(file, "utf8").replace(/^﻿/, "").split(/\r?\n/).filter((l) => l.trim());
  const out = new Map();
  for (const line of lines.slice(1)) {
    const c = line.split(",").map((x) => x.trim().replace(/^"|"$/g, ""));
    out.set(cols.slice(0, -1).map((_, i) => nrm(c[i])).join("|"), c[cols.length - 1]);
  }
  return out;
}

function mapHeaders(headerRow) {
  const index = {};
  const unmapped = [];
  headerRow.forEach((h, i) => {
    const n = nrm(h);
    if (!n) return;
    const field = Object.entries(MAP.fields).find(([, aliases]) => aliases.some((a) => nrm(a) === n))?.[0];
    if (field && index[field] === undefined) index[field] = i; else unmapped.push(cleanName(h));
  });
  return { index, unmapped };
}

function familyOfFile(file) {
  const n = nrm(path.basename(file));
  for (const [family, tokens] of Object.entries(MAP.fileFamilies)) if (tokens.some((t) => n.includes(nrm(t)))) return family;
  return null;
}
function snapshotFamilyKey(file) {
  return nrm(path.basename(file).replace(/\.[^.]+$/, "").replace(/\(\s*\d+\s*\)/g, "").replace(/[0-9]{4}[-_.][0-9]{2}[-_.][0-9]{2}/g, "").replace(/[-_ ]+$/, ""));
}
function snapshotDate(file) { const m = path.basename(file).match(/([0-9]{4})[-_.]([0-9]{2})[-_.]([0-9]{2})/); return m ? `${m[1]}-${m[2]}-${m[3]}` : ""; }
function copyNumber(file) { const m = path.basename(file).match(/\(\s*(\d+)\s*\)/); return m ? Number(m[1]) : 0; }

function run(argv = process.argv.slice(2)) {
  const flag = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
  const explicitFiles = argv.flatMap((a, i) => (a === "--file" ? [argv[i + 1]] : []));
  const inputDir = flag("input-dir") || (explicitFiles.length ? "(explicit files)" : undefined);
  const outDir = flag("out-dir");
  const branchName = flag("branch-name") || "";
  if (!inputDir || !outDir) throw new Error("--input-dir (or explicit --file ...) and --out-dir are required");
  // Explicit --file paths are read exactly as given (nothing else in their folder is listed or opened); --input-dir scans one folder.
  const files = explicitFiles.length
    ? explicitFiles.map((f) => path.resolve(f))
    : fs.readdirSync(inputDir).filter((f) => /\.(xls|xlsx|xlsm|html?)$/i.test(f) && !f.startsWith("~$")).sort().map((f) => path.join(inputDir, f));
  for (const f of files) if (path.resolve(outDir) === path.dirname(f)) throw new Error("out-dir must differ from the folder of the input files (inputs are read-only)");
  const roleMap = loadCsvMap(flag("role-map"), ["family", "sourceJob", "role"]);
  const centerMap = loadCsvMap(flag("center-map"), ["sourceCenter", "centerName"]);

  const ledger = []; // {file, sheet, row, kind, disposition, reasons, ref}
  const exceptions = [];
  const plan = { patients: [], employees: [], accounts: [] };
  const summary = { generatedAt: new Date().toISOString(), branchPolicy: { approvedBranchName: branchName }, files: [], totals: {}, dispositions: {}, unmappedHeaders: {}, unresolved: { roles: [], centers: [] }, notes: [] };
  const add = (e) => { ledger.push(e); if (/^HELD/.test(e.disposition)) exceptions.push(e); };
  const workbooks = files.map((f) => readWorkbook(f));

  // ---- snapshot families (patients export) ----
  const byFamily = new Map();
  for (const wb of workbooks) {
    const key = snapshotFamilyKey(wb.file);
    if (!byFamily.has(key)) byFamily.set(key, []);
    byFamily.get(key).push(wb);
  }
  const canonical = new Map(); // wb -> role in family
  for (const [, group] of byFamily) {
    const sorted = [...group].sort((a, b) => (snapshotDate(b.file).localeCompare(snapshotDate(a.file))) || (copyNumber(a.file) - copyNumber(b.file)));
    group.forEach((wb) => canonical.set(wb, wb === sorted[0] ? "CANONICAL" : (wb.sha256 === sorted[0].sha256 ? "IDENTICAL_COPY" : "OTHER_SNAPSHOT")));
    sorted[0]._canonicalOf = sorted;
  }

  const signatureOf = (cells, idx) => ["fileNumber", "fullName", "birth", "phone"].map((k) => (idx[k] === undefined ? "" : nrm(cells[idx[k]]))).join("|");
  const canonicalSignatures = new Map(); // family key -> Set(signatures)

  const classifySheet = (wb, sheet) => {
    if (MAP.excludedSheets.some((n) => nrm(n) === nrm(sheet.name))) return "EXCLUDED";
    if (MAP.patientSheetNames.some((n) => nrm(n) === nrm(sheet.name))) return "PATIENTS";
    if (MAP.systemUserSheetNames.some((n) => nrm(n) === nrm(sheet.name))) return "SYSTEM_USERS";
    const fam = familyOfFile(wb.file);
    if (fam) return fam.toUpperCase();
    return "UNCLASSIFIED";
  };

  // process canonical files first so secondary snapshots can be compared
  const ordered = [...workbooks].sort((a, b) => (canonical.get(a) === "CANONICAL" ? 0 : 1) - (canonical.get(b) === "CANONICAL" ? 0 : 1));
  const patientKeysSeen = new Map();   // strong key -> ledger ref
  const phoneOwners = new Map();       // phone -> Set(normName)
  const weakGroups = new Map();        // normName|phone -> [{ref, year}]
  const staffNames = new Map();        // family|normName -> [{ref, sig}]
  const accountUsernames = new Map();
  const patientRows = [];

  for (const wb of ordered) {
    const role = canonical.get(wb);
    const fileInfo = { file: path.basename(wb.file), format: wb.format, bytes: wb.bytes, sha256: wb.sha256.slice(0, 16), snapshotRole: role, sheets: [] };
    if (wb.unreadable) { fileInfo.unreadable = wb.unreadable; summary.files.push(fileInfo); continue; }
    for (const sheet of wb.sheets) {
      const kind = classifySheet(wb, sheet);
      const headerRowIdx = sheet.rows.findIndex((r) => r.some((c) => cleanName(c)));
      const header = headerRowIdx >= 0 ? sheet.rows[headerRowIdx] : [];
      const { index: idx, unmapped } = mapHeaders(header);
      const dataRows = sheet.rows.slice(headerRowIdx + 1);
      fileInfo.sheets.push({ name: sheet.name, kind, rows: dataRows.length, headersMapped: Object.keys(idx), headersUnmapped: unmapped.length });
      if (unmapped.length) summary.unmappedHeaders[`${path.basename(wb.file)}::${sheet.name}`] = unmapped;
      const src = { file: path.basename(wb.file), sheet: sheet.name };
      dataRows.forEach((cells, i) => {
        const rowNo = headerRowIdx + 2 + i;
        const base = { ...src, row: rowNo, kind };
        const get = (k) => (idx[k] === undefined ? "" : cleanName(cells[idx[k]] ?? ""));
        if (role === "IDENTICAL_COPY") return add({ ...base, disposition: "EXACT_DUPLICATE_FILE", reasons: "SAME_SHA256_AS_CANONICAL_SNAPSHOT" });
        if (!cells.some((c) => cleanName(c))) return add({ ...base, disposition: "EMPTY_ROW", reasons: "BLANK" });
        if (kind === "EXCLUDED") return add({ ...base, disposition: "EXCLUDED_BY_POLICY", reasons: "APPOINTMENTS_SESSIONS_STOCK_AND_OTHER_OPERATIONAL_SHEETS" });
        if (kind === "UNCLASSIFIED") return add({ ...base, disposition: "HELD_UNCLASSIFIED_SHEET", reasons: "SHEET_NOT_RECOGNIZED", need: "owner must classify this sheet" });

        if (kind === "PATIENTS") {
          const sig = signatureOf(cells, idx);
          const key = snapshotFamilyKey(wb.file);
          if (role === "OTHER_SNAPSHOT") {
            const known = canonicalSignatures.get(key);
            if (known && known.has(sig)) return add({ ...base, disposition: "EXACT_DUPLICATE_SNAPSHOT_ROW", reasons: "IDENTICAL_ROW_IN_CANONICAL_SNAPSHOT" });
            return add({ ...base, disposition: "HELD_SNAPSHOT_ONLY_ROW", reasons: "ROW_ABSENT_OR_CHANGED_IN_CANONICAL_SNAPSHOT", need: "owner decides which snapshot version is correct" });
          }
          if (!canonicalSignatures.has(key)) canonicalSignatures.set(key, new Set());
          canonicalSignatures.get(key).add(sig);
          const name = get("fullName"), phone = normPhone(get("phone")), year = normYear(get("birth"));
          const missing = [];
          if (nrm(name).replace(/\s/g, "").length < 3) return add({ ...base, disposition: "HELD_INVALID_NAME", reasons: "NAME_MISSING_OR_TOO_SHORT", need: "fullName" });
          if (!phone.valid) return add({ ...base, disposition: "HELD_INVALID_PHONE", reasons: "PHONE_NOT_A_VALID_IRAQI_MOBILE", need: "phone (07xxxxxxxxx) or empty" });
          if (!year.valid) return add({ ...base, disposition: "HELD_INVALID_YEAR", reasons: "BIRTH_YEAR_OR_DATE_UNREADABLE_OR_OUT_OF_RANGE", need: "birth year or empty" });
          const reasons = [];
          if (phone.empty) reasons.push("NO_PHONE");
          if (year.empty) reasons.push("NO_BIRTH_YEAR(not fabricated)");
          const n = nrm(name);
          const ref = `${src.file}#${src.sheet}#${rowNo}`;
          const strong = phone.value && year.value ? `${n}|${phone.value}|${year.value}` : null;
          if (strong && patientKeysSeen.has(strong)) return add({ ...base, disposition: "DUPLICATE_IN_SOURCE", reasons: "SAME_NAME_PHONE_BIRTHYEAR", ref: patientKeysSeen.get(strong) });
          if (strong) patientKeysSeen.set(strong, ref);
          if (phone.value) { if (!phoneOwners.has(phone.value)) phoneOwners.set(phone.value, new Set()); phoneOwners.get(phone.value).add(n); }
          const weakKey = `${n}|${phone.value ?? ""}`;
          if (!weakGroups.has(weakKey)) weakGroups.set(weakKey, []);
          weakGroups.get(weakKey).push({ ref, year: year.value, base });
          patientRows.push({ ref, base, name, phone: phone.value, year: year.value, fileNumber: get("fileNumber"), reasons, gender: get("gender"), governorate: get("governorate"), injuryType: get("injuryType"), status: get("status"), motherName: get("motherName"), n, wb });
          return undefined;
        }

        if (kind === "SYSTEM_USERS") {
          const name = get("fullName"), username = get("username"), roleName = get("role").toUpperCase();
          if (!username) return add({ ...base, disposition: "HELD_MISSING_USERNAME", reasons: "NO_USERNAME", need: "username" });
          if (nrm(name).length < 3) return add({ ...base, disposition: "HELD_INVALID_NAME", reasons: "NAME_MISSING_OR_TOO_SHORT", need: "fullName" });
          if (!MAP.userRoles.includes(roleName)) return add({ ...base, disposition: "HELD_UNRESOLVED_ROLE", reasons: "ROLE_NOT_A_TAHILI_ROLE", need: "role mapping" });
          if (MAP.privilegedRolesHeld.includes(roleName)) return add({ ...base, disposition: "HELD_PRIVILEGED_ROLE", reasons: "ADMIN_ACCOUNTS_NEED_EXPLICIT_OWNER_APPROVAL", need: "owner approval" });
          const u = username.toLowerCase();
          if (accountUsernames.has(u)) return add({ ...base, disposition: "HELD_DUPLICATE_USERNAME", reasons: "USERNAME_REPEATED", ref: accountUsernames.get(u), need: "unique username" });
          accountUsernames.set(u, `${src.file}#${src.sheet}#${rowNo}`);
          plan.accounts.push({ sourceKey: `${wb.sha256.slice(0, 12)}:${src.sheet}:${rowNo}`, username: u, fullName: name, role: roleName, sourceActive: /^(نعم|true|yes|1)$/i.test(get("active")), origin: "SYSTEM_EXPORT" });
          return add({ ...base, disposition: "READY_STAGED_ACCOUNT", reasons: "CREATED_INACTIVE_UNTIL_OWNER_ACTIVATES" });
        }

        // staff families
        const family = kind.toLowerCase();
        const name = get("fullName");
        if (nrm(name).replace(/\s/g, "").length < 3) return add({ ...base, disposition: "HELD_INVALID_NAME", reasons: "NAME_MISSING_OR_TOO_SHORT", need: "fullName" });
        const job = get("job"), specialty = get("specialty"), center = get("center"), phone = normPhone(get("phone"));
        if (!phone.valid) return add({ ...base, disposition: "HELD_INVALID_PHONE", reasons: "PHONE_NOT_A_VALID_IRAQI_MOBILE", need: "phone or empty" });
        const reasons = [];
        const centerKey = nrm(center);
        let centerName = null;
        if (centerKey) {
          centerName = centerMap.get(centerKey) ?? null;
          if (!centerName) { reasons.push("CENTER_UNMAPPED"); if (!summary.unresolved.centers.includes(center)) summary.unresolved.centers.push(center); }
        }
        const roleKey = `${nrm(family)}|${nrm(job)}`;
        const mappedRole = job ? roleMap.get(roleKey) : roleMap.get(`${nrm(family)}|`);
        if (!mappedRole && !reasons.includes("ROLE_UNMAPPED")) { reasons.push("ROLE_UNMAPPED"); const label = `${family}:${job || "(no job title)"}`; if (!summary.unresolved.roles.includes(label)) summary.unresolved.roles.push(label); }
        const ref = `${src.file}#${src.sheet}#${rowNo}`;
        const sig = [nrm(name), nrm(job), nrm(specialty), centerKey, phone.value ?? ""].join("|");
        const gk = `${family}|${nrm(name)}`;
        if (!staffNames.has(gk)) staffNames.set(gk, []);
        staffNames.get(gk).push({ ref, sig, base });
        plan.employees.push({ sourceKey: `${wb.sha256.slice(0, 12)}:${src.sheet}:${rowNo}`, ref, family, fullName: name, job, specialty, capacity: get("capacity"), serial: get("serial"), center, centerName, phone: phone.value, role: mappedRole && mappedRole !== "NONE" ? mappedRole : null, reasons });
        return undefined;
      });
    }
    summary.files.push(fileInfo);
  }

  // ---- patient post-pass: identity adjudication (name+phone+birthYear only; phone alone proves nothing) ----
  for (const [wk, rows] of weakGroups) {
    const strongYears = new Set(rows.filter((r) => r.year).map((r) => r.year));
    const noYear = rows.filter((r) => !r.year);
    const isAmbiguous = rows.length > 1 && (noYear.length > 0 && rows.length > 1);
    for (const r of rows) {
      const pr = patientRows.find((p) => p.ref === r.ref);
      if (!pr) continue;
      if (isAmbiguous) { pr.held = "HELD_AMBIGUOUS_IDENTITY"; pr.heldReason = strongYears.size ? "SAME_NAME_AND_PHONE_WITH_MISSING_BIRTH_YEAR" : "SAME_NAME_AND_PHONE_WITHOUT_BIRTH_YEAR"; }
    }
  }
  // same normalized name, no phone, no year -> ambiguous
  const nameOnly = new Map();
  for (const p of patientRows) if (!p.phone && !p.year) { if (!nameOnly.has(p.n)) nameOnly.set(p.n, []); nameOnly.get(p.n).push(p); }
  for (const [, rows] of nameOnly) if (rows.length > 1) for (const p of rows) { p.held = "HELD_AMBIGUOUS_IDENTITY"; p.heldReason = "SAME_NAME_WITHOUT_ANY_OTHER_IDENTIFIER"; }
  // source file-number integrity: a number must identify exactly one person
  const byFileNo = new Map();
  for (const p of patientRows) if (p.fileNumber) { if (!byFileNo.has(p.fileNumber)) byFileNo.set(p.fileNumber, []); byFileNo.get(p.fileNumber).push(p); }
  for (const [, rows] of byFileNo) if (rows.length > 1) for (const p of rows) if (!p.held) { p.held = "HELD_FILE_NUMBER_CONFLICT"; p.heldReason = "SAME_SOURCE_FILE_NUMBER_ON_SEVERAL_ROWS"; }
  for (const p of patientRows) {
    if (p.held) { add({ ...p.base, disposition: p.held, reasons: p.heldReason, need: "reliable identity evidence (phone or birth year) or owner decision" }); continue; }
    const shared = p.phone && phoneOwners.get(p.phone) && phoneOwners.get(p.phone).size > 1;
    const reasons = [...p.reasons, ...(shared ? ["SHARED_PHONE_NOT_AN_IDENTITY_PROOF"] : [])];
    add({ ...p.base, disposition: reasons.length ? "READY_WITH_WARNING" : "READY", reasons: reasons.join(";") });
    plan.patients.push({ sourceKey: `${p.wb.sha256.slice(0, 12)}:${p.base.sheet}:${p.base.row}`, sourceFileNumber: p.fileNumber || null, fullName: p.name, phone: p.phone, birthYear: p.year, motherName: p.motherName || null, gender: p.gender || null, governorate: p.governorate || null, injuryType: p.injuryType || null, sourceStatus: p.status || null });
  }

  // ---- staff post-pass ----
  for (const [, rows] of staffNames) {
    const distinct = new Set(rows.map((r) => r.sig));
    if (rows.length > 1) {
      for (const r of rows) {
        const e = plan.employees.find((x) => x.ref === r.ref);
        if (distinct.size === 1) { if (r !== rows[0]) { e.drop = true; add({ ...r.base, disposition: "DUPLICATE_IN_SOURCE", reasons: "IDENTICAL_STAFF_ROW", ref: rows[0].ref }); continue; } }
        else { e.drop = true; add({ ...r.base, disposition: "HELD_AMBIGUOUS_IDENTITY", reasons: "SAME_NAME_DIFFERENT_DETAILS_NOT_PROVEN_SAME_PERSON", need: "owner confirms whether these are one person or two" }); continue; }
      }
    }
  }
  plan.employees = plan.employees.filter((e) => !e.drop);
  for (const e of plan.employees) {
    const base = { file: e.ref.split("#")[0], sheet: e.ref.split("#")[1], row: Number(e.ref.split("#")[2]), kind: e.family.toUpperCase() };
    const unresolved = e.reasons.filter((r) => r.endsWith("UNMAPPED"));
    // personnel records stay valid WITHOUT a login; accounts need a verified role mapping + username supplied by the owner
    add({ ...base, disposition: unresolved.length ? "READY_PERSONNEL_RECORD_ONLY" : "READY_PERSONNEL_RECORD_ONLY", reasons: ["NO_LOGIN_ACCOUNT_UNTIL_APPROVED", ...unresolved].join(";") });
  }

  // ---- accounting ----
  const totals = {};
  const sheetsRows = {};
  for (const l of ledger) { summary.dispositions[l.disposition] = (summary.dispositions[l.disposition] ?? 0) + 1; totals[l.kind] = (totals[l.kind] ?? 0) + 1; }
  for (const f of summary.files) for (const s of f.sheets) sheetsRows[s.kind] = (sheetsRows[s.kind] ?? 0) + s.rows;
  const rowsRead = summary.files.reduce((n, f) => n + f.sheets.reduce((m, s) => m + s.rows, 0), 0);
  summary.totals = { sourceRowsRead: rowsRead, ledgerLines: ledger.length, accountingBalanced: rowsRead === ledger.length, rowsByKind: sheetsRows, ledgerByKind: totals };
  const d = summary.dispositions;
  const sum = (...k) => k.reduce((n, x) => n + (d[x] ?? 0), 0);
  summary.counts = {
    patientSourceRowsAllFiles: sheetsRows.PATIENTS ?? 0,
    patientRowsInCanonicalSnapshot: ledger.filter((l) => l.kind === "PATIENTS" && !["EXACT_DUPLICATE_FILE", "EXACT_DUPLICATE_SNAPSHOT_ROW", "HELD_SNAPSHOT_ONLY_ROW"].includes(l.disposition)).length,
    patientRowsAfterExactDuplicateRemoval: sum("READY", "READY_WITH_WARNING") + ledger.filter((l) => l.kind === "PATIENTS" && /^HELD_/.test(l.disposition) && l.disposition !== "HELD_SNAPSHOT_ONLY_ROW").length,
    patientRowsReady: sum("READY", "READY_WITH_WARNING"),
    patientRowsHeld: Object.entries(d).filter(([k]) => /^HELD_/.test(k) && ledger.some((l) => l.disposition === k && l.kind === "PATIENTS")).reduce((n, [k]) => n + ledger.filter((l) => l.disposition === k && l.kind === "PATIENTS").length, 0),
    exactDuplicateFileRows: sum("EXACT_DUPLICATE_FILE"),
    exactDuplicateSnapshotRows: sum("EXACT_DUPLICATE_SNAPSHOT_ROW"),
    duplicateInSourceRows: sum("DUPLICATE_IN_SOURCE"),
    systemUserRows: sheetsRows.SYSTEM_USERS ?? 0,
    employeeRows: sheetsRows.EMPLOYEES ?? 0,
    residentRows: sheetsRows.RESIDENTS ?? 0,
    specialistRows: sheetsRows.SPECIALISTS ?? 0,
    stagedAccounts: plan.accounts.length,
    personnelRecordsReady: plan.employees.length,
    excludedByPolicyRows: sum("EXCLUDED_BY_POLICY"),
    emptyRows: sum("EMPTY_ROW"),
  };
  const branchHeaders = summary.files.flatMap((f) => f.sheets.filter((s) => s.headersMapped.includes("branch")).map((s) => `${f.file}::${s.name}`));
  summary.branchPolicy.sourceHasBranchColumn = branchHeaders.length > 0;
  summary.branchPolicy.note = branchHeaders.length ? "source carries a branch column: validate it equals the approved branch before import" : "source carries no branch column: the single-branch policy rests on the owner decision, not on file evidence";

  // ---- sanitized analysis (aggregates only) ----
  const num = (arr) => arr.filter((x) => /^[0-9]+$/.test(String(x))).map(Number);
  const fns = patientRows.map((p) => p.fileNumber).filter(Boolean);
  const fnN = num(fns);
  const count = (arr) => arr.reduce((m, k) => (m[k] = (m[k] || 0) + 1, m), {});
  const personnelNames = new Map();
  for (const e of plan.employees) { const k = nrm(e.fullName); personnelNames.set(k, (personnelNames.get(k) || 0) + 1); }
  // account -> personnel link only on an EXACT unique name match; everything else is left for the owner (names alone are not identity)
  for (const a of plan.accounts) { const hits = plan.employees.filter((e) => nrm(e.fullName) === nrm(a.fullName)); a.personnelSourceKey = hits.length === 1 ? hits[0].sourceKey : null; }
  summary.analysis = {
    patients: {
      sourceFileNumbers: { present: fns.length, unique: new Set(fns).size, numeric: fnN.length, min: fnN.length ? Math.min(...fnN) : null, max: fnN.length ? Math.max(...fnN) : null, gapsInRange: fnN.length ? Math.max(...fnN) - Math.min(...fnN) + 1 - new Set(fnN).size : 0 },
      missingOptional: { phone: patientRows.filter((p) => !p.phone).length, birthYear: patientRows.filter((p) => !p.year).length, gender: patientRows.filter((p) => !p.gender).length, governorate: patientRows.filter((p) => !p.governorate).length, injuryType: patientRows.filter((p) => !p.injuryType).length },
      birthPrecision: patientRows.every((p) => p.year) ? "YEAR_ONLY (no full date of birth in the source; none is fabricated)" : "MIXED",
      sharedPhoneGroups: [...phoneOwners.values()].filter((v) => v.size > 1).length,
      distinctGovernorates: Object.keys(count(patientRows.map((p) => p.governorate).filter(Boolean))).length,
      distinctInjuryTypes: Object.keys(count(patientRows.map((p) => p.injuryType).filter(Boolean))).length,
      referenceValues: { governorates: Object.keys(count(patientRows.map((p) => p.governorate).filter(Boolean))), injuryTypes: Object.keys(count(patientRows.map((p) => p.injuryType).filter(Boolean))) },
    },
    accounts: {
      proposed: plan.accounts.length,
      byRole: count(plan.accounts.map((a) => a.role)),
      exactNameMatchWithPersonnelRecord: plan.accounts.filter((a) => personnelNames.get(nrm(a.fullName)) === 1).length,
      noPersonnelMatch: plan.accounts.filter((a) => !personnelNames.has(nrm(a.fullName))).length,
      ambiguousPersonnelMatch: plan.accounts.filter((a) => (personnelNames.get(nrm(a.fullName)) || 0) > 1).length,
    },
    personnel: { byFamily: count(plan.employees.map((e) => e.family)), distinctDepartments: Object.keys(count(plan.employees.map((e) => e.center).filter(Boolean))).length, distinctJobs: Object.keys(count(plan.employees.map((e) => e.job).filter(Boolean))).length },
  };
  fs.mkdirSync(outDir, { recursive: true });
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = (rows, cols) => "﻿" + [cols.join(","), ...rows.map((r) => cols.map((c) => q(r[c])).join(","))].join("\n") + "\n";
  fs.writeFileSync(path.join(outDir, "disposition-ledger.csv"), csv(ledger, ["file", "sheet", "row", "kind", "disposition", "reasons", "ref"]));
  fs.writeFileSync(path.join(outDir, "exceptions.csv"), csv(exceptions, ["file", "sheet", "row", "kind", "disposition", "reasons", "need", "ref"]));
  const planBody = { destinationBranchName: branchName, ...plan }; // no timestamps: identical inputs give an identical plan hash (repeatable dry runs)
  const planText = JSON.stringify(planBody, null, 1);
  fs.writeFileSync(path.join(outDir, "import-plan.json"), planText);
  summary.planSha256 = sha256(Buffer.from(planText));
  summary.files = summary.files.map((f) => ({ ...f }));
  fs.writeFileSync(path.join(outDir, "preflight-summary.json"), JSON.stringify(summary, null, 2));
  const md = [`# Import preflight summary (sanitized — no personal data)`, ``, `Generated: ${summary.generatedAt}`, `Approved destination branch (owner): ${branchName || "(not given)"}`, `Branch evidence: ${summary.branchPolicy.note}`, ``, `## Accounting`, `Source rows read: ${summary.totals.sourceRowsRead}; ledger lines: ${summary.totals.ledgerLines}; balanced: ${summary.totals.accountingBalanced}`, ``, `## Counts`, ...Object.entries(summary.counts).map(([k, v]) => `- ${k}: ${v}`), ``, `## Dispositions`, ...Object.entries(summary.dispositions).sort().map(([k, v]) => `- ${k}: ${v}`), ``, `## Files`, ...summary.files.map((f) => `- ${f.file} [${f.format}] ${f.unreadable ? "UNREADABLE: " + f.unreadable : f.sheets.map((s) => `${s.name}=${s.kind}:${s.rows}`).join(", ")}`), ``, `## Unresolved mappings`, `- Roles: ${summary.unresolved.roles.length ? summary.unresolved.roles.join("; ") : "none"}`, `- Centers: ${summary.unresolved.centers.length ? summary.unresolved.centers.join("; ") : "none"}`].join("\n");
  fs.writeFileSync(path.join(outDir, "preflight-summary.md"), md + "\n");
  return summary;
}

if (require.main === module) {
  try {
    const s = run();
    console.log(JSON.stringify({ ok: true, balanced: s.totals.accountingBalanced, counts: s.counts }, null, 2));
  } catch (e) { console.error(`ERROR: ${e.message}`); process.exitCode = 1; }
}
module.exports = { run };
