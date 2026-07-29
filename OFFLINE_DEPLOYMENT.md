# Offline Deployment

دليل نقل إنتاج عندما يكون الإنتاج بلا إنترنت. نفّذه فقط بعد بوابة `PRODUCTION_CHECKLIST.md` وبطلب إنتاج صريح.

اتبع `ENVIRONMENTS.md`: كل فحص حي بعد النقل عبر `http://192.168.17.228:3000` فقط. لا تفحص الدومين أو DNS أو Caddy ضمن النقل الاعتيادي.

## البناء على VM التطوير

```bash
git fetch origin
git status --short --branch
git rev-parse HEAD
git rev-parse origin/main
npx tsc --noEmit
npm run build
docker compose build app
docker inspect -f '{{.Image}}' tahili_app
```

وثّق commit وimage SHA قبل النقل.

## Backup restore evidence

قبل نقل يتضمن migration أو تغيير بيانات، نفّذ على التطوير `scripts/stage10-backup.sh --apply` و`stage10-isolated-restore-drill.sh NAME` وسجل فقط revision وchecksums والـaggregate counts. لا تنقل archive أو credentials إلى الإنتاج ضمن هذه الخطوة؛ يلزم إجراء منفصل وموافق عليه.

## Observability images

Stage 6A uses `grafana/alloy:v1.16.2@sha256:32913cbfac652d15fa84d256a74e5ee3f71575961bb19d34796ce3838bfba693`. For an approved offline transfer only: `docker save grafana/alloy:v1.16.2 -o /tmp/grafana-alloy-v1.16.2.tar`, checksum it, transfer by an approved channel, then `docker load`. Alloy uses only Docker-internal `alloy:12347` and local `http://loki:3100/loki/api/v1/push`; runtime has no external endpoint.

Stage 7A uses `grafana/tempo:2.9.4@sha256:3ecdaa1af90b3068e77e4fb4b11d9f26201c3a57d5740d34965a323173a4f1aa`. For an approved offline transfer only: `docker save grafana/tempo:2.9.4 -o /tmp/grafana-tempo-2.9.4.tar`, checksum it, transfer by an approved channel, then `docker load`. Tempo stores traces only in the local `tempodata` volume with 72-hour retention; OTLP and the Tempo API remain Docker-internal, with no host-published port or cloud/object-storage endpoint.

Stage 6B pins `@grafana/faro-web-sdk@2.8.2` in `package-lock.json`; obtain it through the approved development dependency cache before an offline build. Browser telemetry uses the app's same-origin adapter and has no external runtime endpoint.

Stage 7B pins `@vercel/otel@2.1.3`, `@opentelemetry/api@1.9.0`, `@opentelemetry/resources@2.10.0`, `@opentelemetry/sdk-trace-base@2.10.0`, and `@opentelemetry/exporter-trace-otlp-http@0.221.0` in `package-lock.json`. Cache these packages before an offline build. Build the application image with `--build-arg GIT_REVISION=<commit>`; this server-only value is embedded as `service.version` and requires no external endpoint.

Stage 7C adds no image or package. Alloy creates bounded local spanmetrics and sends them only to the existing Docker-internal Prometheus receiver; the trace dashboard is provisioned as `trace-observability.json` with UID `tahili-trace-observability`.

The provisioned frontend dashboard is `monitoring/grafana/provisioning/dashboards/json/frontend-observability.json` (UID `tahili-frontend-observability`). It uses only the existing local Grafana, Loki, Prometheus, and Alloy images; no additional image or external endpoint is required offline.

Stage 6C.1 adds no image or package. Prometheus scrapes the aggregate-only adapter endpoint over the existing Docker network. `tahili_faro_*` counters are in-memory and reset when the app restarts; use the process-start and last-forwarded timestamps when diagnosing warm-up. `FARO_ENABLED=false` exports `tahili_faro_enabled 0`; the label-free `tahili_faro_telemetry_expected` gauge remains `0` while the approved instrumentation list is empty, so synthetic envelopes alone never enable the telemetry-absence alert.

## حفظ ونقل الصورة

حالة development المعتمدة بعد Stage 10: احتفظ محلياً فقط بـ`tahili-system-app:latest` (image `7ae316e8…`, revision التطبيق `af4bd33…`) وبـ`tahili-system-app:943292a26c70` كـrollback واحد. commits التشغيلية `53c45ae` و`6dc9410` لا تتطلب image جديدة. لا تستخدم cache أو tags قديمة كمرجع offline.

```bash
docker save tahili-system-app:latest -o /tmp/tahili-system-app.tar
scp /tmp/tahili-system-app.tar prod:/tmp/
```

استخدم اسم host الفعلي للإنتاج. لا تنقل أسراراً ولا ملفات `.env`.

## تحميل الصورة على الإنتاج

```bash
docker load -i /tmp/tahili-system-app.tar
docker image inspect tahili-system-app:latest --format '{{.Id}} {{.Created}}'
```

إذا كان compose يستخدم tag محدداً، حدّث tag خدمة `app` فقط. لا تغيّر PostgreSQL أو MinIO أو Caddy أو DNS.

## Migrations وإعادة إنشاء app فقط

```bash
docker compose exec -T app npx prisma migrate deploy
docker compose up -d --no-deps app
```

لا تستخدم `prisma db push`. لا تحذف volumes. لا تبنِ بـ `npm install` أو `npm run build` على إنتاج بلا إنترنت.

## فحوص بعد النقل

```bash
curl -fsS -o /dev/null -w '%{http_code}\n' http://192.168.17.228:3000/login
docker compose ps
docker logs --tail 300 tahili_app 2>&1 | grep -Ei '500|Prisma|ERROR|FATAL' || true
```

بجلسة Admin افحص `/`, `/readiness`, `/settings`, `/users`, `/permissions`, `/patients-care`, `/therapy-centers`, `/pharmacy-inventory`, `/reports-finance`, `/staff`, `/collaboration/files`, و`/notifications`.

## ملاحظات Caddy وDNS

Caddy وDNS وFRP خارج app ولا تدخل في health check أو smoke test. لا تفحصها أو تعدلها إلا بطلب صريح؛ فشلها لا يمنع اجتياز فحص التطبيق عبر IP.
