# Phyzioline — Claude Code Context

## Project identity — READ FIRST

**This is `laravel-phyzio`** (the main Phyzioline monolith), not `inventory-app`. A
separate, standalone repo lives on this same machine and is easy to confuse with this
one in a chat session:

| | This project | The other project |
|---|---|---|
| Name | `laravel/laravel` (Phyzioline monolith) | `phyzioline/inventory` |
| Path | `/home/phyzioline/htdocs/phyzioline.com` | `/home/phyzioline-inventory/htdocs/inventory.phyzioline.com` |
| Git remote | `github.com/phyzioline/laravel-phyzio.git` | `github.com/phyzioline/inventory-app.git` |
| APP_URL | `https://phyzioline.com` | `https://inventory.phyzioline.com` |

**Trap:** this monolith has its own `Modules/Inventory/` (nwidart module, part of the
migration below) — that is a *different codebase* from the standalone `inventory-app`
repo, despite the similar name. Before touching anything under `Modules/Inventory/` or
making claims about "the inventory app," confirm with `pwd` and `git remote -v` which
repo you're actually in.

## Project Overview

Phyzioline is a production healthcare SaaS serving clinics, therapists, patients, vendors, and course instructors. Built on Laravel 11.48 / PHP 8.2 / PostgreSQL 16.

---

## Module System Architecture

Two module systems coexist during migration:

| System | Path | Loader | Status |
|---|---|---|---|
| Legacy custom modules | `app/Modules/{Name}/` | `app/Providers/ModuleServiceProvider.php` | **Removed** (2026-06-17) |
| nwidart/laravel-modules v12 | `Modules/{Name}/` | auto-loaded via `modules_statuses.json` | **15 active** (Insurance → Clinics) |

**Rule:** Only flip a nwidart module to `true` in `modules_statuses.json` after smoke tests pass on staging.

