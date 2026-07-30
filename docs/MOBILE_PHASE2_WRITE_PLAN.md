# Tahili Mobile Phase 2 Offline Write Plan

## الحالة

**Design only — غير معتمد للتنفيذ.**

Phase 1 read-only. لا endpoint أو زر أو outbox dispatcher يغير business state.
هذا المستند يحدد شروط طلب مستقبلي منفصل ولا يغير workflow أو Prisma أو
الصلاحيات الحالية.

## Non-goals الدائمة ما لم يوجد طلب عالي المخاطر مستقل

- صرف الدواء أو تعديل المخزون/الدفعات/FEFO
- المالية، الدفع، الصرفيات، والموافقات
- إدارة المستخدمين أو الأدوار أو الصلاحيات
- الحذف، archive، restore، أو admin override
- اعتماد التقرير الطبي النهائي
- رفع/اعتماد الملفات الطبية النهائي
- قبول/إلغاء/نقل workflow يعتمد فوراً على موظف آخر
- تغيير رقود/سرير أو جلسة مشتركة آنياً

هذه العمليات لا تدخل Phase 2 العامة تلقائياً.

## شروط فتح Phase 2

يلزم قبل أول write:

1. Phase 1 acceptance كلها PASS على جهاز حقيقي.
2. device-session/revocation وpatient-scope في production quality.
3. HTTPS داخلي موثوق.
4. اقتراح عملية واحدة محددة، لا «كل النماذج offline».
5. قراءة workflow/Action/state machine والصلاحيات والتدقيق المرتبطة.
6. threat model وfailure modes وconflict owner.
7. spec منفصل وموافقة صريحة.
8. Prisma migration صريحة إن احتاج idempotency/version persistence.
9. tests قبل التنفيذ، بما فيها concurrent users وreplay.

## اختيار أول write

يبدأ بأقل عملية خطراً إذا وُجدت حاجة تشغيلية، مثل draft شخصي غير طبي ولا
ينقل workflow. لا تُختار العملية لأنها سهلة تقنياً؛ يجب أن يكون:

- المالك مستخدماً واحداً.
- لا يحجز مورداً مشتركاً.
- لا يغير inventory/amount/approval.
- قابلة للإلغاء بلا أثر طبي.
- لها server validation كاملة.
- لها version موثوق وaudit منقح.

إن لم توجد عملية تحقق هذه الشروط يبقى التطبيق read-only.

## outbox contract

كل intent محلي:

```ts
type OutboxIntent = {
  localId: string;
  operation: ApprovedOperation;
  resourceId: string | null;
  payload: ApprovedPayload;
  idempotencyKey: string;
  expectedVersion: string | null;
  actorScopeFingerprint: string;
  createdAt: string;
  state: "pending" | "sending" | "conflict" | "accepted" | "rejected";
  attempts: number;
  lastErrorCode: ApprovedErrorCode | null;
};
```

- payload مشفر داخل SQLCipher؛ لا plaintext file.
- `operation` enum allowlist مغلق.
- idempotency key 128/256-bit عشوائي لكل intent ولا يعاد استخدامه.
- لا username/patient ID/payload في logs.
- dispatcher يرسل بالتسلسل لكل resource، وبحد concurrency عالمي.
- retry فقط للأخطاء المصنفة retryable.
- `400/401/403/404/409/410/422` لا يعاد عشوائياً.
- `401/device_revoked` أو refresh replay يوقف outbox، يلغي كل intents المحلية،
  وينفذ wipe فوراً وبلا محاولة حفظ أو رفع payload. حماية الجهاز مقدمة على
  استرجاع كتابة لم تعتمد خادمياً.

## server idempotency

الخادم يحتاج durable record:

```text
actor + device session + operation + idempotency key
request hash + result code + resource/version
createdAt + expiresAt
```

داخل transaction واحدة:

