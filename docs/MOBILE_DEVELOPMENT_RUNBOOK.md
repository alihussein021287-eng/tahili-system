# Tahili Mobile Development Runbook

## الحالة الحالية

Phase 0 فقط. لا mobile dependencies ولا `apps/mobile` ولا native project
حالياً لأن بوابة الأمن فشلت باثنتين High. لا تنفذ أوامر scaffold/build أدناه
قبل إغلاق الطلبين:

- `docs/specs/MOBILE_DEVICE_SESSION_SCHEMA_REQUEST.md`
- `docs/specs/MOBILE_PATIENT_SCOPE_POLICY_REQUEST.md`

## حدود التشغيل

- VM التطوير فقط.
- لا إنتاج، لا production LAN checks، لا domains، لا DNS/Caddy/FRP/MikroTik.
- بيانات وحسابات QA صناعية فقط.
- لا Prisma `db push`.
- لا EAS Build/Update/Submit، Expo Cloud، Firebase، Sentry، أو telemetry خارجية.
- لا secrets/signing keys/credentials في Git أو command output.
- لا merge إلى `main` ولا production deploy.

عنوان فحص Tahili development المعتمد يبقى ما في `ENVIRONMENTS.md`. إعداد
الموبايل لا يستنتج عنواناً من `.env` أخرى أو logs.

## Baseline VM

في 2026-07-30:

| Tool | الحالة |
| --- | --- |
| Node | `20.20.2` |
| npm | `10.8.2` |
| OpenJDK | `21.0.11` |
| Android SDK / `sdkmanager` / `adb` | غير مثبت |
| system Gradle | غير مثبت؛ سيستخدم المشروع Gradle Wrapper |
| الذاكرة | 15 GiB |
| المساحة المتاحة | أكثر من 300 GiB |

Expo SDK 56 هو خط البداية لأنه يدعم Node 20.19+؛ SDK 57 يحتاج Node 22.13.x.
لا تُرقّ Node أو تثبت Android SDK قبل checkpoint وموافقة النطاق.

## الفروع والـcommits

```bash
git status --short --branch
git rev-parse HEAD
git rev-parse origin/main
git switch feature/mobile-offline
```

الـworktree قد يحتوي تغييرات Acceptance مملوكة لعمل آخر. لا تعدلها ولا
تضمها. Stage ملفات الموبايل صراحة؛ لا تستخدم `git add .`.

ترتيب commits المقترح:

1. `chore: add Tahili mobile offline skill`
2. `docs: define Tahili mobile phase zero`
3. `feat: add mobile device session foundation` — بعد الموافقة فقط
4. `feat: add read-only mobile API contracts`
5. `feat: scaffold encrypted Tahili mobile client`
6. `feat: add read-only offline sync and screens`
7. `test: cover Tahili mobile acceptance gates`

Push إلى `origin/feature/mobile-offline` فقط.

## إعداد البيئات

### App variants

| Variant | package/application ID | transport | البيانات |
| --- | --- | --- | --- |
| development | suffix مثل `.dev` | cleartext إلى development LAN origin فقط | QA صناعية |
| production | ID نهائي منفصل | HTTPS موثوق فقط؛ cleartext denied | غير مسموح حالياً |

يقرأ `app.config.ts` متغيرات build غير السرية:

- `TAHILI_MOBILE_ENV=development|production`
- `TAHILI_MOBILE_API_ORIGIN=<approved origin>`

ثم يضعها في app `extra` أو native config. العنوان عام داخل APK بطبيعته؛ ليس
secret. يجب أن:

- يطابق URL مطلقاً بلا path/query.
- يطابق allowlist البيئة.
- يرفض `http:` في production.
- لا يكون له default إنتاجي أو fallback إلى domain/IP آخر.
- لا يقرأه business logic من نص server-controlled.

الأسرار غير مسموحة في `EXPO_PUBLIC_*`, `extra`, app config، native resources،
Gradle files، أو source.

### Expo updates

- لا EAS project ID.
- لا `expo-updates` endpoint.
- إذا كانت الحزمة transitive، يضبط `updates.enabled=false` ويثبت اختبار أن
  binary لا يطلب Expo servers.
- JS bundle مضمن داخل APK.

## Dependency checkpoint

بعد إغلاق High findings:

1. أنشئ scaffold ثابتاً دون Git side effects خارج المسار.
2. pin Expo SDK 56 والنسخ المتوافقة بـ`npx expo install`.
3. احتفظ lockfile خاصاً بالموبايل ما لم تثبت مراجعة أن root workspace آمن.
4. لا تسمح postinstall غير مفهوم.
5. شغّل:

```bash
npm ci
npx expo-doctor
npx tsc --noEmit
npm audit --json
```

يُشغّل root `npm ci`/TypeScript/tests بصورة مستقلة للتأكد أن mobile toolchain
لم تغيّر تطبيق الويب.

### License review

أنشئ inventory للحزم native وJava/Kotlin/C/C++. راجع خصوصاً SQLCipher
Community attribution وإعادة التوزيع. لا يخرج APK قبل notices المطلوبة.

## Android SDK checkpoint

يتطلب تثبيت Android command-line tools على VM التطوير موافقة منفصلة لأنه
تنزيل toolchain كبير وتغيير بيئة البناء. بعد الموافقة:

- ثبت SDK في مسار تطوير منضبط، لا داخل Git.
- ثبت فقط platform/build-tools المطلوبة لـcompile/target SDK 36.
- اقبل licenses محلياً بعد مراجعتها.
- عرّف `ANDROID_HOME`/`ANDROID_SDK_ROOT` في shell/build environment غير
  committed.
