// Actual ProgramPage markup + final-image CSS; only session/data transport and
// unrelated framework children are replaced. No authenticated browser UAT claim.
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process'), vm = require('node:vm');
const ts = require('typescript'), React = require('react'), { renderToStaticMarkup } = require('react-dom/server'), { chromium } = require('playwright');
const out = path.resolve(process.argv[2]);
const sourcePath = 'src/app/(app)/centers/[slug]/programs/[id]/page.tsx';
async function render(source) {
  const program = { id: 'synthetic', centerId: 1, patientId: 'synthetic', status: 'ACTIVE', operationalCompletedAt: null, medicalClosedAt: null,
    operationalCompletionId: null, serviceType: 'PSYCHOLOGICAL', mode: 'INDIVIDUAL', patient: { fullName: 'SYNTHETIC' }, assignedTo: { fullName: 'SYNTHETIC' }, sessions: [], assessments: [] };
  const mods = {
    '@/components/patients/ClinicalReviewControls': { ClinicalReviewControls: () => null },
    '@/lib/access': { requireSession: async () => ({ user: { role: 'HEAD_THERAPIST' } }), currentPerms: async () => new Set(['centers.view', 'centers.programs.manage', 'centers.programs.finalize']) },
    'next/navigation': { notFound() { throw Error('Missing synthetic page'); } },
    'next/link': { __esModule: true, default: p => React.createElement('a', { href: p.href, className: p.className }, p.children) },
    '@/lib/db': { prisma: { centerProgram: { findFirst: async () => program }, centerResource: { findMany: async () => [] } } },
    '@/components/PageHeader': { PageHeader: () => null }, '@/lib/center-access': { centerActor: async () => {} },
    '@/lib/center-workspaces': { CENTER_SPACES: { psychological: {} }, resolveCenter: async () => ({ config: { title: 'SYNTHETIC' }, center: { id: 1 } }), SERVICE_LABELS: { PSYCHOLOGICAL: 'SYNTHETIC' } },
    '../../../actions': { finalizeCenterProgram: async () => {}, scheduleCenterSessionWithFeedback: async () => {} },
    '@/components/FeedbackForm': { FeedbackForm: p => React.createElement('form', { className: p.className }, p.children) }, '@/lib/labels': { fmtDateTime: () => '' },
  };
  const exports = {};
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  vm.runInNewContext(js, { exports, require: n => {
    if (n === 'react/jsx-runtime') return require(n);
    if (!(n in mods)) throw Error('Unexpected import: ' + n);
    return mods[n];
  }, Date, Set });
  return renderToStaticMarkup(await exports.default({ params: Promise.resolve({ slug: 'psychological', id: 'synthetic' }) }));
}
(async () => {
  const css = fs.readFileSync(path.join(out, 'ACTIVE_FINAL.css'), 'utf8');
  const sources = { before: cp.execFileSync('git', ['show', '32ba153687bc86b1f7a58a47cc91271b3be32078:' + sourcePath], { encoding: 'utf8', windowsHide: true }), after: fs.readFileSync(sourcePath, 'utf8') };
  const browser = await chromium.launch({ headless: true }), results = [];
  try {
    for (const [name, source] of Object.entries(sources)) for (const view of [{ width: 390, height: 844, dark: true }, { width: 1280, height: 900, dark: false }]) {
      const page = await browser.newPage({ viewport: { width: view.width, height: view.height }, colorScheme: view.dark ? 'dark' : 'light' });
      await page.route('**/*', r => r.abort());
      await page.setContent('<!doctype html><html dir="rtl" lang="ar" class="' + (view.dark ? 'dark' : '') + '"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>' + css + '</style></head><body><main class="mx-auto max-w-5xl p-4">' + await render(source) + '</main></body></html>');
      const label = page.locator('label:has(input[name="returnToConsultancy"])'), input = label.locator('input');
      const metrics = await label.evaluate(e => ({ labelHeight: e.getBoundingClientRect().height, labelWidth: e.getBoundingClientRect().width,
        checkboxHeight: e.querySelector('input').getBoundingClientRect().height, type: e.querySelector('input').type, value: e.querySelector('input').value,
        direction: getComputedStyle(e).direction, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
      await label.click(); const labelToggles = await input.isChecked(); await input.focus(); await input.press('Space'); const keyboardToggles = !(await input.isChecked());
      const pass44 = metrics.labelHeight >= 44;
      if (pass44 !== (name === 'after') || metrics.overflow > 0 || metrics.direction !== 'rtl' || !labelToggles || !keyboardToggles || metrics.type !== 'checkbox' || metrics.value !== '1') throw Error('Checkbox assertion failed: ' + JSON.stringify({ name, view, metrics }));
      if (name === 'after') await page.screenshot({ path: path.join(out, `END-${view.width}.png`), fullPage: true });
      results.push({ source: name, viewport: view.width, ...metrics, pass44, labelToggles, keyboardToggles }); await page.close();
    }
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(out, 'UI_RESULTS.json'), JSON.stringify({ results, assertionPx: 44, authenticatedUat: false, actualPageSource: sourcePath, css: 'ACTIVE_FINAL.css' }, null, 2));
  console.log(JSON.stringify(results));
})().catch(e => { console.error(e.message); process.exitCode = 1; });
