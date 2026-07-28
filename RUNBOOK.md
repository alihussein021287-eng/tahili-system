# Runbook

دليل تشغيل يومي لتطوير Tahili على VM التطوير. لا تستخدمه لتغيير الإنتاج إلا مع طلب إنتاج صريح.

اقرأ `ENVIRONMENTS.md` أولاً. كل فحص حي يستخدم IP البيئة فقط؛ لا تستخدم الدومين أو `localhost` ولا تفحص DNS/FRP/Caddy إلا بطلب صريح.

## فحص سريع

```bash
git status --short --branch
git rev-parse HEAD
git rev-parse origin/main
docker compose ps
docker inspect -f '{{.Image}}' tahili_app
docker image inspect tahili-system-app:latest --format '{{.Id}} {{.Created}}'
curl -fsS -o /dev/null -w '%{http_code}\n' http://192.168.17.20:3000/login
```

اترك `skills-lock.json` إذا ظهر untracked ولا تضفه إلا بطلب واضح.
للفحص المجمع الآمن استخدم `scripts/health-check.sh`; السكربت للقراءة فقط ولا يطبع أسراراً.

## Logs والأخطاء

```bash
docker logs --tail 200 tahili_app
docker logs --tail 300 tahili_app 2>&1 | grep -Ei '500|Prisma|ERROR|FATAL' || true
```

عند 500: افتح آخر logs، حدّد route، افحص Prisma error أو permission redirect. عند Prisma: افحص `DATABASE_URL` داخل app فقط ولا تطبعها، ثم شغّل `migrate status`. عند فشل login: افحص NextAuth URL، الكوكيز، حالة المستخدم، و`authVersion`. عند فشل preview/رفع ملفات التعاون: افحص app logs، MinIO، ClamAV، وحالة scan.
إذا ظهر Server Action mismatch بعد نشر حديث، اطلب من المستخدم تحديث الصفحة وتحقق من أنه غير متكرر في آخر logs قبل اعتباره عطل تطبيق.

## Browser telemetry (development)

Faro is disabled unless the server runtime environment has `FARO_ENABLED=true`. It uses only the same-origin `/api/observability/faro` adapter; do not expose or configure the internal Alloy receiver for a browser. The adapter forwards only bounded, sanitized event/log/Web Vital envelopes to local Loki. For a release revision, set the non-secret `GIT_REVISION` runtime value with the app deployment; no rebuild is needed to toggle Faro.

Grafana dashboard UID `tahili-frontend-observability` shows receiver health, sanitized signal kinds, error levels, LCP, normalized routes, and export counters. For a frontend incident, confirm Alloy target `up`, then inspect the dashboard's sanitized Loki panel by time window; never search raw identifiers. `FARO_ENABLED=false` disables collection safely and suppresses the absence alert through its aggregate gauge.

The adapter now exports aggregate `tahili_faro_*` metrics to Prometheus only through the Docker network. Confirm `tahili_faro_enabled` first; telemetry absence is meaningful only after the 15-minute warm-up from `tahili_faro_process_start_time_seconds`. Counters reset after app restart. Diagnose error-rate, LCP, rejection, and forwarding alerts from aggregate counters only; never attempt to reconstruct payloads or user activity.

## Tempo traces (development, Stages 7A–7B)

Tempo is Docker-internal only and uses local `tempodata` storage with 72-hour retention. Grafana datasource UID is `Tempo` and uses `http://tempo:3200`; OTLP reaches Alloy only as `alloy:4317` (gRPC) or `alloy:4318` (HTTP) on the Docker network. Stage 7B enables only Node server request spans with `OTEL_ENABLED=true`; browser, Prisma, and SQL instrumentation remain prohibited. The HTTP exporter uses exactly `http://alloy:4318/v1/traces`; never publish it.

The image build must receive a non-secret `GIT_REVISION` build argument. It becomes immutable server-only `service.version`; do not override it in compose. Keep `OTEL_TEST_FORCE_SAMPLE` absent from deployment compose and use it only in a disposable diagnostic container.

Stage 7C dashboard UID is `tahili-trace-observability`. It uses bounded local RED metrics and a Tempo↔Loki correlation link. Request/Trace IDs remain structured fields only; never use them as labels, metric dimensions, or Debug Bundle content. Trace-absence alerting is gated by `tahili_otel_enabled=1` after a 15-minute warm-up.

For a safe status check, inspect only container health and aggregate metrics: `docker inspect -f '{{.State.Status}} {{.State.Health.Status}}' tahili_tempo tahili_alloy`. Grafana datasource reachability can be verified through its authenticated local proxy to `Tempo /ready`; never copy credentials into shell history or logs. Debug bundles include generic Tempo state/counters only, never trace payloads or raw spans.

## ملخص المراقبة داخل النظام (Stage 8)

`/observability` صفحة قراءة فقط وحصرية لـADMIN؛ تعرض DTO مجمّعاً ومحدوداً من Prometheus وAlertmanager وTempo وLoki داخل شبكة Docker. لا تستخدم Docker socket، ولا تقبل URL أو PromQL من المتصفح، ولا تعرض Grafana أو logs/traces أو Request/Trace IDs خام. تعذر أي مصدر يظهر «غير متاح» ولا يعيد 500 للتطبيق. استخدم Grafana المحلي فقط للتحقيق التفصيلي المصرح به؛ هذه الصفحة ليست بديلاً عنه.

## Debug Bundle منقح

استخدم `scripts/collect-debug-bundle.sh` على VM التطوير فقط. الوضع الافتراضي dry-run؛ لا ينشئ archive حتى تضيف `--create`:

