---
name: tahili-environment-hygiene
description: Inspect Tahili VM hardware, software, Docker usage, logs, caches, images, and temporary artifacts, then clean verified-safe development resources. Use for resource audits, disk cleanup, image/cache cleanup, VM health baselines, and environment hygiene; always separate development from production.
---

# Tahili Environment Hygiene

Read `/tahili-system/ENVIRONMENTS.md`, `RUNBOOK.md`, and `references/cleanup-policy.md`.

## Workflow

1. Confirm the environment and Git status. Never infer production approval.
2. Run a read-only inventory first: absolute path, age, size, owner/use, and reclaimable estimate.
3. Identify active container image IDs and explicitly name images to retain.
4. Present or record the exact deletion set.
5. Delete only verified safe artifacts. Never use blind `docker system prune -a`.
6. Re-measure disk/Docker usage and verify services, `/login`, migrations, and logs.
7. Report deleted items, retained images, and reclaimed space.

Never delete volumes, databases, MinIO data, uploads, backups, credentials, QA data, Git objects, migrations, active logs, the running image, or the retained stable image. Never apply one VM's cleanup decision to another VM.
