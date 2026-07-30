# Tahili Mobile Local-first MVP — Implementation Spec

## الحالة والملكية

- الحالة: **Phase 0 complete; implementation blocked by two High findings**
- المالك: الوكيل الرئيسي
- منصة البداية: Android؛ المصدر يبقى متوافقاً مع iOS والتابلت
- البيئة: VM التطوير وبيانات QA صناعية فقط
- production build/deploy: خارج النطاق

## المشكلة

يحتاج موظفو Tahili إلى قراءة عملهم والمراجعين المسموحين داخل شبكة المؤسسة
حتى عند انقطاع مؤقت، من دون Cloud أو نسخة PostgreSQL على الهاتف. النظام
الحالي يبقى المصدر الرسمي، والصلاحية يجب أن تفرض خادمياً قبل خروج البيانات.

## أهداف الدفعة الأولى

- login online وجلسة جهاز قصيرة ومحمية؛
- home حسب الدور و«عملي اليوم»؛
- قائمة وملخص ورحلة وتبويبات القراءة للمراجعين ضمن نطاق معتمد؛
- تنبيهات قراءة؛
- SQLCipher cache بأقل DTOs ومدة صلاحية؛
- manual sync، connection state، stale/expired UX، reconnect، وprocess restart؛
- logout/revocation/expiry مع crypto-shredding محلي؛
- Android APK محلي بعد اجتياز جميع البوابات.

## غير الأهداف

- لا offline business writes؛
- لا صرف/مخزون/مالية/موافقات/إدارة مستخدمين/حذف/تجاوز؛
- لا اعتماد نهائي أو رفع طبي نهائي؛
- لا تغيير workflow أو role/permission semantics؛
- لا Firebase/EAS Cloud/Sentry/telemetry؛
- لا production network أو signing.

## قرارات التصميم

- التطبيق لاحقاً تحت `apps/mobile/**`.
- العقود النقية تحت `packages/mobile-contracts/**`.
- API مستقرة تحت `/api/mobile/v1/**`.
- لا Server Actions أو Prisma/server-only code في التطبيق/العقود.
- snapshot قراءة authoritative ومحدودة، ثم staging وatomic swap.
- access credential memory-only؛ refresh وDB key في SecureStore.
- SQLCipher مطلوب، وفتح plaintext ممنوع.
- origin من build configuration allowlisted؛ لا IP/domain داخل business logic.
- Android build محلي؛ iOS signed build يحتاج macOS/Xcode وApple signing لاحقاً.

## بوابات القرار الحالية

لا يبدأ implementation حتى اعتماد وإغلاق:

1. `MOBILE_DEVICE_SESSION_SCHEMA_REQUEST.md`
2. `MOBILE_PATIENT_SCOPE_POLICY_REQUEST.md`
3. مصدر بيانات development صناعي-only قابل للإثبات قبل live login/snapshot.

كما يبقى production محظوراً حتى HTTPS داخلي موثوق على الجهاز. HTTP التطوير
مقيد بحسابات وبيانات QA.

## تسلسل التنفيذ بعد الموافقة

### Checkpoint 1 — الأساس الخادمي

- migration المعتمدة لجلسة الجهاز؛
- patient-scope policy وtests؛
- contracts/envelopes/Zod schemas؛
- login/refresh/logout/bootstrap/snapshot read-only APIs؛
- rate limits وredacted durable audit.
- branch محدود في `src/proxy.ts` للـMobile API مع بقاء host/Request-ID guards
  وعدم تغيير web auth؛

شرط الخروج: Security Review 0 Critical/0 High، contracts/API/policy tests PASS،
ولا تغير counts.

### Checkpoint 2 — scaffold والتخزين

- Expo SDK/React Native pins وlockfile؛
- dependency/license/audit review؛
- local native prebuild بلا Cloud؛
- SQLCipher وSecureStore وinstall sentinel وwipe tests؛
- dev/prod config separation وnetwork allowlist.

شرط الخروج: cipher verification وlogout/revoke wipe PASS، ولا secrets أو
external endpoints.

### Checkpoint 3 — القراءة والمزامنة

- auth lock/home/my-work/patients/journey/tabs/notifications؛
- full bounded snapshot staging/swap؛
- TTL/lease/stale/expired states؛
- manual sync/retry/reconnect/process restart؛
- Arabic RTL وlight/dark وphone/tablet.

شرط الخروج: offline start/reconnect/scope invalidation tests PASS.

### Checkpoint 4 — النظام وAPK

- TypeScript وunit/integration/contracts/API/security tests؛
- targeted current-system regressions؛
- `/login` وdevelopment LAN smoke؛
- Android emulator/device matrix؛
- local release-like QA APK وفحص contents/network/secrets.

شرط الخروج: كل صف required في `docs/MOBILE_ACCEPTANCE_MATRIX.md` PASS.

## ملكية الملفات

| المالك | النطاق |
| --- | --- |
| الوكيل الرئيسي | القرارات، docs، الدمج، commits، والتقارير |
| mobile-implementer | `apps/mobile/**` فقط |
| API implementation owner | `packages/mobile-contracts/**`, `src/lib/mobile/**`, `src/app/api/mobile/v1/**` |
| architecture-agent | مراجعة read-only |
| security-agent | مراجعة read-only |
| test-agent | اختبارات بعد checkpoint ومراجعة الأمن |

لا يعدل وكيلان الملف نفسه بالتوازي.

## خطة commits

1. `chore: add Tahili mobile offline skill`
2. `docs: define Tahili mobile phase zero`
3. بعد الموافقات فقط: schema/policy، contracts/API، mobile scaffold، secure
   storage/sync، screens، ثم test hardening في commits مستقلة.

كل commit يراجع نطاقه، ولا merge إلى `main` ولا production deploy دون طلب
صريح.

## مراجع التنفيذ

- `docs/MOBILE_ARCHITECTURE.md`
- `docs/MOBILE_OFFLINE_SYNC.md`
- `docs/MOBILE_SECURITY_PRIVACY.md`
- `docs/MOBILE_DEVELOPMENT_RUNBOOK.md`
- `docs/MOBILE_ACCEPTANCE_MATRIX.md`
- `docs/MOBILE_PHASE2_WRITE_PLAN.md`
- `codex-skills/tahili-mobile-offline/SKILL.md`