```bash
scripts/collect-debug-bundle.sh --dry-run
scripts/collect-debug-bundle.sh --create --since 10m
scripts/collect-debug-bundle.sh --create --request-id UUID --error-id UUID --output /tmp/tahili-debug.tar.gz
```

يجمع السكربت حالة Git/image/services/resources، حالة migrations غير المتاحة عند منع in-container inspection، probes، alerts، وstructured logs allowlisted فقط. يحظر `.env` وcredentials/cookies/tokens ومفاتيح SSH وDB dumps وuploads وMinIO objects وrequest bodies وبيانات المراجعين. ينشئ archive وchecksum بصلاحية `600`، يفحص الأسرار قبل وبعد الضغط، ويحتفظ بملفات diagnostics المطابقة فقط لمدة 7 أيام دون wildcard واسع.

## تشخيص Codex المحلي (Stage 9)

استخدم `node scripts/tahili-diagnose.mjs` على VM التطوير فقط قبل أي تحقيق أوسع. أوامره الثابتة: `status` و`alerts` و`smoke` و`request UUID` و`error UUID` و`recent-errors` و`service NAME` و`bundle --dry-run`. تقبل `--since` حتى 24 ساعة و`--limit` حتى 20 و`--timeout` المحدود؛ لا تقبل URL أو PromQL/LogQL أو shell أو container أو path من المستخدم. تستخدم Docker inspect وواجهات Docker bridge فقط، ولا تستخدم `docker exec` أو تعرض raw logs/spans أو IDs في التقرير.

`bundle --apply` يحتاج طلباً صريحاً؛ ينشئ archive تحت `/tmp/tahili-diagnose` بصلاحية 600 ويعيد path/checksum/size دون المحتوى. MCP المحلي مؤجل لأن `@modelcontextprotocol/sdk` غير موجود محلياً أو في npm cache؛ لا تنفذ MCP يدوياً ولا تنزّل حزمة وقت التحقيق.

## Migrations

```bash
docker compose exec -T app npx prisma migrate status
docker compose exec -T app npx prisma migrate deploy
```

استخدم `migrate deploy` فقط للبيئات المشتركة. لا تستخدم `prisma db push`.

## مزامنة البيانات المرجعية

المصدر المعتمد في `scripts/reference-data.ts`. ابدأ دائماً بـ`npx tsx scripts/sync-reference-data.ts`، وراجع `planned` و`existingQa`، ثم أعده مع `--apply` فقط للبيئة المقصودة. السكربت يضيف القوائم وكتالوج الأدوية المفقود برصيد صفر داخل transaction، ولا ينسخ أو يعدل دفعات أو كميات أو سجلات QA.

## إعادة إنشاء app فقط

```bash
docker compose build app
docker compose up -d --no-deps app
```

لا تعيد تشغيل PostgreSQL أو MinIO أو Caddy أو ClamAV إلا إذا كان العطل في الخدمة نفسها وبموافقة واضحة.

## فحص الخدمات الداعمة

```bash
docker inspect -f '{{.State.Status}} {{.State.RestartCount}}' tahili_db tahili_storage tahili_clamav tahili_app
docker logs --tail 80 tahili_db
docker logs --tail 80 tahili_storage
docker logs --tail 80 tahili_clamav
```

لا يدخل Caddy أو DNS أو FRP في الفحص الاعتيادي. افحصها فقط عندما يطلب المستخدم ذلك صراحة.

## أوامر آمنة وممنوعة

آمنة للقراءة: `git status`, `git log`, `docker compose ps`, `docker logs`, `curl /login`, `prisma migrate status`, `df -h`, `free -h`.

تحتاج موافقة أو طلب صريح: إعادة تشغيل خدمات داعمة، تعديل Caddy/DNS، حذف بيانات، تنظيف volumes، تغيير Admin، أو نقل الإنتاج.

ممنوعة في التشغيل العادي: `git reset --hard`, حذف volumes، `prisma db push`، بناء npm على إنتاج بدون إنترنت، وطباعة الأسرار.

## متى تتوقف

توقف واطلب قراراً قبل أي خطوة قد تغيّر بيانات أو بنية تحتية: فشل migration، تكرار 5xx بعد إعادة إنشاء app، أخطاء اتصال قاعدة متكررة، فشل ClamAV/MinIO في مسار ملفات حرج، أو الحاجة لتعديل Caddy/DNS/Admin. خذ نسخة احتياطية قبل أي عملية استعادة أو تنظيف بيانات.

## جرد المشروع ونظافة VM

```bash
node scripts/audit-project.mjs
docker system df
docker image ls --no-trunc
docker ps -a
```

استخدم `tahili-project-audit` عند تحديث خريطة النظام، و`tahili-environment-hygiene` عند فحص الموارد أو التنظيف. نفذ dry-run أولاً وسجل:

- المسارات المطلقة والأعمار والأحجام.
- image IDs المستخدمة بالحاويات والصور المستقرة التي ستبقى.
- Docker volumes وbackup freshness دون قراءة المحتوى.
- المساحة قبل وبعد والخدمات و`/login` وmigrations والlogs.

الحذف الآمن المحتمل يقتصر على عناصر مثبتة غير مستخدمة: dangling images، build cache، stopped containers غير اللازمة، archives مؤقتة مؤكدة، وtest/preview temp القديم. لا تحذف volumes أو DB/MinIO/uploads/backups/credentials/QA data أو logs نشطة. لا تحذف tagged app image قبل إثبات أنها ليست عاملة ولا الصورة المستقرة المطلوب إبقاؤها.
