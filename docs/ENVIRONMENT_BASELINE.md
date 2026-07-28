# Development Environment Baseline

اللقطة: 2026-07-28 بعد إغلاق Stage 10، VM التطوير فقط. لا تحتوي أسراراً أو بيانات مرضى. أعد القياس بعد أي تنظيف أو تغيير بنية تحتية.

## Status

| المجال | القياس | التقييم |
| --- | --- | --- |
| CPU | 80 vCPU، Intel Xeon Gold 6230، load `0.52/0.47/0.79` | جاهز |
| RAM | 157 GiB، available 113 GiB | جاهز |
| Swap | 8 GiB، مستخدم قرابة 967 MiB | تحذير منخفض؛ راقب فقط |
| Disk | 492 GiB، مستخدم 130 GiB (28%)، متاح 337 GiB | جاهز |
| Inodes | 5% مستخدم | جاهز |
| Network | `eth0=192.168.17.20/24`, `eth1=10.220.170.20/24`; default عبر `192.168.17.1` | جاهز؛ الفحص الحي عبر eth0 فقط |
| OS/kernel | Ubuntu 24.04.4 LTS؛ kernel Proxmox `7.0.12-1-pve` | جاهز |
| Docker | 29.5.3؛ Compose 5.1.4 | جاهز |
| Node/npm | Node 20.20.2؛ npm 10.8.2 | جاهز |
| Next/Prisma | Next 16.2.10؛ Prisma 6.19.3 | جاهز؛ لا تنفذ major upgrade ضمن UI |
| PostgreSQL | 16.14؛ 16 migrations مطبقة | جاهز |
| MinIO | RELEASE.2025-09-07 | جاهز |
| ClamAV | 1.5.3؛ signatures 28072 | جاهز |
| LibreOffice | 25.8.1.1 داخل app image | جاهز |
| Containers | 17 خدمة app/monitoring `running`، restart 0؛ healthchecks المتاحة healthy | جاهز |
| Docker storage | images 115.2 GB؛ build cache 94.75 GB؛ reclaimable معلن 21.4/47.99 GB | احتفظ بالـcache؛ لا prune عام |
| Logs | app قرابة 11 KiB؛ Loki قرابة 294 MiB؛ البقية صغيرة | تحذير؛ اضبط rotation لاحقاً ولا تحذف log نشط |
| Backups | Stage 10 custom dump + MinIO/uploads archive تحت `/var/backups/tahili`؛ restore drill PASS | جاهز؛ لا تحذف |
| OOM/disk errors | لا نتائج حديثة في فحص kernel المحدد | جاهز |

## Cleanup Result (2026-07-28)

| القياس | قبل | بعد |
| --- | ---: | ---: |
| filesystem used | 167 GiB (36%) | 130 GiB (28%) |
| filesystem available | 300 GiB | 337 GiB |
| Docker images | 158.7 GB | 115.2 GB |
| build cache | 94.75 GB | 94.75 GB (لم يُنفذ prune عام) |
| Tahili app tags | 23 قديمة + 2 محمية | 2 |

المساحة المسترجعة على filesystem قرابة **37 GiB**. حُذفت tags تطبيق قديمة مثبتة غير مستخدمة و7 مجلدات `/tmp/tahili-*` مؤقتة فقط؛ لم يُحذف build cache أو volume أو backup أو test-results. بقيت:

- `tahili-system-app:latest` / image `7ae316e8…` (الصورة العاملة، revision التطبيق `af4bd33…`).
- `tahili-system-app:943292a26c70` / image `450e50d8…` (rollback المحدد الوحيد).

كل الحاويات الـ17 بقيت عاملة، وكل volumes الـ11 بقيت active. `/login=200` وSmoke `17/17`، migrations بقيت 16 ومحدثة، وapp/db/MinIO/ClamAV والمراقبة بقيت restart 0 بلا أخطاء تطبيق حديثة.

## Protected Assets

- كل Docker volumes وقواعد PostgreSQL وMinIO وuploads وbackups.
- `/root/tahili-role-acceptance-credentials.tsv` وأي اعتماد آخر.
- QA users/patients و`qa-mapping.tsv` والتقرير النهائي الأخير.
- image التطبيق العاملة وآخر الصور المستقرة المحددة قبل التنظيف.
- Git objects والمشروع وmigrations والمهارات.

## Production Baseline Checklist (Not Executed)

يتطلب موافقة إنتاج صريحة وجولة مستقلة:

- [ ] اقرأ `ENVIRONMENTS.md` و`PRODUCTION_CHECKLIST.md`.
- [ ] استخدم `http://192.168.17.228:3000` فقط.
- [ ] اجمع CPU/RAM/disk/inodes وDocker usage دون أسرار.
- [ ] سجل services/images/restarts/health وmigrations.
- [ ] سجل counts فقط قبل أي تغيير.
- [ ] افحص `/login` وAdmin routes والlogs عبر IP.
- [ ] نفذ dry-run تنظيف مستقل يحمي DB/MinIO/uploads/backups/credentials.
- [ ] لا تلمس domain/DNS/FRP/Caddy/MikroTik.
