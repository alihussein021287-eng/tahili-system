# Tahili Mobile Offline Sync

## المبدأ

قاعدة الهاتف ليست نسخة من PostgreSQL. هي cache قراءة مشفرة، صغيرة، مرتبطة
بجلسة جهاز ونطاق خادمي، وتنتهي صلاحيتها تلقائياً. لا تنشئ Phase 1 أي business
write ولا تعتمد على last-write-wins.

## حالة التصميم

- Phase 1 sync: **authoritative bounded snapshot**
- incremental cursors: مصممة لكن مؤجلة حتى وجود change log/tombstones موثوقة
- business outbox: schema محلي مسموح، enqueue/dispatch محظوران
- التنفيذ: متوقف حتى حل device-session وpatient-scope High findings

## لماذا snapshot كامل في Phase 1

معظم جداول Tahili لا تقدم change log موحداً أو tombstones لكل حذف/سحب صلاحية.
Cursor يعتمد على `updatedAt` وحده لا يخبر الجهاز أن سجلاً حذف أو خرج من نطاقه.
لذلك delta sync قد يُبقي PHI لم يعد المستخدم مخولاً بها.

الدفعة الأولى تستخدم snapshot:

1. الخادم يعيد فقط السجلات المصرح بها للمستخدم الحالي.
2. النتيجة محدودة بعدد وحجم ثابتين، وليست dump.
3. التطبيق يكتبها إلى staging داخل SQLCipher.
4. يتحقق من العقود والعدد والchecksum/manifest.
5. يبدل snapshot النشطة atomically.
6. يحذف snapshot السابقة وكل سجل لم يعد ضمن النطاق.

إذا تجاوزت البيانات الحد، يفشل sync برسالة واضحة ولا يستبدل cache صالحة بنتيجة
جزئية. تقليل النطاق أو تصميم delta موثوق يكون طلباً مستقلاً.

## عقد snapshot

الشكل المنطقي:

```ts
type MobileSnapshot = {
  schemaVersion: 1;
  snapshotId: string;
  generatedAt: string;
  expiresAt: string;
  serverTime: string;
  scopeFingerprint: string;
  actorVersion: {
    authVersion: number;
    permissionVersion: string;
  };
  counts: Record<string, number>;
  data: {
    home: MobileHomeDto;
    myWork: MobileWorkItemDto[];
    patients: MobilePatientSummaryDto[];
    journeys: MobilePatientJourneyDto[];
    tabs: MobilePatientTabDto[];
    notifications: MobileNotificationDto[];
  };
};
```

المعرفات والحقول الفعلية تحددها Zod schemas في
`packages/mobile-contracts`. لا توجد Prisma types في العقد.

### Record version

كل record يحمل:

- `recordVersion`: قيمة خادمية مستقرة، مبدئياً ISO `updatedAt` مع `id` حيث
  يوجد `updatedAt`.
- `fetchedAt`
- `expiresAt`
- `snapshotId`
- `scopeFingerprint`

للنماذج التي لا تملك `updatedAt`، يستخدم server projection version مشتقاً من
آخر timestamp قانوني وحقول الحالة اللازمة فقط. لا يُستخدم hash يحتوي PHI في
logs أو telemetry.

## سياسة البيانات الدنيا

لا يعمل sync كبحث شامل:

- `my-work`: العناصر التي تعود للمستخدم/الدور والنطاق الحالي فقط، مع حد
  ثابت.
- patients: المراجعون المشار إليهم في `my-work` أو نتيجة بحث/فتح حديثة
  مصرح بها، وبحد أقصى يحدد قبل التنفيذ.
- patient summary: رقم ملف/اسم عرض والحقول الضرورية للشاشة فقط؛ لا phone,
  address, notes, diagnosis text أو file content ما لم تتطلب الشاشة والصلاحية
  ذلك صراحة.
- journey: المراحل المشتقة والسبب المنقح، لا السجلات الخام.
- tabs: التبويبات المفتوحة والمصرح بها فقط، لا prefetch لجميع التبويبات.
- notifications: المستهدفة للمستخدم/دوره والتي يجيز
  `canOpenNotification` رابطها.
- files: لا تخزن ملفات أو thumbnails طبية في Phase 1.

لا يصل record إلى response ثم يفلتر في الموبايل؛ scope يطبق داخل query.

## TTL والـoffline lease

القيم الأولية المقترحة، وتثبت بالاختبارات قبل اعتمادها:

| العنصر | TTL |
| --- | ---: |
| access token | 5–10 دقائق |
| refresh/device session | حد أقصى لنوبة عمل معتمدة؛ مقترح 8 ساعات |
| offline authorization lease | 8 ساعات من آخر تحقق online |
| `my-work` والتنبيهات | 30 دقيقة fresh، ثم stale حتى نهاية lease |
| patient summary/journey/tabs | 24 ساعة كحد بيانات، لكن لا تتجاوز lease |

مدة الاستخدام الفعلية:

```text
effectiveExpiry =
  min(record.expiresAt, snapshot.expiresAt, offlineLeaseExpiresAt, sessionExpiry)
```

- بعد fresh TTL: تعرض شارة «البيانات قديمة» وزر sync.
- بعد effective expiry: لا تعرض PHI، ويقفل التطبيق حتى تحقق online.
- لا يمدد restart أو تغيير ساعة الجهاز أو refresh محلي مدة lease.
- يحسب الخادم timestamps؛ يخزن التطبيق monotonic receipt time للدفاع عن
  تغيير ساعة الجهاز حيث تسمح المنصة.

## الاتصال وإعادة المحاولة

حالة الشبكة مؤشر فقط؛ النجاح الحقيقي هو اتصال API المعتمد:

1. راقب تغير الاتصال.
2. نفذ probe قصيراً إلى API origin المحدد.
3. عند النجاح، refresh عند الحاجة ثم sync.
4. استخدم exponential backoff مع jitter وحد أعلى.
5. لا تكرر login أو refresh بالتوازي؛ استخدم single-flight.
6. `Retry-After` من `429/503` مقدم على backoff المحلي.
7. زر المزامنة اليدوي يحترم rate limit ولا يلغي sync جارية.

الحالات الظاهرة: `online`, `offline`, `syncing`, `stale`, `expired`,
`reauth-required`, `revoked`, و`error`.

## atomic apply

التسلسل المحلي:

```text
download -> Zod validate -> begin transaction
  -> clear staging(snapshotId)
  -> insert records with bound parameters
  -> verify manifest/counts
  -> set activeSnapshotId
  -> purge old snapshots
commit -> publish UI state
```

- استخدم prepared statements/bound parameters.
- لا تبنِ SQL من server strings.
- لا تضع snapshot في ملف JSON plaintext مؤقت.
- cancel/network failure يترك active snapshot السابقة.
- process death في staging تنظف عند الإقلاع.
- checksum ليس حارس صلاحية؛ TLS والعقد والجلسة هي الحدود الأمنية.

## سحب الصلاحية والنطاق

عند كل sync يقارن التطبيق `scopeFingerprint`:

- إذا تغير، يبني snapshot كاملة جديدة ولا يدمجها مع القديمة.
- إذا رد الخادم `401`, `device_revoked`, `refresh_reuse`,
  `account_disabled`, أو `auth_version_changed`: ينفذ wipe.
- إذا رد `scope_changed`: يقفل القراءة، يمسح snapshot القديمة، ثم يطلب
  snapshot جديدة.
- إذا تعذر الاتصال، تنتهي lease محلياً ولا تبقى البيانات قابلة للعرض إلى
  أجل غير محدود.

لا يمكن إلغاء جهاز مسروق وهو offline فوراً؛ الحد الأقصى للمخاطرة هو مدة lease
المعتمدة مع قفل التطبيق والتشفير. يعود المنع فور أول اتصال أو انتهاء lease.

logout يختلف عن server-initiated revocation: طلب المستخدم يمسح credential
والمفتاح وDB محلياً فوراً حتى بلا شبكة. محاولة revoke الخادم best-effort قبل
المسح إن أمكن؛ عند فشلها لا يخزن pending revoke ولا يدعي نجاح الإلغاء
الخادمي، وتبقى الجلسة حتى absolute expiry أو إلغاء إداري.

## تصميم cursor المؤجل

إذا أضيف change log/tombstones لاحقاً، يكون cursor:

```ts
type EntityCursor = {
  schemaVersion: 1;
  entity: MobileEntity;
  scopeFingerprint: string;
  afterVersion: string;
  afterId: string;
};
```

قواعده:

- opaque للعميل لكنه غير موثوق خادمياً.
- Zod strict، طول محدود، entity allowlist، وpage size ثابت.
- ترتيب deterministic: `recordVersion ASC, id ASC`.
- cursor مربوط بـ`scopeFingerprint`; يرفض عند تغيره.
- reauthorization لكل page وdirect-ID.
- response يحمل `nextCursor`, `hasMore`, وtombstones.
- tombstone لا يحتوي PHI؛ فقط entity/opaque id/version.
- لا cursor مشترك بين مستخدمين أو أجهزة.
- لا `offset` للبيانات المتغيرة.

قبل تفعيله يجب إثبات حذف، archive، permission change، center membership
change، reassignment، وdevice revoke.

## outbox وidempotency

تنشأ الجداول المحلية التالية فقط للتوافق المستقبلي:

```text
outbox(id, type, payloadCiphertext, idempotencyKey, expectedVersion,
       createdAt, state, attempts)
```

في Phase 1:

- قائمة الأنواع المسموحة فارغة.
- repository يرمي `READ_ONLY_PHASE` عند enqueue.
- network layer لا يملك endpoint لإرسال business writes.
- اختبار ثابت يثبت أن outbox تبقى صفر.

Phase 2 يحتاج:

- idempotency key عشوائي لكل intent ويخزن خادمياً مدة معتمدة.
- `expectedVersion` أو `If-Match`.
- transaction خادمية وأثر audit.
- `409 Conflict` مع current version وresolution options منضبطة.
- حل يدوي/وظيفي حسب نوع العملية، لا last-write-wins.
- قائمة عمليات مسموحة صريحة؛ الصرف/المالية/الاعتماد/الحذف تبقى ممنوعة.

راجع `docs/MOBILE_PHASE2_WRITE_PLAN.md`.

## الأخطاء والخصوصية

يسجل فقط:

- Request ID منقح
- route template
- status/error code
- مدة وcounts مجمعة
- snapshot ID عشوائي إن اعتُمد أنه غير رابط للمريض

يحظر username، patient ID، file number، URL خام، query، request/response body،
token، device installation ID، وأي clinical value.

## اختبارات القبول

- snapshot خارج النطاق لا تصل إلى response أصلاً.
- direct patient ID خارج النطاق = 404 أو 403 بلا payload.
- snapshot ناقصة/فاسدة لا تستبدل cache صالحة.
- scope change يحذف البيانات السابقة.
- DB/WAL/SHM لا تكشف canary plaintext.
- process restart offline يفتح snapshot صالحة فقط.
- expiry يقفل PHI.
- reconnect ينفذ single refresh وsync واحداً.
- outbox business writes مرفوضة دائماً.
- counts لنماذج الأعمال قبل/بعد Phase 1 متطابقة.