- لا تثبت emulator image إن كان جهاز QA حقيقياً متاحاً؛ وإلا pin صورة واحدة.
- سجل checksums/versions ومصدر التنزيل.

تحقق:

```bash
java -version
sdkmanager --list_installed
adb version
```

## Scaffold checkpoint

المسار المتوقع:

```text
apps/mobile
packages/mobile-contracts
```

بعد تثبيت dependencies:

```bash
cd apps/mobile
npx expo prebuild --platform android
npx expo run:android
```

SQLCipher يحتاج prebuild/native binary ولا يعمل في Expo Go. لا تستخدم
`--clean` بعد وجود تعديلات native غير مولدة إلا بعد diff ومراجعة؛ الأمر يعيد
توليد native directories.

## Development API

- Next.js Route Handlers تحت `/api/mobile/v1`.
- لا Server Actions.
- لا تشغيل API قبل migration/policy الموافقتين.
- لا توجد حالياً علامة QA موثوقة يمكن استنتاجها من الاسم. قبل أول live Mobile
  API يجب اعتماد أحد الخيارين: قاعدة تطوير معزولة تحتوي schema وfixtures
  صناعية فقط، أو ضمان موثق أن قاعدة التطوير كلها QA مع allowlist خادمية من
  user IDs ثابتة في إعداد غير committed. allowlist الحساب وحدها لا تجعل
  بيانات المراجعين QA.
- إلى أن يثبت ذلك، يمنع login/snapshot live ولو كان route جاهزاً.
- كل live check إلى development LAN فقط.
- لا credentials حقيقية في scripts أو fixtures.

Start/release لتطبيق الويب لا ينفذ تلقائياً من مشروع الموبايل. إذا احتاج
checkpoint app-changing dev release، يتبع runbook Tahili المعتاد ويعيد إنشاء
خدمة app فقط؛ لا restart لـPostgreSQL أو MinIO.

## تشغيل الموبايل

### Debug development build

```bash
cd apps/mobile
npx expo prebuild --platform android
cd android
./gradlew assembleDebug
```

الـdebug APK للاختبار الداخلي فقط. لا يسلم لموظف أو يتصل ببيانات حقيقية.

### Release-like internal APK

لا ينفذ قبل إغلاق كل البوابات. signing credentials:

- تولد خارج المستودع.
- keystore خارج `apps/mobile`.
- passwords في user-level `~/.gradle/gradle.properties` أو approved secret
  injection، لا project Gradle files.
- لا تطبع alias/path/password.

```bash
cd apps/mobile/android
./gradlew assembleRelease
```

يفحص APK الناتج قبل التوزيع. لا Google Play ولا EAS Submit في هذه المرحلة.

### iOS

يبقى TypeScript/React Native/config source متوافقاً مع iOS. build موقّع
يتطلب macOS وXcode وApple signing لاحقاً. Linux VM لا يدعي إنتاج IPA.

## SQLCipher verification

اختبار native، لا mock فقط:

1. أول تشغيل ينشئ key في SecureStore.
2. `cipher_version` غير فارغ.
3. canary QA تكتب في DB.
4. نسخة DB/WAL/SHM لا تحتوي canary بـstring scan.
5. DB لا تفتح بمفتاح خاطئ أو بلا مفتاح.
6. restart يفتحها بالمفتاح الصحيح.
7. logout/revoke يحذف key والملفات.
8. reinstall/device transfer لا يعيد cache قابلة للفتح.

لا تحفظ DB أو APK أو extracted files المحتوية QA في Git. test artifacts قصيرة
العمر في `test-results/mobile` أو `/tmp`.

## QA workflow

1. أنشئ fixtures صناعية موسومة بوضوح.
2. سجل counts لنماذج الأعمال المعنية قبل الاختبار.
3. Login بحسابات QA فقط.
4. Sync online.
5. افصل الشبكة وأغلق process.
6. افتح offline واختبر fresh/stale/expired.
7. أعد الشبكة واختبر refresh/reconnect/sync.
8. revoke الجهاز وغيّر `authVersion`/permission/membership في fixture معتمدة.
9. تحقق deny/wipe.
10. قارن business counts بعد الاختبار؛ يجب أن تتطابق.
11. نظف QA فقط بالأداة المعتمدة، dry-run أولاً.

## Network verification

على emulator/جهاز QA:

- راقب destinations دون جمع bodies/headers/tokens.
- اسمح فقط بالـAPI origin الداخلي.
- تحقق عدم اتصال Expo/Firebase/Sentry/Google analytics/remote fonts.
- لا تستخدم packet capture يحتفظ بـPHI أو Authorization.
- استخدم synthetic canaries وmetadata المنقحة.

## بوابات كل checkpoint

نفذ بالترتيب:

1. contract/unit tests
2. API auth/scope tests
3. mobile TypeScript/tests
4. root `npx tsc --noEmit`
5. targeted existing Tahili tests
6. `node scripts/audit-project.mjs` بعد إضافة routes
7. native SQLCipher/wipe tests
8. Android RTL/light/dark/phone/tablet/reconnect/restart
9. root `/login` وsmoke عبر development LAN
10. dependency/license/APK/Git/log scans

لا تسمى المرحلة PASS إذا كان test skipped لغياب SDK/device/HTTPS.

## التوقف والتقرير

بعد كل مرحلة أبلغ:

- ما اكتمل
- ما فشل
- ما بقي
- الاختبارات المنفذة
- commit/push
- أثر النظام الحالي
- تأكيد أن الإنتاج لم يُلمس

عند blocker لا تنشئ mock success أو bypass. شخصه، وثقه، واطلب قراراً منفصلاً.
