# نشر tahili-system على VM الإنتاج المحلي

هذا الدليل مخصص للـ VM الإنتاجية المحلية فقط. لا يحتاج الإنتاج إلى دومين عام، ولا يجب فتح PostgreSQL أو MinIO للعامة.

## 1. تجهيز الحزمة

على VM التطوير:

```bash
npm run release:pack
```

ينتج الملف داخل `releases/` باسم مثل:

```text
tahili-system-release-YYYYMMDD-HHMMSS.tar.gz
```

الحزمة يجب أن تكون بدون:

- `.env`
- `node_modules`
- `.next`
- `backups`
- `uploads`
- `_images` وملفات Docker image tar
- dumps قواعد البيانات مثل `.sql`, `.sql.gz`, `.dump`, `.backup`
- أي أرشيفات قديمة `.zip`, `.tar`, `.tar.gz`, `.tgz`

## 2. نقل الملفات إلى VM الإنتاج

انسخ ملف release فقط إلى VM الإنتاج المحلية، ثم فكّه في مسار ثابت:

```bash
mkdir -p /opt/tahili-system
tar -xzf tahili-system-release-YYYYMMDD-HHMMSS.tar.gz -C /opt/tahili-system
cd /opt/tahili-system
```

احتفظ بنسخة من ملف release في مكان آمن قبل التشغيل.

## 3. إنشاء ملف البيئة

```bash
cp .env.example .env
nano .env
```

اضبط القيم الأساسية:

```env
DATABASE_URL=postgresql://tahili:كلمة_مرور_قوية@postgres:5432/tahili
NEXTAUTH_SECRET=مفتاح_عشوائي_طويل
NEXTAUTH_URL=http://IP_OR_LOCAL_HOSTNAME:3000
ADMIN_INITIAL_PASSWORD=كلمة_مرور_أولية_قوية
REMINDER_KEY=مفتاح_عشوائي_للتذكيرات
DB_USER=tahili
DB_PASSWORD=كلمة_مرور_قوية
DB_NAME=tahili
MINIO_USER=admin
MINIO_PASSWORD=كلمة_مرور_قوية
UPLOAD_DIR=/app/uploads
```

توليد مفاتيح مناسبة:

```bash
openssl rand -base64 32
```

## 4. ضبط المنافذ المحلية

للإنتاج المحلي يفضل استخدام ملف المنافذ الآمنة:

```bash
docker compose -f docker-compose.yml -f docker-compose.secure-ports.yml config
```

تأكد أن PostgreSQL وMinIO وواجهات الإدارة مربوطة على `127.0.0.1` فقط، وأن منفذ التطبيق لا يفتح إلا حسب خطة الشبكة المحلية.

## 5. التشغيل

```bash
docker compose -f docker-compose.yml -f docker-compose.secure-ports.yml up -d --build
```

تهيئة قاعدة البيانات حسب حالة المشروع الحالية:

```bash
docker compose -f docker-compose.yml -f docker-compose.secure-ports.yml exec app npx prisma db push
docker compose -f docker-compose.yml -f docker-compose.secure-ports.yml exec app npm run db:seed
```

ملاحظة Stage 3: أضيف جدول `TherapySessionLog` لتوثيق نتائج جلسات العلاج. أي نشر على بيئة جديدة أو قاعدة موجودة قبل هذا checkpoint يحتاج تطبيق مخطط Prisma عبر `npx prisma db push`، أو migration مناسب إذا تم اعتماد أسلوب migrations الرسمي في تلك البيئة.

إذا صار المشروع يعتمد لاحقاً على migrations رسمية، استخدم `prisma migrate deploy` بدلاً من `db push`.

## 6. فحص التشغيل

```bash
docker compose -f docker-compose.yml -f docker-compose.secure-ports.yml ps
docker compose -f docker-compose.yml -f docker-compose.secure-ports.yml logs --since=5m app
curl -I http://127.0.0.1:3000/login
curl -I http://127.0.0.1:3000/readiness
```

ثم افتح من شبكة الإنتاج المحلية:

```text
http://IP_OR_LOCAL_HOSTNAME:3000/login
```

ادخل بكلمة `ADMIN_INITIAL_PASSWORD` فقط لأول تشغيل، ثم غيّر كلمة مرور admin من داخل النظام.

## 7. النسخ الاحتياطي

تأكد من وجود مجلد `backups/` على VM الإنتاج بعد التشغيل، ومن عمل النسخ الاحتياطي اليومي:

```bash
docker compose -f docker-compose.yml -f docker-compose.secure-ports.yml exec app bash backup.sh
ls -lh backups
```

لا تنقل backups أو uploads داخل حزمة release. انقلها فقط عبر خطة ترحيل بيانات منفصلة عند الحاجة.

## Production Checklist

- تم إنشاء `.env` من `.env.example` على VM الإنتاج، وليس من VM التطوير.
- تم ضبط `DATABASE_URL` على خدمة `postgres` داخل Docker.
- تم توليد `NEXTAUTH_SECRET` قوي وفريد للإنتاج.
- تم ضبط `ADMIN_INITIAL_PASSWORD` قوي لأول تشغيل فقط.
- تم تغيير كلمة مرور admin بعد أول دخول.
- صفحة `/setup` لا تعرض setup للعامة بعد وجود admin مفعّل.
- النسخ الاحتياطي يعمل وتم اختبار وجود ملف backup.
- منفذ التطبيق محصور حسب الشبكة المحلية المطلوبة.
- PostgreSQL غير مفتوح للعامة.
- MinIO وMinIO Console غير مفتوحين للعامة.
- pgAdmin/Grafana/Uptime Kuma غير مفتوحة للعامة إلا عند الحاجة وبحماية.
- تم فحص `/login` و`/readiness`.
- تم حفظ نسخة release النهائية في مكان آمن.
- لا توجد `.env` أو dumps أو uploads أو backups داخل release.
