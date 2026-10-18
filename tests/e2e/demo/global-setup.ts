// With DEMO_FRESH=1 a check starts from empty results (the journeys run); the page sweep that
// follows in a second run keeps adding to the same files.
import fs from "node:fs";
import path from "node:path";

export default async function globalSetup() {
  if (process.env.DEMO_FRESH !== "1") return;
  const dir = path.resolve(process.env.DEMO_RESULTS || "test-results/demo");
  for (const name of ["findings.jsonl", "steps.jsonl", "stale-refresh.jsonl", "patients.json", "sweep-coverage.json", "summary.json", "report.md", "results.json", "sweep-results.json"]) {
    fs.rmSync(path.join(dir, name), { force: true });
  }
  for (const name of ["states", "screenshots"]) fs.rmSync(path.join(dir, name), { recursive: true, force: true });
}
