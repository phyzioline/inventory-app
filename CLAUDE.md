# Inventory App — Agent Context (CLAUDE.md)

## Project identity — READ FIRST

**This is `inventory-app`**, not `laravel-phyzio`. Two separate projects live on this
machine and are easy to confuse in a chat session:

| | This project | The other project |
|---|---|---|
| Name | `phyzioline/inventory` | `laravel/laravel` (phyzioline.com main site) |
| Purpose | Standalone warehouse, purchasing, sales and treasury management app — extracted from the Phyzioline monolith's Inventory module | Phyzioline's main e-commerce / healthcare SaaS |
| Path | `/home/phyzioline-inventory/htdocs/inventory.phyzioline.com` | `/home/phyzioline/htdocs/phyzioline.com` |
| Git remote | `github.com/phyzioline/inventory-app.git` | `github.com/phyzioline/laravel-phyzio.git` |
| APP_URL | `https://inventory.phyzioline.com` | `https://phyzioline.com` |
| Production DB | `phyzioline_inventory` | `phyzioline` |
| Test DB | `phyzioline_inventory_test` | `phyzioline_test` |

Before `git commit` / `git push`, or claims about "Modules/Ecommerce", clinics, or
`Modules/...` — confirm with `pwd` and `git remote -v`. This app has **no** `Modules/`
directory.

Original monolith rules (reference only): `docs/reference/from-phyzioline-monolith/`.

---

## Structure

```
app/
  Application/     — Services, DTOs, orchestration
  Domain/          — Models (Wms/*, Subscription*), Contracts, Events
  Infrastructure/  — External clients (Paymob), Observers, Jobs, Migration helpers
  Presentation/    — Http Controllers, Requests, Console Commands
  Providers/       — AppServiceProvider, DatabaseSafetyServiceProvider
  Support/         — DatabaseSafetyGuard
  Models/          — User (auth)
  Http/Middleware/ — Global middleware
resources/frontend/ — React + Vite SPA → builds to public/app/
database/migrations/
tauri-inventory-app/ — separate desktop client (own package.json)
```

---

## Clean Architecture (mandatory)

| Layer | Path |
|---|---|
| Application | `app/Application/` |
| Domain | `app/Domain/` |
| Infrastructure | `app/Infrastructure/` |
| Presentation | `app/Presentation/` |

Thin controllers: validate → DTO/service → respond. No fat controllers.
Never create `Modules/` here — that pattern belongs to laravel-phyzio only.

---

## DATABASE SAFETY — NEVER WIPE PRODUCTION

**Incident 2026-07-27:** Pest `RefreshDatabase` wiped `phyzioline_inventory` because
`.env.testing` was missing and `phpunit.xml` did not `force` `DB_DATABASE`.

| Database | Role |
|---|---|
| `phyzioline_inventory` | **PRODUCTION — sacred. Never RefreshDatabase / migrate:fresh / db:wipe.** |
| `phyzioline_inventory_test` | Only DB allowed for PHPUnit/Pest |

Before any `php artisan test` / `pest`:
1. `.env.testing` exists with `DB_DATABASE=phyzioline_inventory_test`
2. `phpunit.xml` has `<env name="DB_DATABASE" value="phyzioline_inventory_test" force="true"/>`
3. Code guard: `App\Support\DatabaseSafetyGuard`

---

## Backups

Daily 02:10 UTC: `/etc/cron.d/phyzioline_inventory_backup` →
`/home/phyzioline-inventory/backup_inventory_pgsql.sh` →
`/home/phyzioline-inventory/backups/databases/phyzioline_inventory/` (30 days).
Latest: `.../phyzioline_inventory-latest.sql.gz`.

Do **not** rely on phyzioline.com `backup_pgsql.sh` — that dumps monolith `phyzioline` only.

---

## Test Conventions

```bash
# Prerequisites
#   cp .env.testing.example .env.testing
#   ensure DB phyzioline_inventory_test exists

./vendor/bin/pest
./vendor/bin/pest --filter=MarketplaceImportIdempotency
./vendor/bin/pest tests/Unit/
```

- PostgreSQL only — no SQLite.
- `RefreshDatabase` is safe **only** on `*_test` databases.

---

## Critical domains

Marketplace import + stock OUT, returns + ledgers, settlements, treasury, purchases,
profit/COGS, subscriptions/Paymob. See `.cursor/rules/inventory-critical-paths.mdc`.

---

## Queue worker (MANDATORY for async marketplace import)

Incident 2026-08-03: async sheet import hung for hours because jobs sat in Redis
`queued` with **no** inventory queue worker (only phyzioline.com had a worker).

| Unit | Purpose |
|---|---|
| `inventory-queue.service` | `php artisan queue:work redis` — **must be enabled+running** |
| `inventory-queue-watchdog.timer` | Restarts the worker if it dies |
| Cron `schedule:run` (this app) | Runs `inventory:ensure-queue-healthy` every minute |

```bash
systemctl status inventory-queue.service
systemctl enable --now inventory-queue.service inventory-queue-watchdog.timer
php artisan inventory:ensure-queue-healthy
```

If the worker is down, marketplace `async=1` **falls back to sync** so the UI never
polls forever. Stale `queued` jobs auto-fail after 120s.

---

# AI AGENT EXECUTION RULES (MANDATORY)

These rules override all other instructions. Violation = failed implementation.

## RULE 1 — READ BEFORE MODIFY

Before modifying any file: read the target, imports, related routes, controllers,
services, models, requests, resources, migrations, and tests. Never modify on assumptions.

## RULE 2 — NO DUPLICATION

Before creating a Controller, Service, DTO, Request, Resource, Policy, Middleware,
Event, Job, Command, Trait, or Helper: search the entire repository. Reuse, extend,
or refactor — do not duplicate.

## RULE 3 — RESPECT PROJECT STRUCTURE

Forbidden: random folders, root-level junk, temporary directories, alternative trees,
or `Modules/` packages. Every file belongs in Application / Domain / Infrastructure /
Presentation (or SPA under `resources/frontend`).

## RULE 4 — NO FILE SCATTERING

Before creating any file answer: Why must it exist? Why can't an existing file be reused?
Where does it belong architecturally?

## RULE 5 — ARCHITECTURE FIRST

If code is outside the target layers: analyze, place correctly, migrate safely — do not
leave debt behind.

## RULE 6 — FIX THE ROOT CAUSE

Investigate root cause and dependencies. Never patch symptoms only.

## RULE 7 — SCREENSHOT AND ERROR ANALYSIS

Trace source file, execution path, services, and APIs. Do not guess.

## RULE 8 — FEATURE COMPLETENESS

For a feature verify: routes, controllers, services, requests, resources, policies,
events/jobs if needed, tests. Do not leave half-implemented flows (especially stock/money).

## RULE 9 — THINK LIKE A STAFF ENGINEER

Ask: reusable? scalable? testable? secure? already implemented? clean architecture?
technical debt? If wrong — stop and redesign.

## RULE 10 — NO SHORTCUTS

Forbidden: quick hacks, copy-paste duplicates, duplicate APIs/tables/business logic.
Production-grade only.

## RULE 11 — VERIFY BEFORE FINISHING

Routes/APIs work, imports resolve, tests for touched critical paths pass on the **test**
DB, no duplication, architecture respected.

## RULE 12 — WHEN IN DOUBT, INSPECT MORE

Never assume. Search more references. Understand the full flow before changing code.

## Extra — ops discipline (from monolith)

- No `git push` unless explicitly requested.
- No production `npm run build` unless explicitly requested.
- No `migrate:fresh` / `db:wipe` on `phyzioline_inventory`.
