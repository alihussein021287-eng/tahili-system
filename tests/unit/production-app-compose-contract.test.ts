import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const override = readFileSync("docker-compose.production-app.yml", "utf8");
const rollback = readFileSync("docker-compose.production-app.rollback-stage11.yml", "utf8");
const monitoringDoc = readFileSync("docs/PRODUCTION_MONITORING.md", "utf8");

describe("production app compose override", () => {
  it("pins the approved offline image and closed runtime telemetry environment", () => {
    expect(override).toContain("image: tahili-system-app:2790a7f30b2baa35c8e40bd9acb00ff37e2840b3");
    expect(override).toContain("pull_policy: never");
    expect(override).toContain("TAHILI_ENVIRONMENT: production");
    expect(override).toContain('FARO_ENABLED: "true"');
    expect(override).toContain('OTEL_ENABLED: "true"');
    expect(override).not.toMatch(/build:|NEXT_PUBLIC|NODE_ENV/);
  });

  it("preserves the existing production uploads volume without redefining dependencies", () => {
    expect(override).toContain("production_uploads:/app/uploads");
    expect(override).toContain("external: true");
    expect(override).toContain("name: tahili-system_uploads_v3");
    expect(override).not.toMatch(/\n\s{2}(postgres|minio|clamav|caddy):/);
  });

  it("keeps rollback pinned to the previous image and the same uploads volume", () => {
    expect(rollback).toContain("image: tahili-system-app:rollback-8110db56f0c4a7044daaf82cacec530d762d4307");
    expect(rollback).toContain("pull_policy: never");
    expect(rollback).toContain('FARO_ENABLED: "false"');
    expect(rollback).toContain('OTEL_ENABLED: "false"');
    expect(rollback).toContain("production_uploads:/app/uploads");
    expect(rollback).toContain("name: tahili-system_uploads_v3");
    expect(rollback).not.toMatch(/build:|\n\s{2}(postgres|minio|clamav|caddy):/);
    expect(monitoringDoc).not.toContain("removing the override is the runtime rollback path");
    expect(monitoringDoc).toContain("docker-compose.production-app.rollback-stage11.yml");
    expect(monitoringDoc).toContain("keeps the same external uploads");
  });
});
