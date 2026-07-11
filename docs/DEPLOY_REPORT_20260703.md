# تقرير تحديث وتثبيت نظام المجمع التأهيلي

التاريخ: 2026-07-03
المسار: /tahili-system
الحالة النهائية: النظام شغال ومثبت بعد تطبيق التحديثات.

## ملخص
تم تحسين أمان النظام، تشديد الصلاحيات، منع cache للبيانات الحساسة، إضافة صفحة مساحات العمل حسب الفئات، وتطبيق التحديث فعلياً على حاوية التطبيق فقط.

## أهم ما تم
- إضافة .dockerignore.
- حماية PWA Cache.
- تشديد صلاحيات المراجعين والمواعيد والتصدير.
- حماية صفحة تفاصيل المراجع.
- حماية API الطابور.
- منع Cache للتصدير والملفات والنسخ الاحتياطي.
- تقوية API التذكيرات.
- إضافة Security Headers عامة.
- حماية تحميل ملفات المرضى بصلاحية patients.view.
- إضافة سكربتات safe-check و build-check و cleanup و patch-status.
- تجهيز docker-compose.secure-ports.yml للمستقبل فقط.
- إضافة docs/ROLE_WORKFLOWS.md.
- إضافة src/lib/role-workspaces.ts.
- إضافة صفحة /workspaces.
- إضافة رابط مساحات العمل في القائمة.
- تنفيذ Deploy فعلي للتطبيق فقط.

## Rollback
تم إنشاء:
tahili-system-app:rollback-20260703_025027

أمر الرجوع عند الضرورة:
docker compose stop app
ROLLBACK_TAG="$(docker images --format '{{.Repository}}:{{.Tag}}' | grep 'tahili-system-app:rollback-' | sort | tail -1)"
docker image tag "$ROLLBACK_TAG" tahili-system-app:latest
docker compose up -d --no-deps app
sleep 10
docker compose ps
curl -I http://localhost:3000
./scripts/tahili-safe-check.sh

## حالة التشغيل بعد التحديث
- tahili_app يعمل.
- tahili_db لم يتم إعادة تشغيله.
- tahili_storage لم يتم إعادة تشغيله.
- HTTP يرجع 307 طبيعي إلى login.
- Security Headers فعالة.
- لا توجد أخطاء واضحة في app logs.
- لا توجد أخطاء واضحة في database logs.

## أوامر الفحص
./scripts/tahili-safe-check.sh
./scripts/tahili-patch-status.sh
./scripts/tahili-build-check.sh

## أوامر التنظيف
CONFIRM_DELETE=1 ./scripts/tahili-clean-build-check-images.sh

## ملاحظات لاحقة
- لا تفعل docker-compose.secure-ports.yml إلا بوقت صيانة.
- خليه موجود كتحضير فقط.
- لا تحذف rollback image إلا بعد ما تتأكد يوم أو يومين أن كلشي مستقر.
