# Phase 0 — Live Backup / Restore Gate

هذه البوابة يجب أن تنجح قبل أول تغيير runtime على `prisma/schema.prisma` أو أي migration خاصة بخطة Saif.

## لماذا ما نستخدم backup.sh القديم وحده

الـ`backup.sh` الجذري يغطي PostgreSQL و`/app/uploads`، لكنه ليس بوابة الخطة لأنه لا يثبت بنفسه backup كامل لـMinIO + verification + isolated restore.

المشروع يحتوي أصلاً أدوات أقوى ومناسبة للخطة:

- `scripts/stage10-backup.sh`
- `scripts/stage10-verify-backup.sh`
- `scripts/stage10-isolated-restore-drill.sh`
- `docs/BACKUP_RESTORE_DRILL.md`

`stage10-backup.sh` يأخذ:

- PostgreSQL بصيغة custom dump.
- MinIO volume كـtar.gz read-only.
- uploads volume كـtar.gz read-only.
- manifest فيه revision + table/migration/FK counts + object counts/bytes.
- SHA256 hashes وصلاحيات 600.

`stage10-verify-backup.sh` يتحقق من:

- SHA256.
- قابلية قراءة `pg_restore -l`.
- قابلية قراءة MinIO/uploads archives.
- صحة manifest الأساسية.

`stage10-isolated-restore-drill.sh`:

- ينشئ network وvolumes مؤقتة بأسماء `tahili-stage10-*`.
- يرجع PostgreSQL إلى DB معزولة.
- يرجع MinIO/uploads إلى volumes معزولة.
- يقارن table/migration/FK counts.
- يقارن file counts/bytes.
- ينظف حصراً الموارد المؤقتة عند الانتهاء.
- لا يربط التطبيق ولا يلمس DB/MinIO/uploads الأصلية.

## الأوامر عند توفر الوصول للشبكة الداخلية

نفذ على السيرفر الحي من `/tahili-system` فقط بعد التأكد من المسار:

```bash
cd /tahili-system || exit 1

# 1) قراءة فقط قبل النسخ
git rev-parse HEAD
git status --short --branch
docker compose ps
docker compose exec -T app npx prisma migrate status
df -h /

# 2) dry-run
bash scripts/stage10-backup.sh

# 3) إنشاء النسخة
bash scripts/stage10-backup.sh --apply
```

الأمر الأخير يطبع اسماً مثل:

```text
backup=stage10-YYYYMMDDTHHMMSSZ-PID status=created
```

استخدم الاسم نفسه في الخطوتين التاليتين:

```bash
bash scripts/stage10-verify-backup.sh stage10-YYYYMMDDTHHMMSSZ-PID
bash scripts/stage10-isolated-restore-drill.sh stage10-YYYYMMDDTHHMMSSZ-PID
```

## النجاح المطلوب

لا نفتح Phase 1 runtime قبل أن تكون النتيجة:

```text
status=created
status=verified
status=restore-drill-pass
```

وكذلك نحفظ:

- commit/revision الحي.
- `prisma migrate status`.
- manifest counts.
- أي مشكلة معروفة قبل التعديل.

## ممنوع في هذه البوابة

- `prisma db push`.
- حذف volume.
- restart لـPostgreSQL/MinIO بدون سبب منفصل وموافقة.
- restore داخل Production كاختبار.
- تعديل بيانات يدوي لتجاوز فشل restore/migration.
- حذف migrations القديمة.

## بعد نجاح البوابة

نفتح GUID Foundation فقط، ونبدأ additive migration للـfoundation anchors دون حذف old IDs:

`User`, `Patient`, `Branch`, `Center`, `ReferralRequest`.

بعدها mapping/backfill/dual-read-write/validation، ثم فقط ننتقل إلى Unit + StaffMember.
