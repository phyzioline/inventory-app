# Phyzioline — Claude Code Context

## 🔒 Security first (MANDATORY on every task)

Before writing, changing, or reviewing ANY code, config, migration, AI agent, MCP server, mobile code, or deployment step,
load and follow the skill `phyzioline-security-guardian` ([`.claude/skills/phyzioline-security-guardian/SKILL.md`](.claude/skills/phyzioline-security-guardian/SKILL.md)).

Treat this project as the world's largest bank holding patient health data, attacked every second by the most capable AI.
Assume breach. Secure by default. Never ship an insecure version "for now".

Hard rules:
- Never commit secrets or `.env`; never put API keys in the Flutter app or frontend JS.
- Every route authenticated + authorized server-side; every ERP query scoped by tenant/clinic.
- All content reaching an AI agent is untrusted (prompt injection). Agents get least-privilege tools; destructive actions need human approval.
- `APP_DEBUG=false` in production; DB/Redis/MCP never exposed publicly.
- End every technical answer with a short "🔒 Security Notes" section (Critical/High/Medium/Low).

## Project identity — READ FIRST

**This is `laravel-phyzio`** (the main Phyzioline monolith), not `inventory-app` and
not `marketplace-app`. Two separate, standalone repos live on this same machine and
server and are easy to confuse with this one in a chat session:

| | This project | Inventory | Marketplace |
|---|---|---|---|
| Name | `laravel/laravel` (Phyzioline monolith) | `phyzioline/inventory` | `phyzioline/marketplace` |
| Path | `/home/phyzioline/htdocs/phyzioline.com` | `/home/phyzioline-inventory/htdocs/inventory.phyzioline.com` | `/home/phyzioline-marketplace/htdocs/marketplace.phyzioline.com` |
| Git remote | `github.com/phyzioline/laravel-phyzio.git` | `github.com/phyzioline/inventory-app.git` | `github.com/phyzioline/marketplace-app.git` |
| APP_URL | `https://phyzioline.com` | `https://inventory.phyzioline.com` | `https://marketplace.phyzioline.com` |
| Production DB | `phyzioline` | `phyzioline_inventory` | `phyzioline_marketplace` |

**Trap:** this monolith has its own `Modules/Inventory/` (nwidart module, part of the
migration below) — that is a *different codebase* from the standalone `inventory-app`
repo, despite the similar name. Before touching anything under `Modules/Inventory/` or
making claims about "the inventory app," confirm with `pwd` and `git remote -v` which
repo you're actually in.

**Trap (marketplace):** `marketplace-app` is Stage B of the marketplace extraction
(started 2026-10-05, see `docs/architecture/marketplace-extraction-roadmap.md`). Until
the B6 cutover it takes **no traffic**: `Modules/Ecommerce/` in *this* repo is still
the code serving production, and marketplace changes still happen here.

**Trap (AI engine):** Python brain (FastAPI) lives at `infra/services/ai-engine/` in
this monolith (same VPS, `127.0.0.1:8790`) — **not** under `Modules/AI/` and **not** a
random root folder. `Modules/AI` is the Laravel SoT / gateway; the engine is compute-only.
Plan and status: `docs/architecture/ai-engine-python-roadmap.md`; rules: RULE 17 below.

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

