import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const compose = readFileSync("docker-compose.production-monitoring.yml", "utf8");
const baseCompose = readFileSync("docker-compose.yml", "utf8");
const promtail = readFileSync("monitoring/production/promtail.yml", "utf8");
const prometheus = readFileSync("monitoring/production/prometheus.yml", "utf8");
const loki = readFileSync("monitoring/production/loki.yml", "utf8");
const alloy = readFileSync("monitoring/production/alloy.config.alloy", "utf8");
const rules = readFileSync("monitoring/production/rules.yml", "utf8");
const gateway = readFileSync("monitoring/production/gateway.mjs", "utf8");
const gatewayPolicy = readFileSync("monitoring/production/gateway-policy.mjs", "utf8");

const pinnedImages = [
  "grafana/grafana:11.1.0@sha256:079600c9517b678c10cda6006b4487d3174512fd4c6cface37df7822756ed7a5",
  "grafana/loki:2.9.6@sha256:6ca6e2cd3b6f45e0eb298da2920610fde63ecd8ab6c595d9c941c8559d1d9407",
  "grafana/promtail:2.9.6@sha256:c0e57ee03512475e982893622544d76da4e3c3671a72425c670ccfc0024a4187",
  "grafana/tempo:2.9.4@sha256:3ecdaa1af90b3068e77e4fb4b11d9f26201c3a57d5740d34965a323173a4f1aa",
  "grafana/alloy:v1.16.2@sha256:32913cbfac652d15fa84d256a74e5ee3f71575961bb19d34796ce3838bfba693",
  "prom/prometheus:v2.54.1@sha256:f6639335d34a77d9d9db382b92eeb7fc00934be8eae81dbc03b31cfe90411a94",
  "prom/alertmanager:v0.27.0@sha256:e13b6ed5cb929eeaee733479dce55e10eb3bc2e9c4586c705a4e8da41e5eacf5",
  "prom/node-exporter:v1.8.2@sha256:4032c6d5bfd752342c3e631c2f1de93ba6b86c41db6b167b9a35372c139e7706",
  "gcr.io/cadvisor/cadvisor:v0.49.1@sha256:3cde6faf0791ebf7b41d6f8ae7145466fed712ea6f252c935294d2608b1af388",
  "prometheuscommunity/postgres-exporter:v0.15.0@sha256:386b12d19eab2a37d7cd8ca8b4c7491cc7a830d9581f49af6c98a393da9605e6",
  "prom/blackbox-exporter:v0.25.0@sha256:b04a9fef4fa086a02fc7fcd8dcdbc4b7b35cc30cdee860fdc6a19dd8b208d63e",
  "public.ecr.aws/docker/library/node:20-alpine@sha256:fb4cd12c85ee03686f6af5362a0b0d56d50c58a04632e6c0fb8363f609372293",
];
const service = (name: string) => compose.match(new RegExp(`\\n  ${name}:\\n([\\s\\S]*?)(?=\\n  [a-z-]+:|\\nnetworks:)`))?.[1] ?? "";
const baseService = (name: string) => baseCompose.match(new RegExp(`\\n  ${name}:\\n([\\s\\S]*?)(?=\\n  [a-z-]+:|\\nvolumes:)`))?.[1] ?? "";

describe("production monitoring contract", () => {
  it("uses the isolated project name, all pinned local images, and never pulls", () => {
    expect(compose).toContain("name: tahili-monitoring");
    expect((compose.match(/image: /g) ?? [])).toHaveLength(12);
    for (const image of pinnedImages) expect(compose).toContain(`image: ${image}`);
    expect(compose).toContain("pull_policy: never");
  });

  it("uses only loopback Grafana and Prometheus host ports", () => {
    expect(compose).toContain('"127.0.0.1:13002:3000"');
    expect(compose).toContain('"127.0.0.1:9090:9090"');
    expect((compose.match(/\bports:/g) ?? [])).toHaveLength(2);
    expect(compose).not.toContain("TAHILI_LAN_IP");
  });

  it("keeps only app and gateway on the fixed observability network", () => {
    expect(baseCompose).toContain("name: tahili-observability");
    expect(baseCompose).toContain("ipv4_address: 172.30.255.2");
    expect(baseCompose).toContain("default: {}");
    expect(compose).toContain("name: tahili-observability");
    expect(compose).toContain("subnet: 172.30.255.0/28");
    expect(service("observability-gateway")).toContain("ipv4_address: 172.30.255.3");
    expect(service("observability-gateway")).toContain("aliases: [prometheus, alertmanager, loki, tempo, alloy]");
    for (const name of ["postgres", "minio", "clamav"]) expect(baseService(name)).not.toContain("observability");
    for (const name of ["prometheus", "alertmanager", "loki", "tempo", "alloy", "grafana", "promtail", "blackbox-exporter", "postgres-exporter"]) {
      expect(service(name)).not.toContain("observability");
    }
  });

  it("keeps backends internal, scrapes app metrics through the fixed gateway, and omits dependency probes", () => {
    for (const name of ["alertmanager", "loki", "tempo", "alloy"]) {
      expect(service(name)).toContain("networks: [monitoring_internal]");
    }
    expect(service("prometheus")).toContain("monitoring_internal:");
    expect(service("prometheus")).toContain("ipv4_address: 172.30.254.2");
    expect(service("observability-gateway")).toContain("ipv4_address: 172.30.254.3");
    expect(service("alloy")).toContain("networks: [monitoring_internal]");
    expect(prometheus).toContain('targets: ["observability-gateway:9101"]');
    expect(prometheus).not.toContain("blackbox");
    expect(prometheus).not.toContain("postgres-exporter");
    expect(service("prometheus")).toContain("depends_on: [alertmanager]");
    expect(service("prometheus")).not.toContain("postgres-exporter");
    expect(service("prometheus")).not.toContain("blackbox-exporter");
    expect(service("postgres-exporter")).toContain("profiles: [database-metrics]");
    expect(service("blackbox-exporter")).toContain("profiles: [dependency-probes]");
  });

  it("uses project-scoped volumes, bounded retention, file-backed secrets, and no host mounts", () => {
    expect(compose).toContain("tahili-monitoring-prometheus-data");
    expect(compose).toContain("tahili-monitoring-loki-data");
    expect(compose).toContain("tahili-monitoring-tempo-data");
    expect(compose).toContain("./.secrets/production-monitoring/grafana_admin_password");
    expect(compose).not.toMatch(/PASSWORD:\s*\$?\{?/);
    expect(compose).toContain("--storage.tsdb.retention.time=7d");
    expect(rules).toContain("environment: production");
    expect(loki).toContain("retention_period: 168h");
    expect(compose).not.toContain("docker.sock");
    expect(compose).not.toContain("/var/lib/docker");
    expect(compose).not.toContain("/:/rootfs");
    expect(compose).toContain("max-size: \"10m\"");
  });

  it("keeps Promtail socket-free and gateway routes fixed and size-limited", () => {
    expect(promtail).toContain("scrape_configs: []");
    expect(alloy).not.toContain("tahili.request_id");
    expect(gateway).not.toContain('from "node:net"');
    expect(gateway).toContain("MAX_BODY_BYTES");
    expect(gateway).toContain("isAllowedRequest");
    expect(gateway).toContain("response.writeHead(403)");
    expect(gatewayPolicy).toContain("12347");
    expect(gatewayPolicy).toContain("4318");
  });
});
