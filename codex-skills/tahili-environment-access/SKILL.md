---
name: tahili-environment-access
description: Enforce Tahili development and production URL, authentication, cookie, and live-check boundaries. Use for auth environment changes, health checks, smoke tests, Playwright, or releases.
---

# Tahili Environment Access

- Work from `/tahili-system` and read `ENVIRONMENTS.md` before any environment, authentication, health-check, smoke-test, Playwright, or release action.
- Treat `ENVIRONMENTS.md` as authoritative. Do not infer addresses from old logs, DNS, Caddy, FRP, or `.env` from another environment.
- Development live checks use only `http://192.168.17.20:3000`.
- Production live checks use only `http://192.168.17.228:3000`.
- Do not use `localhost` when the LAN IP is available.
- Do not send live checks to `tahili.elaqat.site` or `tah.elaqat.site`; do not inspect DNS, FRP, or Caddy unless the user explicitly requests it.
- Keep `NEXTAUTH_URL` on the environment HTTPS domain, `NEXTAUTH_URL_INTERNAL` on its LAN URL, `NEXTAUTH_ALLOW_HTTP_LOGIN=true`, and `AUTH_TRUST_HOST=true` only with the application allowlist enabled.
- Domain sessions must use Secure host-only cookies. LAN sessions use non-Secure host-only cookies. Never set a shared Cookie Domain or accept an unknown Host/callback.
- Never copy `.env`, credentials, data, uploads, backups, volumes, or infrastructure configuration between environments.
- Port 3000 is LAN/loopback only. Do not create public forwarding or modify MikroTik, DNS, FRP, or Caddy.
- Do not print secrets, passwords, CSRF values, or session tokens.