### Active nwidart Modules (2026-07-25)
- **Enabled (`true`):** AI, Authentication, Administration, Patients, Therapists, PrivateCases, Jobs, Payments, Insurance, Notifications, Analytics, Clinics, Courses, Ecommerce, Instructor, Social, CRM, Ads, Universities, DataHub, Revenue, Connectors, Governance, Evidence, Company, **Quality**
- **Disabled (`false`):** Protocols, Healthcare — enable after `Modules/*/tests/Feature/ModuleSmokeTest.php` on staging
- **Removed:** Orders — absorbed into `Modules/Ecommerce/` (2026-06-17); Inventory — extracted to a standalone app at `inventory.phyzioline.com` ([github.com/phyzioline/inventory-app](https://github.com/phyzioline/inventory-app)), archived to `legacy_archive/Modules/Inventory/` (2026-07-25, see `docs/refactoring/archived-files.md`)

---

## Clean Architecture Layer Structure

Each nwidart module follows this layout inside `Modules/{Name}/app/`:

```
Application/
  DTOs/          — immutable readonly input objects (no HTTP deps)
  Services/      — orchestration logic; receives DTOs, returns plain objects
  Commands/      — write-side CQRS handlers
  Queries/       — read-side CQRS handlers

Domain/
  Contracts/     — interfaces (LlmProviderInterface, etc.)
  Events/        — domain events (no Eloquent)
  Exceptions/    — domain-specific exceptions
  Models/        — Eloquent models when co-located with module
  Repositories/  — repository interfaces (contracts only)
  ValueObjects/  — immutable value types

Infrastructure/
  Cache/         — cache key registries, observers
  External/      — third-party API clients (payment gateways, LLM providers)
  Http/
    Middleware/  — module-specific middleware
  Jobs/          — queued jobs
  Notifications/ — Eloquent-backed notifications
  Repositories/  — Eloquent implementations of Domain/Repositories/ interfaces

Presentation/
  Http/
    Controllers/ — thin wrappers; validate → DTO → service → respond
    Requests/    — Form Request classes
    Resources/   — API Resources (JSON transformation)
  Console/
    Commands/    — Artisan commands
```

---

## How to Add a New Module

1. `php artisan module:make {Name}` — scaffolds the nwidart shell
2. Set `"{Name}": false` in `modules_statuses.json`
3. Create `Modules/{Name}/app/Providers/{Name}ServiceProvider.php` following `Modules/AI/Providers/AIServiceProvider.php`
4. Register the ServiceProvider in `Modules/{Name}/module.json` under `"providers"`
5. Build the Clean Architecture layer structure (copy the directory tree above)
6. Write smoke + unit tests before enabling
7. Flip to `true` in `modules_statuses.json` only after staging passes

---

## Protected Contracts (never change signatures)

| Class / File | Why Protected |
|---|---|
| `Modules/Administration/app/Presentation/Http/Support/MobileResponse.php` | Mobile app parses `{success, message, data, meta}` — rename breaks app |
| `Modules/Clinics/app/Application/Services/ClinicAuthorizationService.php` | Blade directives call exact method signatures across 50+ views |
| `app/Providers/AuthServiceProvider.php` → `Gate::before()` | Super-admin bypass — removing it locks out all admins |
| `app/Providers/AppServiceProvider.php` → `morphMap()` | Remove an alias → polymorphic queries 500 on existing rows |
| `Modules/AI/Providers/AIServiceProvider.php` → `boot()` schedule | 9 scheduled AI agents must run continuously |
| `app/Services/BrainFallbackService.php` | LLM fallback chain is production-critical |

---

## Migration Pattern — Extract → Wrap → Delegate → Deprecate

**Never use `class_alias()`.** The correct pattern:

1. **Extract** — create new service in target module with full logic
2. **Wrap** — old controller injects new service, delegates to it (old file becomes thin)
3. **Verify** — staging smoke tests pass, Sentry quiet for 30 min
4. **Delegate** — update route files to reference new controller namespace
5. **Deprecate** — after one clean deployment cycle, move old file to `legacy_archive/`

---

## app/ → Modules Migration Roadmap

**Never Big Bang.** Move one module at a time. **Never modify `vendor/`** — it is Composer-managed only.

### Phase A — Wrap controllers ✅ (complete)
Legacy `app/Http/Controllers/*` are thin 5-line wrappers extending `Modules/{Name}/app/Presentation/Http/Controllers/*`.  
Verify: `php artisan migration:find-unwrapped-controllers` → 0 remaining.

### Phase B — Extract services (in progress)
Move business logic from fat controllers and `app/Services/` into module layers:

| Layer | Target path |
|---|---|
| DTOs, orchestration | `Modules/{Name}/app/Application/` |
| Eloquent models (when moved) | `Modules/{Name}/app/Domain/Models/` |
| Jobs, external APIs | `Modules/{Name}/app/Infrastructure/` |

**Pilot modules:**
- `Authentication` — services extracted; API routes delegate to module controllers; `User` model shim migrating to `Domain/Models/`
- `Administration` — Help Center KB + slim controller; dashboard CRM/ads delegated
- `Ecommerce` (includes former Orders) — `OrderReturnService`, dashboard vendor controllers, mobile marketplace API

### Phase C — Delegate routes (~75% complete)
Point `routes/*.php` directly at module controller namespaces; remove wrapper indirection. API/mobile largely done; `routes/dashboard.php` vendor routes delegate to `Modules/Ecommerce/.../Dashboard/*`.

### Phase D — Deprecate to `legacy_archive/` (advanced)
After routes delegate to modules, thin `app/Http/Controllers/*` wrappers move to `legacy_archive/` (not deleted). Log each batch in `docs/refactoring/archived-files.md`. **2026-06-17:** ~319 files archived (API wrappers, services, policies, dashboard shims).

Protected contracts (moved out of `app/` in `e06064cc`, still protected):
- `Modules/Administration/app/Presentation/Http/Support/MobileResponse.php` (and `MobileFormat`, `ResolvesAdOwner`)

### Phase E — Database (after code is stable)
- **Done:** migrations are per-module in `Modules/{Name}/database/migrations/`. There is no shared root `database/` directory — it no longer exists. Put a new migration in the module that owns the table, next to the migrations it amends.
- **Never:** separate DB schemas / connections per module — one PostgreSQL schema stays shared.
- **Note:** table ownership does not always match the module writing the row. `earnings_transactions` is owned by `Modules/PrivateCases/` but written from `Modules/Ecommerce/.../ItemsOrder.php`; migrate it in PrivateCases and check Ecommerce callers.

### What permanently stays in `app/`

| Path | Reason |
|---|---|
| `Http/Kernel.php`, global middleware | Laravel bootstrap |
| `Providers/AppServiceProvider.php` | `morphMap()` — add only, never remove |
| `Providers/AuthServiceProvider.php` | `Gate::before()` super-admin bypass |
| Protected contracts | See table below |
| Thin wrappers during transition | Until Phase D |

### Legacy `app/Modules/{Name}/` (custom loader)
Clinics and Ecommerce loaders **skipped** in `ModuleServiceProvider` (nwidart canonical). Courses, HomeVisits, Payments remain as thin shims until smoke tests pass, then skip their loaders too. HomeVisits domain absorbed into `Modules/PrivateCases/`.

### Cross-database migrations (legacy MySQL upgrades)
Migrations that use MySQL-only syntax (`MODIFY COLUMN`, `information_schema`) must guard with `DB::getDriverName() === 'mysql'`. Production and tests use **PostgreSQL only**. Helpers in `database/MigrationHelpers.php` (`migration_index_exists`, `migration_foreign_key_exists`) work on all drivers.

---

## Test Conventions

```bash
# Prerequisites: PostgreSQL running (docker compose up -d postgres)
#   cp .env.testing.example .env.testing && php artisan key:generate --env=testing

# Run all tests
./vendor/bin/pest

# Run with coverage gate (80% minimum)
./vendor/bin/pest --coverage --min=80

# Smoke tests only
./vendor/bin/pest tests/Smoke/

# Module-specific tests
./vendor/bin/pest Modules/Authentication/tests/

# Unit tests only
./vendor/bin/pest --testsuite=Unit
```

- **All test suites** use **PostgreSQL** (`phpunit.xml` → `phyzioline_test`; CI uses GitHub Actions postgres:16 service)
- **No SQLite** in production, local dev, or tests — matches `DB_CONNECTION=pgsql`
- Copy `.env.testing.example` → `.env.testing` for local credentials that differ from CI defaults
- Factory pattern: `Modules/{Name}/database/factories/` for module-specific models

---

## Queue Priority Configuration

Named queues (highest → lowest priority):

| Queue | Workloads |
|---|---|
| `critical` | Payment confirmations, webhook processing, OTP delivery |
| `high` | Order state changes, appointment reminders, WhatsApp notifications |
| `default` | Feed updates, analytics events, email |
| `low` | AI knowledge sync, report generation, bulk exports |

Worker command: `php artisan queue:work --queue=critical,high,default,low`

---

## Key Environment Variables

```env
DB_CONNECTION=pgsql          # PostgreSQL only — no SQLite in production
CACHE_STORE=redis
SESSION_DRIVER=redis
QUEUE_CONNECTION=redis
REDIS_HOST=redis             # docker service name in compose
DB_HOST=pgbouncer            # connection pooler in docker compose
```

---

## MorphMap Registry

Morph aliases live in `AppServiceProvider::boot()`. **Only add, never remove.**

```php
Relation::morphMap([
    'product' => \App\Models\Product::class,
    'course'  => \App\Models\Course::class,
    // Add new aliases here before moving any model
]);
```

---

## Deployment

```bash
# Local dev
docker compose up -d
php artisan migrate
php artisan serve

# Production (via CI)
# Push to main → GitHub Actions ci.yml runs → deploy.yml SSHs to server
# See docs/reports/deployment.md and docs/server/RUNBOOK.md
```

---

## Rollback Procedure (5-minute target)

1. **Git:** `git revert HEAD --no-edit && git push`
2. **Module toggle:** set module to `false` in `modules_statuses.json` + `php artisan optimize:clear`
3. **Database:** restore from `pg_dump` backup (see `docs/server/RUNBOOK.md`)
4. **Queue:** `php artisan queue:restart` after any code deploy

---

## Documentation Layout

All docs indexed at [`docs/README.md`](docs/README.md):

| Folder | Purpose |
|---|---|
| `docs/architecture/` | Audits, domain map, ADRs |
| `docs/reports/` | Security, performance, testing, deployment |
| `docs/refactoring/` | Final report, archived files log |
| `docs/api/` | OpenAPI (`openapi.json`), API docs |
| `docs/postman/` | All Postman collections |
| `docs/logs/` | Log strategy (`storage/logs/` for files) |
| `docs/guides/`, `features/`, `fixes/`, `server/` | Operational docs |

# AI AGENT EXECUTION RULES (MANDATORY)

These rules override all other instructions.

Violation of any rule is considered a failed implementation.

---

## RULE 1 — READ BEFORE MODIFY

Before modifying any file:

The agent must:

1. Read the target file completely.
2. Read all imported classes.
3. Read related routes.
4. Read related controllers.
5. Read related services.
6. Read related models.
7. Read related requests.
8. Read related resources.
9. Read related migrations.
10. Read related tests.

Never modify code based on assumptions.

Never generate code before understanding the existing implementation.

---

## RULE 2 — NO DUPLICATION

Before creating:

* Controller
* Service
* Repository
* DTO
* Request
* Resource
* Policy
* Middleware
* Event
* Job
* Command
* Trait
* Helper

The agent must search the entire repository.

If similar functionality already exists:

Reuse it.
Extend it.
Refactor it.

Do not duplicate it.

Always prefer consolidation over creation.

---

## RULE 3 — RESPECT PROJECT STRUCTURE

The existing architecture is the source of truth.

The agent is forbidden from:

* Creating random folders
* Creating root-level files
* Creating temporary directories
* Creating alternative structures

Every file must be placed inside its proper module and layer.

Examples:

Domain logic:
Modules/{Module}/app/Domain/

Application logic:
Modules/{Module}/app/Application/

Infrastructure:
Modules/{Module}/app/Infrastructure/

Presentation:
Modules/{Module}/app/Presentation/

No exceptions.

---

## RULE 4 — NO FILE SCATTERING

The agent must never place files in arbitrary locations.

Every new file must:

1. Belong to a module.
2. Belong to a layer.
3. Have a documented purpose.

Before creating any file:

Answer:

* Why does it need to exist?
* Why can an existing file not be reused?
* Where does it belong architecturally?

---

## RULE 5 — ARCHITECTURE FIRST

If the agent discovers code that exists outside the target architecture:

Do NOT ignore it.

Do NOT skip it.

Do NOT leave it behind.

Instead:

1. Analyze it.
2. Identify the correct module.
3. Identify the correct layer.
4. Add it to the migration plan.
5. Move it safely.

Every discovered component must eventually belong to:

* Domain
* Application
* Infrastructure
* Presentation

---

## RULE 6 — FIX THE ROOT CAUSE

When an error is reported:

The agent must:

1. Investigate root cause.
2. Trace dependencies.
3. Trace related services.
4. Trace related APIs.
5. Trace related models.
6. Trace related routes.

Never patch symptoms.

Always solve the actual cause.

---

## RULE 7 — SCREENSHOT AND ERROR ANALYSIS

When provided:

* Screenshot
* Error message
* Stack trace
* Console output
* Log output

The agent must:

1. Trace source file.
2. Trace execution path.
3. Trace related services.
4. Trace related repositories.
5. Trace related APIs.

Do not implement blind fixes.

Do not guess.

---

## RULE 8 — MODULE COMPLETENESS

If a feature belongs to a module:

The agent must verify:

* Routes
* Controllers
* Services
* Repositories
* DTOs
* Requests
* Resources
* Policies
* Events
* Jobs
* Tests
* API Documentation

If missing:

Create them according to architecture standards.

Never leave a module partially implemented.

---

## RULE 9 — THINK LIKE A STAFF ENGINEER

Before every implementation ask:

* Is this reusable?
* Is this scalable?
* Is this testable?
* Is this secure?
* Is this already implemented somewhere else?
* Does this violate clean architecture?
* Will this increase technical debt?

If yes:

Stop and redesign.

---

## RULE 10 — NO SHORTCUTS

Forbidden actions:

* Quick fixes
* Temporary hacks
* Copy-paste solutions
* Duplicate classes
* Duplicate APIs
* Duplicate database tables
* Duplicate business logic

Every implementation must be production-grade.

---

## RULE 11 — VERIFY BEFORE FINISHING

Before marking a task complete:

Verify:

* Routes work.
* APIs work.
* Imports work.
* Dependencies work.
* Tests pass.
* No duplication exists.
* Architecture rules are respected.

Only then mark task completed.

---

## RULE 12 — WHEN IN DOUBT, INSPECT MORE

Never assume.

Always inspect more files.

Always search more references.

Always understand the full execution flow before modifying code.
