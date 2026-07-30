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

## Agents (10) — all complete 2026-07-30

| # | Agent | Artifact |
|---|--------|----------|
| 01 | Project Discovery | [01-discovery-report.md](./01-discovery-report.md) |
| 02 | Security Review | [02-security-review.md](./02-security-review.md) |
| 03 | Business Logic | [03-business-logic.md](./03-business-logic.md) |
| 04 | Feature Gap Analysis | [04-feature-gap.md](./04-feature-gap.md) |
| 05 | Architecture Review | [05-architecture.md](./05-architecture.md) |
| 06 | Functional QA | [06-functional-qa.md](./06-functional-qa.md) |
| 07 | UI & UX Review | [07-ui-ux.md](./07-ui-ux.md) |
| 08 | Performance | [08-performance.md](./08-performance.md) |
| 09 | Database Integrity | [09-database.md](./09-database.md) |
| 10 | API Testing | [10-api.md](./10-api.md) |

Living plan: [ROADMAP.md](./ROADMAP.md) — **Phases A/B/C implemented** (see also [11-phase-b-notes.md](./11-phase-b-notes.md), [12-staff-rbac-design.md](./12-staff-rbac-design.md)).

## Safety

- Tests/Pest only with `.env.testing` → `phyzioline_inventory_test`
- No `migrate:fresh` / `db:wipe` on production
- No `git push` / production `npm run build` unless explicitly requested

## Implementation status

Pest baseline after Phases A–C: **57 passed** on `phyzioline_inventory_test`.
SPA changes (api.ts, Reports, ProfitEngine) need an explicit `npm run build` to ship to `public/app/`.