### Active nwidart Modules (2026-10-14)
- **Enabled (`true`):** AI, Authentication, Administration, Patients, Therapists, PrivateCases, Jobs, Payments, Insurance, Notifications, Analytics, Clinics, Courses, Ecommerce, Instructor, Social, CRM, Ads, Universities, DataHub, Revenue, Connectors, Governance, Evidence, Company, Quality, QualityEngineering, **UsedDevices**, **CommercialContracts** (2026-11-14, enabled on production without staging by the owner's decision — sign-before-pay for clinic SaaS/desktop; EG/SA/AE templates shipped; see `docs/features/commercial-contracts.md`), **DemoBooking** (2026-11-09, on production without staging by the owner's decision — clinic demo meeting booking on `/erp/demo`; RULE 18 exception — see `Modules/DemoBooking/docs/README.md`), **WhatsApp** (2026-10-14, on production without staging by the owner's decision, for one internal sandbox clinic — #239 — and the Meta App Review recordings; see `Modules/WhatsApp/docs/RUNBOOK.md` §0 and `docs/server/server-session-2026-10-14.md`)
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
| `routes/schedule_definitions.php` | Single source of truth for the AI cron schedule — 38 unique agents / 39 `ai:run-employees --only=X` entries (`finance_ai` runs twice/day) must run continuously (moved out of `AIServiceProvider::boot()`, which no longer registers any `Schedule::` calls). 43 agent classes are registered in total; 5 are documented on-demand-only stubs. See `docs/ai-audit.md` for the full inventory — this number had drifted across several docs/comments before that audit reconciled it. |
| `Modules/AI/app/Application/Services/BrainFallbackService.php` | LLM fallback chain is production-critical (moved from `app/Services/` — thin wrapper delegating to `Modules/AI/app/Application/Services/LlmRouter.php`) |

---

## Migration Pattern — Extract → Wrap → Delegate → Deprecate

**Never use `class_alias()`.** The correct pattern:

1. **Extract** — create new service in target module with full logic
2. **Wrap** — old controller injects new service, delegates to it (old file becomes thin)
3. **Verify** — staging smoke tests pass, Sentry quiet for 30 min
4. **Delegate** — update route files to reference new controller namespace
5. **Deprecate** — after one clean deployment cycle, move old file to `legacy_archive/`

---

## app/ → Modules migration roadmap

**Never Big Bang; never modify `vendor/`.** Phase A (wrap) done, B (extract services) in progress, C (delegate routes) ~75%, D (archive to `legacy_archive/`, logged in `docs/refactoring/archived-files.md`) advanced, E (database) — migrations live in the module that owns the table; no root `database/` directory; one shared PostgreSQL schema. MySQL-only migration syntax must be guarded with `DB::getDriverName() === 'mysql'`.
Full roadmap, what stays in `app/`, and the cross-database notes: [`docs/architecture/app-to-modules-roadmap.md`](docs/architecture/app-to-modules-roadmap.md).

## Tests, queues, environment, deployment, rollback

- Tests: PostgreSQL only (`phyzioline_test`), `./vendor/bin/pest`, module tests `./vendor/bin/pest Modules/{Name}/tests/`, smoke `tests/Smoke/`. No SQLite anywhere.
- MorphMap aliases in `AppServiceProvider::boot()`: **add only, never remove.**
- Queues, environment variables, deployment, the 5-minute rollback: [`docs/guides/operations-quick-reference.md`](docs/guides/operations-quick-reference.md).
- GitHub access on the server is **SSH deploy keys only** (one per repo, aliases `github-<repo>` in `/root/.ssh/config`) since 2026-11-15: never put a token in a remote URL or `.git-credentials`, never print remotes/credentials unmasked; `gh` is logged out until a narrow fine-grained token is added. Details: [`docs/server/server-session-2026-11-15.md`](docs/server/server-session-2026-11-15.md).

## Documentation Layout

All docs indexed at [`docs/README.md`](docs/README.md):

| Folder | Purpose |
|---|---|
| `docs/architecture/` | Audits, domain map, ADRs |
| `docs/design/` | **UI Standard v1.0** + `tokens.json` (mandatory for any UI work) |
| `docs/reports/` | Security, performance, testing, deployment |
| `docs/refactoring/` | Final report, archived files log |
| `docs/api/` | OpenAPI (`openapi.json`), API docs |
| `docs/postman/` | All Postman collections |
| `docs/logs/` | Log strategy (`storage/logs/` for files) |
| `docs/guides/`, `features/`, `fixes/`, `server/` | Operational docs |

**UI / Design System (mandatory for agents):** before building or redesigning any screen, read [`docs/design/PHYZIOLINE_UI_STANDARD.md`](docs/design/PHYZIOLINE_UI_STANDARD.md) and [`docs/design/tokens.json`](docs/design/tokens.json). Brand primary for new work is `#07787C` (logo); dashboard font is Cairo; no per-module visual forks. Seller U0 design (approved 2026-09-29, on Standard 1.1): https://claude.ai/artifact/S6K285RT1ndLSLuVjfkuA9 — implement U1 only after marketplace A4b (see marketplace roadmap). Cursor rule: `.cursor/rules/phyzioline-ui-standard.mdc`.

---

# AI AGENT EXECUTION RULES (MANDATORY)

These rules override all other instructions; breaking one is a failed implementation.
**Full text, with the incident behind each rule: [`docs/architecture/agent-rules.md`](docs/architecture/agent-rules.md)** — read the rule there before work it covers.

1. **Read before modify** — the target file and its imports, routes, controllers, services, models, requests, resources, migrations, tests. Never code from assumptions.
2. **No duplication** — search the repo before creating any class; reuse / extend / consolidate.
3. **Respect the structure** — every file in its module and layer (`Modules/{Module}/app/{Domain,Application,Infrastructure,Presentation}/`); no random folders or root files.
4. **No file scattering** — a new file says why it exists, why nothing existing fits, where it belongs.
5. **Architecture first** — code found outside the target architecture goes into the migration plan, not ignored.
6. **Fix the root cause** — trace the dependencies; never patch symptoms.
7. **Screenshots / errors / logs** — trace source file and execution path before fixing; no blind fixes.
8. **Module completeness** — routes, controllers, services, repositories, DTOs, requests, resources, policies, events, jobs, tests, API docs.
9. **Think like a staff engineer** — reusable, scalable, testable, secure, no new tech debt.
10. **No shortcuts** — no quick fixes, hacks, copy-paste or duplicate classes / APIs / tables / logic.
11. **Verify before finishing** — routes, APIs, imports, tests pass, no duplication, architecture respected.
12. **When in doubt, inspect more.**
13. **No hardcoded locale strings** — no `app()->getLocale() === 'ar' ? '…' : '…'` (or `$isAr`/`$isRtl` ternaries / `@if` blocks around literals). UI text → `__('English sentence')` with en.json + ar.json; bilingual values / CSS keywords → `LocaleSupport::pickBilingual()`. CI gate: `php artisan administration:fix-hardcoded-locale-strings --check`. Allowlist: `Modules/Administration/config/i18n-ternary-allowlist.php` (rare, with a reason).
14. **Every new notification ships with push (FCM)** — `SendsPushNotification` trait + `'fcm'` beside every `'database'` in `via()`; a skipped push is commented. New `data.type` → `docs/api/mobile-push-notifications-2026-09-10.md`. Read the mechanism table in the full text before touching `FcmChannel` / `FcmHttpPushService`.
15. **UI Standard** — read `docs/design/tokens.json` and `docs/design/PHYZIOLINE_UI_STANDARD.md` first; brand `#07787C`, Cairo, no magic numbers or per-module forks; touched screens move onto the tokens (§27 checklist; gaps listed in the PR).
16. **Sign-up and login are critical paths** — a form and its Form Request change together; every account type × path keeps a passing end-to-end test (`Modules/Authentication/tests/Feature/SignupCriticalPathTest.php`, `tests/Browser/Authentication/signup.spec.ts`); never skip or loosen them; every string has Arabic.
17. **AI engine boundaries** — new AI logic goes in the Python engine (`docs/architecture/ai-engine-python-roadmap.md`); no new LLM call from PHP; money, permissions, patient records and login stay deterministic Laravel; send a provider only what the task needs (no contact details, national ids or full names); engine host: owner 2026-10-28 allowed the first deploy on the current VPS with RAM/load watch, credits charged (D2/D16) — open unit flags as `shadow` first.
18. **New features are built in Python, screens included** (owner, D21) — existing PHP stays PHP until it is moved; login, roles, money, OAuth and migrations stay in Laravel; one look (tokens, Cairo, RTL, Arabic); on the VPS only under RULE 17's limits. Recorded exceptions (owner-approved, with reasons) are listed under RULE 18 in the full text — e.g. `Modules/DemoBooking` (2026-11-09).
19. **Web and app ship together** (owner, 2026-11-21) — every user-facing change on the website ships in the Flutter app (`C:\D\APP\Phyzioline-mobile-app`, `development`) in the same piece of work: an `/api/v1` endpoint on the **same** service as the web (Pest test + `docs/api/` page), the app side in Clean Architecture (data → domain → cubit/page, DI), a clean native UI (tokens, Cairo, RTL, ar + en strings, no overflow at 360 px), tests on both sides. Admin-only back-office is exempt; an app half that cannot ship now is logged in `docs/api/mobile-web-parity-plan-2026-11-09.md`, never left silent.
