# Offline Deployment

دليل نقل إنتاج عندما يكون الإنتاج بلا إنترنت. نفّذه فقط بعد بوابة `PRODUCTION_CHECKLIST.md` وبطلب إنتاج صريح.

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

## حفظ ونقل الصورة

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
curl -fsS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/login
docker compose ps
docker logs --tail 300 tahili_app 2>&1 | grep -Ei '500|Prisma|ERROR|FATAL' || true
```

بجلسة Admin افحص `/`, `/readiness`, `/settings`, `/users`, `/permissions`, `/patients-care`, `/therapy-centers`, `/pharmacy-inventory`, `/reports-finance`, `/staff`, `/collaboration/files`, و`/notifications`.

## ملاحظات Caddy وDNS

Caddy وDNS خارج app. لا تعدلهما أثناء نقل image إلا إذا كان العائق مثبتاً في التوجيه، وتوقف قبل أي تغيير خطر. إذا كانت المشكلة 502، افحص أن app يستمع على المنفذ المحلي المتوقع قبل لمس Caddy.
