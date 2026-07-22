# Production Checklist

بوابة أمان قبل أي نقل إلى الإنتاج. إذا فشل أي بند قبل النقل، توقف ولا تلمس الإنتاج.

العناوين وقاعدة الفحص في `ENVIRONMENTS.md`: فحص التطوير عبر `http://192.168.17.20:3000` والإنتاج عبر `http://192.168.17.228:3000` فقط. لا تجعل DNS أو الدومين أو Caddy بوابة للنشر دون طلب صريح.

## Preflight

| البند | PASS/FAIL | ملاحظات |
| --- | --- | --- |
| `git status --short --branch` لا يحتوي تغييرات tracked |  |  |
| `HEAD` يساوي `origin/main` أو أحدث بنفس سلسلة العمل |  |  |
| لا توجد عملية نشر أخرى جارية |  |  |
| `skills-lock.json` غير ملموس إذا كان untracked |  |  |
| `npx tsc --noEmit` نجح |  |  |
| `npm run build` نجح على VM التطوير |  |  |
| الاختبارات المطلوبة نجحت |  |  |
| `prisma migrate status` لا يظهر تعارضاً |  |  |
| نسخة احتياطية موثقة إذا توجد migration أو تغيير بيانات |  |  |
| صورة التطوير SHA موثقة |  |  |
| أدوات runtime داخل image مؤكدة إذا تغيرت الملفات/preview/ClamAV/LibreOffice |  |  |
| لا secrets أو كلمات مرور في diff أو logs |  |  |
| logs التطوير بلا `500` أو Prisma أو `ERROR/FATAL` |  |  |

## نقل صورة بدون إنترنت

| البند | PASS/FAIL | ملاحظات |
| --- | --- | --- |
| حفظ نفس Docker image المبنية على التطوير |  |  |
| نقل archive إلى الإنتاج بدون بناء npm هناك |  |  |
| تحميل الصورة على الإنتاج وتأكيد SHA |  |  |
| تحديث compose tag لخدمة app فقط |  |  |
| `prisma migrate deploy` فقط |  |  |
| `docker compose up -d --no-deps app` فقط |  |  |

## فحص الإنتاج

| route أو خدمة | PASS/FAIL | ملاحظات |
| --- | --- | --- |
| `/login` = 200 |  |  |
| `/` بجلسة Admin |  |  |
| `/readiness` |  |  |
| `/settings`, `/users`, `/permissions` |  |  |
| `/patients-care`, `/therapy-centers`, `/pharmacy-inventory` |  |  |
| `/reports-finance`, `/staff`, `/collaboration/files`, `/notifications` |  |  |
| السايدبار بلا تكرار أو مجموعات فارغة أو overflow واضح |  |  |
| logs الإنتاج بلا `500` أو Prisma أو `ERROR/FATAL` |  |  |
| `NEXTAUTH_URL` بقي دومين HTTPS و`NEXTAUTH_URL_INTERNAL` هو IP البيئة |  |  |
| cookie IP غير Secure وhost-only؛ cookie الدومين Secure وhost-only وفق الاختبارات |  |  |
| app/PostgreSQL/MinIO/ClamAV تعمل دون إعادة تشغيل غير لازمة |  |  |

## قيود ثابتة

لا تلمس DB volumes، Caddy، DNS، أو حساب Admin إلا بطلب واضح. لا تستخدم `prisma db push`. لا تحذف بيانات QA أثناء النقل.
