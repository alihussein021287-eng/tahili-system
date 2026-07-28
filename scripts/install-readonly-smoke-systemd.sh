#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
install -d -m 0700 /etc/tahili /var/lib/tahili-smoke/results /var/lib/tahili-smoke/metrics /run/tahili
if [[ ! -f /etc/tahili/smoke.env ]]; then
  printf 'TAHILI_SMOKE_ENABLED=true\n' > /etc/tahili/smoke.env
  chmod 600 /etc/tahili/smoke.env
fi
install -m 0644 "$ROOT/systemd/tahili-readonly-smoke.service" /etc/systemd/system/tahili-readonly-smoke.service
install -m 0644 "$ROOT/systemd/tahili-readonly-smoke.timer" /etc/systemd/system/tahili-readonly-smoke.timer
systemctl daemon-reload
systemctl enable --now tahili-readonly-smoke.timer
