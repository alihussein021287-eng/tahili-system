# 🛠️ أدوات المراقبة والاختبار — نظام المجمع التأهيلي

هذه الأدوات **معزولة تماماً** عن النظام الأساسي — ما تلمس `docker-compose.yml` ولا بيانات تطبيقك.

---

## أولاً: المراقبة (Grafana / PgAdmin / Uptime Kuma / Loki)

### التجهيز (مرة واحدة)

أضف القيم السرية لملف `.env` (بدون قيم افتراضية ضعيفة — الملف يرفض التشغيل بدونها):

```bash
cat >> /tahili-system/.env << 'EOF'
PGADMIN_EMAIL=admin@tahili.local
PGADMIN_PASSWORD=<كلمة سر قوية>
GRAFANA_PASSWORD=<كلمة سر قوية>
EOF
```

### التشغيل

```bash
cd /tahili-system
docker compose -f docker-compose.yml -f docker-compose.monitoring.yml up -d
```

### الوصول (المنافذ مقفلة على localhost للأمان — عبر SSH tunnel)

من **جهازك** (مو السيرفر)، افتح نفق SSH:

```bash
ssh -L 5050:localhost:5050 -L 3001:localhost:3001 -L 3002:localhost:3002 root@192.168.17.20
```

وخلّي النافذة مفتوحة، بعدها من متصفح جهازك:

| الأداة | الرابط | الوظيفة |
|---|---|---|
| **PgAdmin** | http://localhost:5050 | إدارة قاعدة البيانات (IDE ويب) |
| **Uptime Kuma** | http://localhost:3001 | مراقبة إتاحة النظام + تنبيهات |
| **Grafana** | http://localhost:3002 | بحث/فلترة اللوكات + لوحات |

- **PgAdmin:** يدخل بالإيميل/كلمة السر من `.env`. أضف سيرفر جديد: Host=`postgres`, Port=`5432`, المستخدم/كلمة السر من `DATABASE_URL`.
- **Uptime Kuma:** أول دخول تسوي حساب أدمن. أضف مراقب HTTP على `http://tahili_app:3000` (أو رابط النظام).
- **Grafana:** admin / `GRAFANA_PASSWORD`. مصدر بيانات Loki مُعدّ مسبقاً — روح Explore وابحث اللوكات بـ `{container="tahili_app"}`.

### الإيقاف

```bash
docker compose -f docker-compose.yml -f docker-compose.monitoring.yml stop pgadmin uptime-kuma loki promtail grafana
```
(النظام الأساسي يبقى شغّال)

---

## ثانياً: الاختبارات (Vitest / Playwright)

**مهم:** تنصيب حزم الاختبار يحتاج إنترنت. شغّلها على **جهاز التطوير** (مو سيرفر الإنتاج الأوفلاين).

### التجهيز (مرة واحدة، على جهاز فيه نت)

```bash
npm install
npx playwright install chromium   # للـ e2e فقط
```

### اختبارات الوحدة (سريعة — perms / refcode / validate)

```bash
npm run test
```
✅ تم التحقق: 13 اختبار تنجح على النظام الحالي.

### اختبار الدخان (e2e — يتأكد تسجيل الدخول يشتغل)

```bash
# شغّل سيرفر تطوير أولاً بنافذة ثانية: npm run dev
E2E_USERNAME=<حساب اختبار> E2E_PASSWORD=<كلمته> npm run test:e2e
```
⚠️ **لا تستخدم حساب أدمن حقيقي** — أنشئ حساب اختبار مخصص.

### تشغيل تلقائي قبل الرفع (git hook — اختياري)

```bash
git config core.hooksPath .githooks
```
بعدها كل `git push` يشغّل اختبارات الوحدة تلقائياً، ويمنع الرفع لو فشل اختبار.

---

## ملاحظات أمان (طُبّقت بهذه النسخة)

- ✅ كل منافذ المراقبة مقفلة على `127.0.0.1` (SSH tunnel فقط) — مو مكشوفة للشبكة
- ✅ لا كلمات سر افتراضية (`changeme` أُزيلت — الملف يرفض التشغيل بدون قيم `.env`)
- ✅ Grafana: تحديثاته التلقائية مطفأة (متوافق مع التشغيل الأوفلاين)
- ✅ الحزم الجديدة (`vitest`, `@playwright/test`) في `devDependencies` فقط — ما تدخل صورة الإنتاج

---

## استهلاك الموارد

5 حاويات مراقبة تستهلك تقريباً 1–1.5GB RAM إجمالاً. مع سيرفر 16GB، الأثر ضئيل. لو حسّيت بطء، أوقف Grafana+Loki+Promtail (الأثقل) وأبقِ Uptime Kuma + PgAdmin فقط.
