# تشغيل نسختين محليتين على Windows باستخدام Docker

هذا الدليل للمبتدئ الذي يريد نسخة ثابتة باسم `tahili-original` ونسخة عمل منفصلة باسم `tahili-dev` على الجهاز نفسه. لكل نسخة مجلدها، وملف إعداداتها، ومنفذها، ومشروع Docker Compose الخاص بها. نفّذ الأوامر في **PowerShell**. جميع القيم في `.env.local.example` أمثلة فقط؛ لا تستخدم بيانات أو كلمات مرور من أي بيئة حقيقية.

## 1. المتطلبات

- ثبّت Docker Desktop وشغّله، وتأكد أنه يعمل بوضع Linux containers.
- ثبّت Git for Windows.
- افتح PowerShell وتحقق من توفر الأدوات:

```powershell
docker compose version
git --version
```

تحتاج إلى نسخة Git أساسية من المشروع، ولنفترض أنها في `C:\Projects\tahili`. غيّر هذا المسار إلى مسار مستودعك إن اختلف. تأكد من وجود `docker-compose.local.yml` و`.env.local.example` في الإصدار الذي ستختاره؛ الإصدارات الأقدم التي لا تحتويهما لا تصلح لهذه الخطوات.

## 2. أنشئ مجلدي النسختين

من المستودع الأساسي اعرض الوسوم المتاحة واختر وسم الإصدار الذي تريد تثبيته للنسخة الأصلية:

```powershell
Set-Location C:\Projects\tahili
git tag
```

صيغة الأمر هي `git worktree add C:\Projects\tahili-original <tag>`؛ استبدل `<tag>` بوسم موجود، ولا تكتب الأقواس الزاوية في PowerShell. الأمر التالي يسألك عن الوسم ثم ينشئ المجلد:

```powershell
$tag = Read-Host "اكتب وسم النسخة الأصلية من قائمة git tag"
git worktree add C:\Projects\tahili-original $tag
```

أنشئ فرع عمل جديداً ومجلداً مستقلاً للنسخة التطويرية من الحالة الحالية للمستودع الأساسي:

```powershell
git worktree add -b tahili-dev C:\Projects\tahili-dev HEAD
```

إذا كان فرع `tahili-dev` موجوداً بالفعل، اختر اسماً جديداً للفرع بعد `-b`. يجب أن يكون كل مجلد worktree مختلفاً؛ لا تشغّل النسختين من المجلد نفسه.

## 3. جهّز ملف إعدادات لكل نسخة

انسخ القالب وافتح الملف الجديد في كل مجلد:

```powershell
Set-Location C:\Projects\tahili-original
Copy-Item .env.local.example .env.original
notepad .env.original
```

في `.env.original` تأكد من وجود السطرين التاليين، وعدّل القيم الموجودة إذا لزم:

```dotenv
APP_PORT=3000
TAHILI_LOCAL_ACCESS=true
```

ثم جهّز النسخة التطويرية بالطريقة نفسها:

```powershell
Set-Location C:\Projects\tahili-dev
Copy-Item .env.local.example .env.dev
notepad .env.dev
```

في `.env.dev` اجعل القيم:

```dotenv
APP_PORT=3001
TAHILI_LOCAL_ACCESS=true
```

ولّد قيمة `NEXTAUTH_SECRET` جديدة **لكل نسخة على حدة** بتشغيل السطر التالي مرتين في PowerShell، مرة لكل ملف. انسخ الناتج إلى `NEXTAUTH_SECRET=` في الملف المقابل:

```powershell
$bytes = New-Object byte[] 48; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes); [Convert]::ToBase64String($bytes)
```

