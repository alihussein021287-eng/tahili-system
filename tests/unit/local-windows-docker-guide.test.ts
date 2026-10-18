import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const guide = readFileSync("docs/LOCAL_WINDOWS_DOCKER.md", "utf8");
const environments = readFileSync("ENVIRONMENTS.md", "utf8");

describe("Windows local Docker guide", () => {
  it("walks through two isolated copies with their own ports and environment files", () => {
    expect(guide).toContain("git worktree add C:\\Projects\\tahili-original");
    expect(guide).toContain("tahili-original");
    expect(guide).toContain("tahili-dev");
    expect(guide).toContain("APP_PORT=3000");
    expect(guide).toContain("APP_PORT=3001");
    expect(guide).toContain(".env.original");
    expect(guide).toContain(".env.dev");
    expect(guide).toContain("Copy-Item .env.local.example");
    expect(guide).toContain("TAHILI_LOCAL_ACCESS=true");
    expect(guide).toContain("RandomNumberGenerator");
    expect(guide).not.toMatch(/192\.168\.17\.\d+/);
  });

  it("documents the Compose lifecycle, migrations and initial login without recommending db push", () => {
    expect(guide).toContain("docker compose -f docker-compose.local.yml -p");
    expect(guide).toContain("--env-file");
    expect(guide).toContain("up -d --build");
    expect(guide).toContain("exec app npx prisma migrate deploy");
    expect(guide).toContain("exec app npx tsx prisma/seed.ts");
    expect(guide).toContain("ADMIN_INITIAL_PASSWORD");
    expect(guide).toContain("http://localhost:3000");
    expect(guide).toContain("http://localhost:3001");
    expect(guide).toMatch(/down -v.*(?:يحذف|يحذفها|حذف)/);
    expect(guide).not.toMatch(/^\s*(?:docker compose .* exec app npx )?prisma db push\b/m);
  });

  it("is linked from the local section of ENVIRONMENTS.md", () => {
    const localSection = environments.split("## وضع loopback المحلي الاختياري")[1]?.split("\n## ")[0];
    expect(localSection).toContain("[دليل التشغيل المحلي على Windows باستخدام Docker](docs/LOCAL_WINDOWS_DOCKER.md)");
  });
});
