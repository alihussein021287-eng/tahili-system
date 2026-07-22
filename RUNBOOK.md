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

## Migrations

```bash
docker compose exec -T app npx prisma migrate status
docker compose exec -T app npx prisma migrate deploy
```

استخدم `migrate deploy` فقط للبيئات المشتركة. لا تستخدم `prisma db push`.

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
