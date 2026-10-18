import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

type ComposeService = {
  build?: string;
  image?: string;
  user?: string;
  command?: string;
  container_name?: string;
  network_mode?: string;
  ports?: string[];
  expose?: string[];
  healthcheck?: unknown;
  depends_on?: Record<string, { condition: string }>;
  environment?: Record<string, string>;
  volumes?: string[];
  networks?: unknown;
  extra_hosts?: unknown;
};

type LocalCompose = {
  name?: string;
  services: Record<string, ComposeService>;
  volumes: Record<string, { name?: string; external?: boolean } | null>;
  networks?: unknown;
};

const composeSource = readFileSync("docker-compose.local.yml", "utf8");
const compose = parse(composeSource) as LocalCompose;

describe("local Compose isolation", () => {
  it("provides a standalone app, PostgreSQL, ClamAV, and Chainguard MinIO stack", () => {
    expect(Object.keys(compose.services).sort()).toEqual(["app", "clamav", "minio", "postgres"]);
    expect(compose.services.app.build).toBe(".");
    expect(compose.services.postgres.image).toBe("postgres:16-alpine");
    expect(compose.services.minio.image).toBe("cgr.dev/chainguard/minio:latest");
    expect(composeSource).not.toContain("minio/minio");
    expect(compose.services.minio.user).toBe("0:0");
    expect(compose.services.minio.command).toBe('server /data --console-address ":9001"');
    expect(compose.services.minio.healthcheck).toBeUndefined();
    expect(compose.services.clamav.image).toBe("clamav/clamav:stable");
    expect(compose.services.clamav.environment?.CLAMAV_NO_FRESHCLAMD).toBeUndefined();
  });

  it("blocks LAN connections with a forged localhost Host by publishing only on loopback", () => {
    expect(compose.services.app.ports).toEqual(["127.0.0.1:${APP_PORT}:3000"]);
  });

  it.each([3000, 3001])("keeps local copy port %i on loopback after interpolation", (port) => {
    const configured = parse(composeSource.replaceAll("${APP_PORT}", String(port))) as LocalCompose;
    expect(configured.services.app.ports).toEqual([`127.0.0.1:${port}:3000`]);
    expect(configured.services.app.environment?.TAHILI_LOCAL_PORT).toBe(String(port));
    expect(configured.services.app.environment?.NEXTAUTH_URL).toBe(`http://localhost:${port}`);
    expect(configured.services.app.environment?.NEXTAUTH_URL_INTERNAL).toBe(`http://localhost:${port}`);
  });

  it("keeps database, storage, and scanner ports unpublished without host networking", () => {
    for (const name of ["postgres", "minio", "clamav"]) {
      expect(compose.services[name].ports).toBeUndefined();
      expect(compose.services[name].expose).toBeUndefined();
    }
    for (const service of Object.values(compose.services)) {
      expect(service.network_mode).toBeUndefined();
    }
  });

  it("lets the Compose project isolate all container and network names", () => {
    expect(compose.name).toBeUndefined();
    expect(compose.networks).toBeUndefined();
    for (const service of Object.values(compose.services)) {
      expect(service.container_name).toBeUndefined();
      expect(service.networks).toBeUndefined();
      expect(service.extra_hosts).toBeUndefined();
    }
  });

  it("keeps database, storage, scanner, and uploads in separate project-scoped named volumes", () => {
    expect(compose.services.postgres.volumes).toEqual(["pgdata:/var/lib/postgresql/data"]);
    expect(compose.services.minio.volumes).toEqual(["miniodata:/data"]);
    expect(compose.services.clamav.volumes).toEqual(["clamavdata:/var/lib/clamav"]);
    expect(compose.services.app.volumes).toEqual(["uploads:/app/uploads"]);
    expect(Object.keys(compose.volumes).sort()).toEqual(["clamavdata", "miniodata", "pgdata", "uploads"]);
    for (const volume of Object.values(compose.volumes)) {
      expect(volume?.name).toBeUndefined();
      expect(volume?.external).toBeUndefined();
    }
  });

  it("connects the app to private service names and requires a supplied session secret", () => {
    const environment = compose.services.app.environment!;
    expect(environment.DATABASE_URL).toContain("@postgres:5432/");
    expect(environment.MINIO_ENDPOINT).toBe("minio");
    expect(environment.MINIO_PORT).toBe("9000");
    expect(environment.CLAMAV_HOST).toBe("clamav");
    expect(environment.CLAMAV_PORT).toBe("3310");
    expect(compose.services.app.depends_on?.minio).toEqual({ condition: "service_started" });
    expect(compose.services.app.depends_on?.clamav).toEqual({ condition: "service_started" });
    expect(environment.NEXTAUTH_SECRET).toBe("${NEXTAUTH_SECRET:?set a unique NEXTAUTH_SECRET for this local copy}");
  });

  it("requires an explicit local opt-in and uses the published port for host validation", () => {
    expect(compose.services.app.environment).toMatchObject({
      TAHILI_LOCAL_ACCESS: "${TAHILI_LOCAL_ACCESS:-false}",
      TAHILI_LOCAL_PORT: "${APP_PORT}",
      NEXTAUTH_URL: "http://localhost:${APP_PORT}",
      NEXTAUTH_URL_INTERNAL: "http://localhost:${APP_PORT}",
      NEXTAUTH_ALLOW_HTTP_LOGIN: "true",
      AUTH_TRUST_HOST: "true",
      FARO_ENABLED: "false",
      OTEL_ENABLED: "false",
    });
  });
});
