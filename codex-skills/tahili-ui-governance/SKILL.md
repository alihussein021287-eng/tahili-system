---
name: tahili-ui-governance
description: Govern every Tahili UI/UX, navigation, responsive, RTL, dark-mode, shared-component, or duplication-removal change. Use automatically before planning, implementing, reviewing, or testing interface work so medical data, treatment workflows, permissions, routes, deep links, and Server Actions remain unchanged.
---

# Tahili UI Governance

Read `/tahili-system/AGENTS.md` and `references/ui-change-gate.md` before editing.

## Non-Negotiable Boundary

- Change presentation and information architecture only.
- Do not change medical data or field meaning, treatment logic, state machines, role transitions, permissions, Prisma, or Server Action behavior.
- Do not delete a route, function, action, tab, deep link, or visible procedure.
- Keep legacy routes when documented for compatibility.
- Stop and split the work into a functional specification if the UI goal requires workflow change.

## Required Process

1. Identify routes, hubs/tabs, roles, permissions, data sources, Actions, and workflow boundary.
2. Capture behavior before editing: URL/query, controls, payload, state transition, and DB/Audit effect.
3. Reuse the existing Design System and central navigation registry.
4. Compare behavior after editing for every affected role, including negative direct URL.
5. Verify desktop/mobile, RTL, light/dark, loading/empty/error, and no overflow.
6. Run targeted tests, TypeScript, and `node scripts/audit-project.mjs`.

Treat hiding an action, changing its label meaning, or moving it beyond normal discovery as a behavior change.
