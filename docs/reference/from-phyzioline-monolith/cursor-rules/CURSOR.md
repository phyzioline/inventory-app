
You are acting as a Senior Software Architect, Staff Laravel Engineer, DevOps Engineer, Security Engineer, QA Lead, and AI Systems Architect.

Your mission is NOT to rebuild the project from scratch.

Your mission is to transform the existing Phyzioline platform into a production-grade enterprise healthcare SaaS system while preserving all existing business logic and functionality.

# Phyzioline — Claude Code Context

## Project Overview

Phyzioline is a production healthcare SaaS serving clinics, therapists, patients, vendors, and course instructors. Built on Laravel 11.48 / PHP 8.2 / PostgreSQL 16.

---

## Module System Architecture

Two module systems coexist during migration:

| System | Path | Loader | Status |
|---|---|---|---|
| Legacy custom modules | `app/Modules/{Name}/` | `app/Providers/ModuleServiceProvider.php` | **Removed** (2026-06-17) — all consolidated into nwidart |
| nwidart/laravel-modules v12 | `Modules/{Name}/` | auto-loaded via `modules_statuses.json` | **15 active** (Insurance absorbed into Clinics) |

**Rule:** Only flip a nwidart module to `true` in `modules_statuses.json` after smoke tests pass on staging.

### Active nwidart Modules (2026-06-17)
- **All enabled except Insurance:** AI, Authentication, Administration, Patients, Therapists, PrivateCases, Jobs, Inventory, Payments, Notifications, Analytics, Clinics, Courses, Instructor, Ecommerce
- **Disabled:** Insurance (`false` — billing/RCM lives in Clinics)

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
| `app/Http/Controllers/Api/V1/Mobile/Support/MobileResponse.php` | Mobile app parses `{success, message, data, meta}` — rename breaks app |
| `app/Services/Clinic/ClinicAuthorizationService.php` | Blade directives call exact method signatures across 50+ views |
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

### Phase B — Extract services ✅ (core complete)
Business logic lives in `Modules/{Name}/app/Application/Services/`. Remaining `app/Services/` = protected contracts only.

### Phase C — Delegate routes ✅ (complete)
`routes/*.php` point at `Modules\...\Presentation\Http\Controllers\...`.

### Phase D — Deprecate to `legacy_archive/` ✅ (API wrappers archived)
Thin `app/Http/Controllers/Api/*` wrappers moved to `legacy_archive/`. Log: `docs/refactoring/archived-files.md`.

### Phase E — Legacy `app/Modules/` ✅ (removed 2026-06-17)
Consolidate commands: `courses:consolidate-shims`, `private-cases:consolidate-home-visits-shims`, `payments:consolidate-shims`, `clinics:consolidate-shims`, `ecommerce:consolidate-shims`.

### Phase F — Database (in progress)
- Shared `database/migrations/` (normal for Laravel monolith)
- Per-module migrations in `Modules/{Name}/database/migrations/` where collected
- **Never** `migrate:fresh` on shared PostgreSQL

### What permanently stays in `app/`

| Path | Reason |
|---|---|
| `Http/Kernel.php`, global middleware | Laravel bootstrap |
| `Providers/AppServiceProvider.php` | `morphMap()` — add only, never remove |
| `Providers/AuthServiceProvider.php` | `Gate::before()` super-admin bypass |
| Protected contracts | See table below |
| **Thin shims only** | `app/Models/`, `app/Support/`, `app/Observers/`, `app/Mail/`, `app/Notifications/` — see below |

### `app/` footprint audit (2026-06-18)

**ممنوع إنشاء أي ملف domain جديد تحت `app/`.** قبل أي ملف: ابحث في `Modules/` — إن وُجد انقله؛ لا تُنشئ نسخة ثانية.

| Path | Count | الحالة | المكان الصحيح |
|------|-------|--------|----------------|
| `app/Models/` | ~140 | ✅ **shims فقط** (`extends Modules\...\Domain\Models\...`) | `Modules/{Name}/app/Domain/Models/` — الـ shim يبقى مؤقتاً لـ morphMap و`config/auth` |
| `app/Support/` | 25 | ✅ **shims** + `helpers.php` | `Modules/{Name}/app/Infrastructure/Support/` |
| `app/Observers/` | 2 | ✅ **shims** | `Modules/{Name}/app/Infrastructure/Observers/` |
| `app/Mail/` | 25 | ✅ **shims فقط** | `Modules/{Name}/app/Infrastructure/Mail/` |
| `app/Notifications/` | 28 | ✅ **shims فقط** | `Modules/{Name}/app/Infrastructure/Notifications/` |
| `app/Console/Commands/` | 2 | ✅ cross-app audit فقط | باقي الأوامر في `Modules/*/Presentation/Console/Commands/` |
| `app/Infrastructure/Migration/` | ops | ✅ أدوات ترحيل عابرة للتطبيق | لا domain logic |
| `app/Logging/` | 1 | ✅ **shim** | `Modules/Administration/app/Infrastructure/Logging/` |
| `app/Services/` | 0 | ✅ فارغ (محمي في `legacy_archive` أو Modules) | `BrainFallbackService` + `ClinicAuthorizationService` يجب أن يبقيا في `app/` |