1. تحقق session/device/user/authVersion.
2. تحقق permission/scope/current workflow state.
3. ابحث عن idempotency key.
4. إذا موجود وبنفس request hash، أعد النتيجة الأصلية.
5. إذا موجود وhash مختلف، ارفض security conflict.
6. تحقق `expectedVersion`.
7. طبق Action/domain service المعتمد، لا query مكرر من الموبايل.
8. اكتب business audit وidempotency result.
9. commit ثم response.

لا تحفظ token أو raw payload في idempotency record.

## record version

الأفضل version integer يزداد transactionally في resource إذا كانت العملية
تحتاج optimistic concurrency. `updatedAt` قد يكفي فقط بعد إثبات:

- كل write يغيره.
- precision لا تسبب collision.
- لا توجد writes خارج Prisma تتجاوزه.

إذا احتاج model حقل version، فهذا Prisma change منفصل. لا تستخدم client
timestamp أو last fetched time كنسخة موثوقة.

## conflict policy

لا last-write-wins. الخادم يعيد:

```ts
type ConflictResponse = {
  code: "VERSION_CONFLICT" | "STATE_CHANGED" | "SCOPE_CHANGED";
  currentVersion: string;
  safeCurrentProjection: unknown;
  allowedResolutions: ("discard_local" | "review_and_resubmit")[];
};
```

### القواعد

- `SCOPE_CHANGED`: لا يعرض current record؛ يلغي intent ويحدث/wipes scope.
- `STATE_CHANGED`: لا merge تلقائي؛ يفتح نسخة قراءة ويطلب إعادة القرار.
- `VERSION_CONFLICT`: merge مسموح فقط لحقول مستقلة حددها spec.
- clinical text لا يدمج آلياً.
- duplicate intent يستخدم النتيجة الأصلية.
- delete/approve/pay/dispense لا يملك حل offline.
- conflict لا يحل بتغيير role أو permission.

## authentication and expiry أثناء outbox

- إنشاء intent لا يمدد offline lease.
- بعد lease expiry يقفل التطبيق؛ لا يرسل حتى login/refresh ناجح.
- قبل dispatch يعاد sync للresource version إذا فرض spec ذلك.
- permission/device revoke يرفض الخادم حتى لو intent قديم.
- logout الافتراضي يحذف outbox. إذا كان منع فقد draft مطلوباً، يحتاج قرار
  UX/Privacy منفصل؛ لا يحتفظ به خفية بعد logout.

## audit

حدث business النهائي يكتبه Action الحالي وفق contractه. mobile transport
audit منفصل ويحتوي فقط:

- operation category allowlisted
- accepted/duplicate/conflict/rejected
- Request ID
- device session opaque record ID إن كان معتمداً
- latency/attempt count bounded

لا payload أو clinical value أو raw resource identifier في telemetry.

## API shape

بعد الموافقة فقط:

```text
POST /api/mobile/v2/intents/:operation
GET  /api/mobile/v2/intents/:idempotencyKey/status
```

قد يبقى version `/v1` إذا كانت الإضافة backward-compatible؛ القرار ضمن API
review. لا تستخدم Server Actions مباشرة. Route Handler يستدعي domain service
نفسها أو extracted service مع parity tests.

## اختبارات إلزامية لكل operation

- authorized success online
- unauthorized role/permission/scope/direct ID
- offline create ثم reconnect
- duplicate delivery قبل/بعد response loss
- concurrent web/mobile update
- version/state/scope conflict
- token expiry/refresh replay/device revoke وسط dispatch
- process death قبل/بعد local state transitions
- server transaction rollback
- audit exactly once
- no forbidden logs
- root web Action behavior unchanged
- business counts/effects يطابق spec بالضبط

## قرار go/no-go

يُقبل operation واحدة فقط إذا:

- 0 Critical / 0 High.
- لا workflow/permission expansion ضمني.
- idempotency durable وconcurrency tests PASS.
- conflict resolution مفهوم للمستخدم العربي ولا يخفي فقدان بيانات.
- wipe/logout/expiry policy محسومة.
- Web وMobile يستخدمان نفس domain invariants.
- موافقة صريحة على migration/release إن وجدت.
