# تشغيل النسخ الاحتياطي والاستعادة

هذا التوثيق خاص بسيرفر التطوير في `/tahili-system`. لا تنفذ الاستعادة على قاعدة تعمل فعلياً إلا بعد إيقاف التطبيق أو وضعه في صيانة وأخذ نسخة جديدة قبل الاستعادة.

## نسخة يدوية

```bash
cd /tahili-system
./backup.sh
```

ينشئ الأمر ملفين داخل `/tahili-system/backups`:

- `db-YYYYMMDD-HHMMSS.sql.gz`: قاعدة البيانات.
- `uploads-YYYYMMDD-HHMMSS.tar.gz`: ملفات المرفقات والصور من volume `/app/uploads`.

زر النسخ من واجهة `/backup` ينشئ نسخة قاعدة بيانات SQL فقط داخل volume المرفقات في `/app/uploads/backups`. هذا لا يشمل ملفات uploads.

## Cron يومي

مثال تشغيل يومي الساعة 02:00:

```cron
0 2 * * * cd /tahili-system && /usr/bin/bash backup.sh >> /tahili-system/backups/backup.log 2>&1
```

إذا كان الرفع السحابي مطلوباً، شغّل `backup-cloud.sh` بعد `backup.sh` بعد ضبط `RCLONE_REMOTE`.

## الاستعادة الآمنة

لا تختبر الاستعادة على قاعدة التطوير الشغالة إلا بقرار صريح. الإجراء الآمن:

1. خذ نسخة جديدة قبل الاستعادة:

   ```bash
   cd /tahili-system
   ./backup.sh
   ```

2. أوقف التطبيق فقط أو ضعه في صيانة:

   ```bash
   docker compose stop app
   ```

3. استعد قاعدة البيانات من ملف محدد:

   ```bash
   gunzip -c backups/db-YYYYMMDD-HHMMSS.sql.gz | docker compose exec -T postgres psql -U "${DB_USER:-tahili}" "${DB_NAME:-tahili}"
   ```

4. استعد المرفقات عند الحاجة فقط:

   ```bash
   docker compose exec -T app sh -lc 'mkdir -p /app/uploads'
   docker compose exec -T app tar xzf - -C /app/uploads < backups/uploads-YYYYMMDD-HHMMSS.tar.gz
   ```

5. أعد تشغيل التطبيق وافحص الصحة:

   ```bash
   docker compose up -d app
   curl -I http://127.0.0.1:3000/login
   ```

لا تضع كلمة مرور قاعدة البيانات في الأوامر أو logs. السكربتات الحالية تعتمد على بيئة Docker ولا تطبع `DATABASE_URL`.