لا تعِد استخدام السر بين النسختين أبداً. استبدل أيضاً جميع قيم `change-me` الأخرى في **كل ملف** بقيم محلية قوية ومختلفة، ومنها `DB_USER` و`DB_PASSWORD` و`DB_NAME` و`ADMIN_INITIAL_PASSWORD` و`REMINDER_KEY` و`MINIO_USER` و`MINIO_PASSWORD` و`COLLABORATION_MINIO_BUCKET`. استخدم حروفاً وأرقاماً وشرطات فقط في قيم قاعدة البيانات حتى يبقى رابط الاتصال صالحاً. يجب أن تكون `ADMIN_INITIAL_PASSWORD` بطول 12 حرفاً على الأقل. لا تضف `TAHILI_LAN_IP` أو تضبطه؛ التشغيل هنا محصور بـ`localhost`. احفظ الملفين، ولا تضفهما إلى Git.

## 4. ابنِ وشغّل النسختين

من مجلد النسخة الأصلية:

```powershell
Set-Location C:\Projects\tahili-original
docker compose -f docker-compose.local.yml -p tahili-original --env-file .env.original up -d --build
```

ومن مجلد النسخة التطويرية:

```powershell
Set-Location C:\Projects\tahili-dev
docker compose -f docker-compose.local.yml -p tahili-dev --env-file .env.dev up -d --build
```

قد يتأخر بدء ClamAV للمرة الأولى لأنه ينزّل تواقيع الفيروسات، وهذا يحتاج إلى اتصال بالإنترنت. يستخدم التخزين المحلي صورة MinIO من Chainguard. لكل مشروع Docker وحدات تخزين خاصة به، فلا تختلط بيانات النسختين.

## 5. طبّق الترحيلات وأنشئ البيانات الأولية

نفّذ الأمرين التاليين داخل **كل** مجلد، بعد تشغيل حاوياته. استخدم `prisma migrate deploy` للترحيلات، وليس `prisma db push`.

```powershell
Set-Location C:\Projects\tahili-original
docker compose -f docker-compose.local.yml -p tahili-original --env-file .env.original exec app npx prisma migrate deploy
docker compose -f docker-compose.local.yml -p tahili-original --env-file .env.original exec app npx tsx prisma/seed.ts
```

```powershell
Set-Location C:\Projects\tahili-dev
docker compose -f docker-compose.local.yml -p tahili-dev --env-file .env.dev exec app npx prisma migrate deploy
docker compose -f docker-compose.local.yml -p tahili-dev --env-file .env.dev exec app npx tsx prisma/seed.ts
```

ينشئ ملف البذور المستخدم `admin` إذا لم يكن موجوداً. افتح `http://localhost:3000` للنسخة الأصلية أو `http://localhost:3001` للنسخة التطويرية، وسجّل الدخول باسم `admin` وكلمة المرور التي وضعتها في `ADMIN_INITIAL_PASSWORD` **لنسخة ذلك المنفذ**. غيّر كلمة مرور الإدارة بعد أول دخول.

## 6. الإيقاف وإعادة التشغيل

نفّذ أوامر النسخة المطلوبة من مجلدها. `stop` يوقف الحاويات مع إبقائها؛ `start` يعيد تشغيلها؛ `down` يزيل الحاويات والشبكة مع إبقاء وحدات التخزين والبيانات:

```powershell
Set-Location C:\Projects\tahili-original
docker compose -f docker-compose.local.yml -p tahili-original --env-file .env.original stop
docker compose -f docker-compose.local.yml -p tahili-original --env-file .env.original start
docker compose -f docker-compose.local.yml -p tahili-original --env-file .env.original down
```

```powershell
Set-Location C:\Projects\tahili-dev
docker compose -f docker-compose.local.yml -p tahili-dev --env-file .env.dev stop
docker compose -f docker-compose.local.yml -p tahili-dev --env-file .env.dev start
docker compose -f docker-compose.local.yml -p tahili-dev --env-file .env.dev down
```

بعد `down`، استخدم أمر `up -d --build` في القسم 4 لتشغيل النسخة مجدداً. **تحذير:** `down -v` يحذف وحدات التخزين وبيانات قاعدة البيانات والملفات المرفوعة لتلك النسخة؛ لا تستخدمه إذا أردت الاحتفاظ بالبيانات.
