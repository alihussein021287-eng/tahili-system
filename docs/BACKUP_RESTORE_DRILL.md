# Stage 10 backup and isolated restore drill

هذه العملية للتطوير فقط. لا تستعيد أبداً إلى PostgreSQL أو MinIO أو uploads العاملة.

- `scripts/stage10-backup.sh` هو dry-run افتراضياً؛ `--apply` ينشئ dump PostgreSQL بصيغة custom وarchives من volumes MinIO وuploads للقراءة فقط تحت `/var/backups/tahili`.
- `scripts/stage10-verify-backup.sh NAME` يتحقق من الاسم، الصلاحيات 700/600، checksums، وبنية dump/archives بدون عرض محتوى.
- `scripts/stage10-isolated-restore-drill.sh NAME` ينشئ شبكة وvolumes وحاوية PostgreSQL ذات prefix `tahili-stage10-` فقط، ثم يحذفها عبر trap بعد مقارنة table/migration/foreign-key وobject count/bytes.
- manifest لا يحتوي إلا الوقت وrevision وaggregate counts/checksums والأحجام. لا يوجد تشفير مضاف؛ الحماية الحالية local filesystem permissions 700/600، ويجب أن يبقى المسار محلياً.
- لا تقبل scripts paths عشوائية؛ الاسم مطابق للصيغة `stage10-YYYYMMDDTHHMMSSZ-PID`. لا تضف جدولة تلقائية قبل drill ناجح دوري موثق.
