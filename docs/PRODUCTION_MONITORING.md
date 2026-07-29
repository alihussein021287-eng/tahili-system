# Production monitoring compose

`docker-compose.production-monitoring.yml` is a standalone, pinned monitoring
stack. It is intentionally separate from the development-only compose files.
It has no LAN-published monitoring ports: Grafana (`127.0.0.1:13002`) and
Prometheus bind to loopback only; every other endpoint remains Docker-internal.

## Preconditions

- Start the monitoring stack first: it owns the dedicated
  `tahili-observability` bridge (`172.30.255.0/28`). The base compose attaches
  only `app` at fixed `172.30.255.2`; it retains its default network unchanged.
- The app has fixed `/etc/hosts` mappings for `prometheus`, `alertmanager`,
  `loki`, `tempo`, and `alloy` to gateway `172.30.255.3`. This deliberately
  takes precedence over any legacy-network aliases without changing those
  services or networks.
- All twelve pinned images must be loaded locally before use. `pull_policy:
  never` is deliberate.
- Create the production-only secret directory with mode `700` and both files
  with mode `600`:

  ```bash
  install -d -m 700 .secrets/production-monitoring
  install -m 600 /secure-source/grafana_admin_password .secrets/production-monitoring/grafana_admin_password
  install -m 600 /secure-source/postgres_exporter_dsn .secrets/production-monitoring/postgres_exporter_dsn
  ```

  The secret directory is ignored by Git. Never place secret contents in a
  compose file, shell history, manifest, issue, or log.

## Isolation and retention

- `monitoring_internal` is internal. Prometheus, Alertmanager, Loki, and
  Tempo are attached only to it. `observability-gateway` is the only service
  attached to `tahili-observability` and has fixed `172.30.255.3`. Its aliases
  preserve the immutable app hostnames `prometheus`, `alertmanager`, `loki`,
  `tempo`, and `alloy`; it has no published ports.
- The internal subnet reserves `172.30.254.2` for Prometheus and
  `172.30.254.3` for the gateway. Automatic monitoring leases are restricted
  to `172.30.254.8/29`, so startup order cannot claim either fixed address.
- Gateway control-plane targets are fixed internal addresses: Alertmanager
  `.4`, Loki `.5`, Tempo `.6`, and Alloy `.7`. They never resolve through the
  app-network aliases that point back to the gateway.
- The gateway accepts only the fixed app address on control-plane/Faro/OTLP
  ports, and only fixed Prometheus on its internal metrics path. It allows only
  the named app summary queries, fixed method/path mappings, 64 KiB bodies,
  and 120 requests per source/port/minute. Other source addresses, paths,
  methods, or queries receive rejection.
- The fixed Prometheus metrics route overwrites its upstream `Host` with
  `app:3000`, matching the application's dedicated internal metrics bypass;
  arbitrary client `Host` headers are never forwarded.
- Volumes are explicitly named `tahili-monitoring-*`.
- Retention is Prometheus 7d, Loki 7d (`168h`), and Tempo 72h.
- Grafana retains its read-only root filesystem; only its runtime log path is
  a bounded `16m` tmpfs. Persistent Grafana state remains limited to the
  named data volume.
- Grafana runs as `0:0` only to read its Docker Compose secret file, whose
  host mode remains `600`. It keeps `read_only`, `cap_drop: ALL`,
  `no-new-privileges`, its internal-only network, and no host mounts; no secret
  is copied into environment text or the compose file.
- Promtail has no Docker socket or container-log mount. It intentionally
  scrapes nothing until a dedicated sanitized log source is approved.
- node-exporter and cAdvisor are kept as pinned `host-metrics` profile
  packages but are not enabled by default and have no host-root, Docker-data,
  Docker socket, or `/var/run` mount. Host CPU/memory/disk and container
  restart metrics are therefore N/A until a separately approved safe host
  collector exists.
- Dependency probes (PostgreSQL, MinIO, ClamAV) and their summary fields are
  N/A: no dependency service joins `tahili-observability`, and the gateway has
  no TCP forwarding or generic proxy. The immutable query strings remain
  allowlisted so the app reports unavailable rather than broadening network
  access.
- The optional `database-metrics`, `dependency-probes`, and `host-metrics`
  profiles remain disabled. Their images stay pinned for offline inventory,
  but they are not part of the safe default monitoring deployment; Prometheus
  has no default `depends_on` or scrape target for them.

## Deliberate validation constraints

Do not start this compose as part of a source review. Before an approved
deployment, validate the pinned image's support for `DATA_SOURCE_NAME_FILE`
only before an explicitly approved future `database-metrics` design. If the
image does not support it, use an equally file-backed mechanism; do not move
the DSN into compose or environment text.