#### `app/Mail/` — لم يُنقل بعد (المرحلة التالية)

| الملف | الموديول المستهدف |
|-------|-------------------|
| `WelcomeEmail`, `OTPEmail`, `AccountVerification*`, `VerificationDocumentsSubmittedEmail` | Authentication |
| `StaffInvitationMail`, `ClinicStaffInvitationMail`, `StaffAddedToClinicMail`, `TrialExpiryReminderMail` | Clinics |
| `Order*`, `SupplierOrderMail` | Ecommerce |
| `Course*`, `InstructorCoursePayment*` | Courses / Instructor |
| `HomeVisitPaymentConfirmationMail` | PrivateCases |
| `ApplicationErrorMail`, `WeeklyCustomerEngagementMail`, `CriticalAlertMail`, `Complaint*`, `FeedbackMail`, `Company*` | Administration |

#### `app/Notifications/` — لم يُنقل بعد

| الملفات | الموديول |
|---------|----------|
| `WelcomeRegistrationNotification`, `NewUserRegistrationNotification`, `Verification*` | Authentication |
| `NewHomeVisit*`, `HomeVisit*`, `VisitStatusUpdated` | PrivateCases |
| `NewEnrollment*`, `Course*`, `GroupReadyForPayment*` | Courses |
| `OrderCreatedNotification`, `ReturnStatusUpdated`, `LowStockNotification`, `VendorShipping*` | Ecommerce |
| `PayoutStatusNotification` | Payments |
| `JobStatusUpdated` | Jobs |
| `ApplicationErrorDetectedNotification`, `TestNotification` | Administration |
| `TherapistSetupReminderNotification` | Therapists |
| **Shims (جاهزة)** | `AppointmentCancelled`, `ClinicPortal`, `NewAppointment`, `BookingConfirmation`, `ClinicNewBooking` → Clinics؛ `InstructorPortal` → Instructor |

### Phase G — Mail & Notifications (pending, next increment)

```bash
# Planned — run per module, never big-bang:
php artisan administration:migrate-app-mail        # TBD
php artisan administration:migrate-app-notifications  # TBD
```

Pattern: انقل التنفيذ → `Modules/{Name}/app/Infrastructure/Mail|Notifications/` → اترك `App\Mail\X extends Modules\...\X {}` → حدّث الـ imports تدريجياً.

### أوامر التحقق (Windows — PowerShell)

```powershell
php artisan administration:migrate-app-footprint
php artisan optimize:clear
php artisan universities:extract-from-courses
php artisan datahub:extract-from-administration
php artisan postman:generate
./vendor/bin/pest Modules/Ads/tests Modules/CRM/tests Modules/Social/tests Modules/Universities/tests Modules/DataHub/tests Modules/AI/tests Modules/Payments/tests Modules/Courses/tests Modules/Administration/tests --filter=ModuleSmoke
```

**لا تستخدم** `Modules/*/tests/...` على Windows — الـ glob لا يعمل في Pest.

### أي سكربت يُرسل للمستخدم (إلزامي على الـ Agent)

كل block أوامر في خطة أو رد يجب أن يلتزم بـ:

1. لا ملفات domain خارج `Modules/{Name}/app/{Layer}/` — ابحث أولاً ثم انقل.
2. لا `migrate:fresh` / لا `git push` بدون طلب صريح.
3. بعد إصلاح middleware: `php artisan optimize:clear`.
4. `module:make` → صحّح `module.json` namespace + `modules_statuses.json: false` فوراً.

انظر أيضاً: `.cursor/rules/mandatory-migration-rules.mdc` §6.

### Legacy `app/Modules/{Name}/` — ✅ REMOVED (2026-06-17)
All legacy trees consolidated via module artisan commands. `ModuleServiceProvider` is a no-op when `app/Modules/` is empty.

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
* **Creating full implementations under `app/Models`, `app/Mail`, `app/Notifications`, `app/Support`** (shims only — see `app-footprint-after-migration.mdc`)

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
