# UI Change Gate

Shared project references:

- `/tahili-system/docs/MEDICAL_WORKFLOW_BOUNDARIES.md`
- `/tahili-system/docs/UI_INFORMATION_ARCHITECTURE.md`
- `/tahili-system/docs/UI_DUPLICATION_REGISTER.md`
- `/tahili-system/docs/FUTURE_UI_ROADMAP.md`
- `/tahili-system/ROLES_PERMISSIONS.md`
- `/tahili-system/ACCEPTANCE_MATRIX.md`

Before commit, require:

- no unintended diff in Actions, Prisma, permissions, or workflow rule files;
- identical form names, values, URLs, queries, Actions, state and Audit effects;
- role matrix and negative direct-route checks;
- legacy redirects and notification links;
- desktop/mobile, RTL, light/dark, loading/empty/error;
- zero unclassified pages in the deterministic audit.
