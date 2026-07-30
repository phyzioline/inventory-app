# Inventory QA & Audit AI Team

منظومة مراجعة مستمرة لمشروع **inventory-app فقط** (مستقل عن Physioline الرئيسي).

| | |
|---|---|
| Repo | `github.com/phyzioline/inventory-app.git` |
| Path | `/home/phyzioline-inventory/htdocs/inventory.phyzioline.com` |
| Prod DB | `phyzioline_inventory` — never wipe |
| Test DB | `phyzioline_inventory_test` only |
| Architecture | `app/Application` · `Domain` · `Infrastructure` · `Presentation` + SPA `resources/frontend` |
| No `Modules/` | Correct — that pattern belongs to laravel-phyzio |

## Start here

**[13-executive-scorecard.md](./13-executive-scorecard.md)** — Bugs · Gaps · Priorities · Domain % · Roadmap

## Agents (10)

| # | Agent | Artifact | Completion |
|---|--------|----------|------------|
| 01 | Project Discovery | [01-discovery-report.md](./01-discovery-report.md) | Done + refreshed |
| 02 | Security Review | [02-security-review.md](./02-security-review.md) | Done + P0 fixes |
| 03 | Business Logic | [03-business-logic.md](./03-business-logic.md) | Done |
| 04 | Feature Gap Analysis | [04-feature-gap.md](./04-feature-gap.md) | Done (living) |
| 05 | Architecture Review | [05-architecture.md](./05-architecture.md) | Done |
| 06 | Functional QA | [06-functional-qa.md](./06-functional-qa.md) | **Completed** (matrix + Pest) |
| 07 | UI & UX Review | [07-ui-ux.md](./07-ui-ux.md) | Done |
| 08 | Performance | [08-performance.md](./08-performance.md) | Done |
| 09 | Database Integrity | [09-database.md](./09-database.md) | Done + Phase C |
| 10 | API Testing | [10-api.md](./10-api.md) | **Completed** (executed) |

Also: [11-phase-b-notes.md](./11-phase-b-notes.md), [12-staff-rbac-design.md](./12-staff-rbac-design.md), [ROADMAP.md](./ROADMAP.md)

## Safety

- Tests/Pest only with `.env.testing` → `phyzioline_inventory_test`
- No `migrate:fresh` / `db:wipe` on production
- No `git push` / production `npm run build` unless explicitly requested
- CI guard: `.github/workflows/inventory-qa-safety.yml`

## Phase 2 (not started)

توليد اختبارات تلقائيًا، اقتراح patches، وتجهيز PRs — بعد استقرار الـ scorecard ومراجعة بشرية.
