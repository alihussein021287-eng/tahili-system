# Tahili Environments

هذا الملف هو المرجع المركزي لعناوين الوصول والفحص. لا تستنتج عنواناً بديلاً من DNS أو Caddy أو إعداد قديم.

| البيئة | وصول LAN والفحص الحي | الدومين الرسمي | مسار الدومين |
| --- | --- | --- | --- |
| التطوير | `http://192.168.17.20:3000` | `https://tahili.elaqat.site` | FRP إلى VPS ثم Caddy |
| الإنتاج | `http://192.168.17.228:3000` | `https://tah.elaqat.site` | DNS MikroTik ثم Caddy محلي |

## إعدادات المصادقة

لكل بيئة:

- `NEXTAUTH_URL` هو الدومين الرسمي HTTPS ولا يتغير إلى IP.
- `NEXTAUTH_URL_INTERNAL` هو عنوان LAN لنفس البيئة.
- `NEXTAUTH_ALLOW_HTTP_LOGIN=true` يسمح بمسار LAN المعتمد فقط.
- `AUTH_TRUST_HOST=true` يعمل بعد تحقق التطبيق من Host/Proto مقابل المصفوفة الثابتة.
- الدومين يستخدم `__Secure-next-auth.session-token` مع `Secure` وبدون `Domain`.
- IP يستخدم `next-auth.session-token` بدون `Secure` وبدون `Domain`.
- لا تقبل المصادقة Host أو callback خارج زوج البيئة المحدد.

## وضع loopback المحلي الاختياري

[دليل التشغيل المحلي على Windows باستخدام Docker](docs/LOCAL_WINDOWS_DOCKER.md)

- يُفعّل فقط عند `TAHILI_LOCAL_ACCESS=true`، ولا يغيّر مصفوفة التطوير والإنتاج أعلاه.
- `TAHILI_LOCAL_PORT` مطلوب: عدد صحيح من `1` إلى `65535`.
- يجب أن يكون كل من `NEXTAUTH_URL` و`NEXTAUTH_URL_INTERNAL` أصل HTTP على `localhost` أو `127.0.0.1` وبالمنفذ المحدد، مع `NEXTAUTH_ALLOW_HTTP_LOGIN=true` و`AUTH_TRUST_HOST=true`.
- يقبل الطلبات فقط على `localhost:<port>` أو `127.0.0.1:<port>`؛ يجب أن يطابق `X-Forwarded-Host` قيمة `Host` إن وُجد، وأن يكون `X-Forwarded-Proto` هو `http` إن وُجد.
- يستخدم `next-auth.session-token-<port>-local` بدون `Secure` ومع `HttpOnly` و`SameSite=Lax` وبدون `Domain`؛ مثل `next-auth.session-token-3000-local` و`next-auth.session-token-3001-local`. اللاحقة تمنع التباس بادئة المنفذ `3001` مع `30010` في NextAuth. المتصفح يشارك cookies عبر المنافذ، لذلك تقرأ كل نسخة اسمها فقط، بما فيه الأجزاء، ويُنشأ alias داخلي لطلب الخادم فقط. يلزم تسجيل الدخول مجدداً بعد الانتقال من الاسم المحلي القديم.
- لا يقبل Host خاصاً بـLAN أو الدومينات أو IPv6 أو HTTPS في هذا الوضع. لكن `Host` قابل للتزوير ولا يثبت مصدر الاتصال: تقييد loopback يعتمد على ربط التطبيق في `docker-compose.local.yml` حصراً بـ`"127.0.0.1:${APP_PORT}:3000"`، مع بقاء PostgreSQL وMinIO دون منافذ منشورة. لا تستبدل الربط بـ`0.0.0.0` أو `"${APP_PORT}:3000"` ولا تستخدم host networking.
- غياب العلم أو أي قيمة غير `true` يُبقي التحقق الحالي للتطوير والإنتاج ويرفض loopback.

لكل نسخة ملف `.env` مستقل مأخوذ من `.env.local.example`، واسم مشروع Compose مستقل. شغّل الملف المحلي وحده (`-f docker-compose.local.yml`) مع `-p tahili-original` أو `-p tahili-dev` في مجلد النسخة المناسبة. استبدل القيم الوهمية بأسرار عشوائية مستقلة؛ **يجب ألا تتساوى قيمتا `NEXTAUTH_SECRET` أبداً** ولا تنسخ السر من نسخة إلى الأخرى. أسماء cookies تمنع خلط جلسات المتصفح، والأسرار المختلفة تمنع قبول JWT من قاعدة بيانات النسخة الأخرى حتى عند تغيير اسم cookie يدوياً.

`tahili-original`:

```dotenv
APP_PORT=3000
NEXTAUTH_SECRET=change-me-tahili-original-secret-at-least-32-characters
```

`tahili-dev` (في ملفها الخاص فقط):

```dotenv
APP_PORT=3001
NEXTAUTH_SECRET=change-me-tahili-dev-secret-at-least-32-characters
```

## قاعدة الفحص

- كل health check أو smoke test أو Playwright بعد النشر يستخدم عنوان LAN فقط.
- لا تستخدم `localhost` ما دام عنوان LAN متاحاً.
- لا ترسل فحصاً حياً إلى الدومين، ولا تفحص DNS أو FRP أو Caddy إلا بطلب صريح.
- عند وجود طلب صريح لتشخيص الدومين، يجوز فحص الدومين وDNS وFRP وCaddy الخاصة بالبيئة المطلوبة فقط؛ تبقى الفحوص الاعتيادية عبر IP.
- فشل DNS أو الدومين ليس مانعاً لفحص التطبيق الاعتيادي.

## مسار بروكسي التطوير

- اتصال FRP من `192.168.17.20` إلى `62.171.173.4` يجب أن يبقى عبر routing table `main`.
- يجب أن يحافظ بروكسي التطوير على `Host: tahili.elaqat.site` و`X-Forwarded-Host: tahili.elaqat.site` و`X-Forwarded-Proto: https`.
- أي تغيير في Caddy أو FRP لتشخيص دومين التطوير يقتصر على site/proxy الخاص بـ`https://tahili.elaqat.site`.

## الفصل بين البيئتين

لا تنسخ بين التطوير والإنتاج: `.env`، الأسرار، كلمات المرور، ملفات الاعتماد، قواعد البيانات، uploads، backups، volumes، إعدادات DNS/FRP/Caddy، أو عنوان `NEXTAUTH_URL_INTERNAL` و`TAHILI_LAN_IP`.

المنفذ `3000` مخصص للـLAN وloopback فقط. يربط compose هذين العنوانين صراحة ولا ينشئ forwarding عاماً.

## Resource Audit And Hygiene

- baseline التطوير غير السري في `docs/ENVIRONMENT_BASELINE.md`.
- أي تنظيف يبدأ بجرد read-only للمسارات والأحجام وDocker usage، ثم قائمة حذف صريحة.
- لا تنظف VM أخرى بالاستنتاج أو بنفس الجلسة. الإنتاج يحتاج موافقة صريحة وbaseline جديداً عبر IP الإنتاج فقط.
- احمِ دائماً volumes وDB وMinIO وuploads وbackups وcredentials وQA data والصورة العاملة. لا تستخدم `docker system prune -a` بصورة عمياء.
