# AI agent execution rules — full text

> Moved out of `CLAUDE.md` on 2026-10-25 (text unchanged). `CLAUDE.md` keeps a short version and links here.

## AI AGENT EXECUTION RULES (MANDATORY)

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

---

## RULE 13 — NO HARDCODED LOCALE STRINGS

Forbidden in any `.php` or `.blade.php` file:

* `app()->getLocale() === 'ar' ? '<literal>' : '<literal>'` (or `==`, or via
  a cached `$isAr`/`$isRtl` variable) — an inline bilingual ternary with a
  hardcoded string on either branch.
* `@if(app()->getLocale() === 'ar') ... @else ... @endif` used to branch
  between two hardcoded strings.

This is not a style preference. Incident: this exact pattern let Arabic text
leak into `en.json` (commit `e07011d1f`) and, separately, let a codemod
auto-convert `dir="{{ ... ? 'rtl' : 'ltr' }}"` into a locale-blind `__('ltr')`
that silently broke RTL layout across ~40 views before it was caught.

Instead:

* **Translatable UI text** → `__('English sentence')`. Search `en.json` for
  an existing equivalent key first (RULE 2 — consolidate, don't duplicate);
  add both `en.json` and `ar.json` entries for a new key.
* **Bilingual DB columns/values/technical selections** (a `name_en`/`name_ar`
  pair, a CSS direction keyword, an icon-direction suffix, a sort column) →
  `Modules\Administration\app\Infrastructure\Support\LocaleSupport::pickBilingual($english, $arabic)`.
  Never route a non-prose value through `__()` — a translation-catalog
  lookup is unsafe for anything that isn't a real sentence a human wrote for
  display.
* A pure locale-aware boolean (`$isRtl = app()->getLocale() === 'ar';`, or a
  bare `@if(app()->getLocale() === 'ar')` with no hardcoded strings inside) is
  not a violation — this rule bans hardcoded *strings*, not locale-aware
  logic.

**CI gate:** `php artisan administration:fix-hardcoded-locale-strings --check`
runs on every push/PR (`.github/workflows/ci.yml`, job
`i18n-hardcoded-strings`) and fails the build on any unallowlisted
occurrence. Run `php artisan administration:fix-hardcoded-locale-strings`
locally to auto-convert what it safely can and get a file:line report of
what needs a manual fix.

**Escape hatch:** a rare, genuinely non-UI-text edge case the tool can't
safely classify → add a narrow entry (exact file + snippet + reason) to
`Modules/Administration/config/i18n-ternary-allowlist.php`. This list must
stay small — it documents a real exception, never a shortcut to defer
translation debt.

---

## RULE 14 — EVERY NEW NOTIFICATION SHIPS WITH PUSH (FCM)

Mandatory whenever you add, or add a new trigger point for, any
`Illuminate\Notifications\Notification` subclass in
`Modules/*/app/Infrastructure/Notifications/`.

**Context:** as of 2026-09-11 all 45 in-app notification classes in this repo
carry push (`fcm` in `via()`), not just the 6 Home Visit ones that originally
had it. Mobile has no other way to learn about an event outside the app —
notifications are `database`-channel + REST polling only; there is no working
realtime channel (Reverb has no client, the socket.io bridge in
`infra/services/realtime/` matches a non-autoloadable class). **Push is not
an enhancement to add later — treat it as part of "the notification exists."**

**Rule:** any new user-facing action that gets a `database` notification gets
push by the same commit, by default. Do this:

1. `use Modules\Notifications\app\Infrastructure\Notifications\Concerns\SendsPushNotification;`
2. Add the trait alongside the existing ones: `use Queueable, SendsPushNotification;`
   (just `use SendsPushNotification;` if the class isn't `Queueable`).
3. Add `'fcm'` to every `via()` branch that already returns `'database'`.
   Leave a mail-only/anonymous-notifiable branch alone — `FcmChannel` already
   no-ops for a notifiable without a `devicePushTokens()` relation, so no
   per-notification special-casing is needed.
4. Leave the payload to the trait's default unless push needs something the
   database row doesn't carry (a deep-link id, e.g. `visit_id` in
   `HomeVisitAssignedNotification`) — then hand-write `toFcm()`. A hand-written
   `toFcm()` always wins over the trait's by ordinary PHP method resolution;
   never write a second title/body fallback chain by hand — call
   `NotificationService::deriveTitleBody()` (RULE 2: one fallback chain, not two).

**Only skip push** for a documented reason (sent solely to an
`AnonymousNotifiable`/raw email with no linked user, or genuinely internal
system noise nobody should be paged on) — put the reason in a comment next to
`via()`. Do not skip silently; a missing `'fcm'` should always be an explicit
choice a reviewer can see, not an oversight.

**The mechanism (read before changing any of these):**

| File | Role |
|---|---|
| `Modules/Notifications/app/Infrastructure/Notifications/Concerns/SendsPushNotification.php` | trait — default `toFcm()` from `toDatabase()`/`toArray()` |
| `Modules/Notifications/app/Infrastructure/Notifications/Channels/FcmChannel.php` | the `fcm` channel — dispatches the queued send, stamps `data.notification_id` |
| `Modules/Notifications/app/Infrastructure/Jobs/SendPushNotificationJob.php` | performs the FCM HTTP call off the request thread (queue `high`) |
| `Modules/Notifications/app/Infrastructure/Push/FcmHttpPushService.php` | FCM HTTP v1 transport — its token-deletion rules are deliberately narrow (a config error like a wrong `FCM_PROJECT_ID` must never mass-delete tokens); don't loosen them without re-reading why each branch exists |

**Also update** `docs/api/mobile-push-notifications-2026-09-10.md` whenever a
new `data.type` value is introduced — the mobile app switches on it for
deep-linking and a badge refresh; an undocumented type does nothing on tap.

**Dev/local note:** push is disabled (`FCM_ENABLED=false`) until a real
Firebase project exists — `FcmHttpPushService::isEnabled()` no-ops safely
when `FCM_ENABLED`/`FCM_PROJECT_ID`/`FCM_CREDENTIALS_PATH` are unset. "Push
doesn't fire locally" is the expected state, not a bug to route around.

---

## RULE 15 — PHYZIOLINE UI STANDARD (NO ONE-OFF VISUAL SYSTEMS)

Mandatory for any new, redesigned, **or touched existing** UI (Blade, CSS,
dashboard, seller, clinic, admin).

1. Read [`docs/design/tokens.json`](docs/design/tokens.json) and
   [`docs/design/PHYZIOLINE_UI_STANDARD.md`](docs/design/PHYZIOLINE_UI_STANDARD.md)
   **before** inventing sizes, colors, or layouts.
2. Brand primary for new work: `#07787C` (logo). Dashboard font: **Cairo**.
3. No magic numbers / per-module design forks. Pass the checklist in the
   Standard §27 before marking UI work done.
4. **Existing UI too:** touching an existing screen brings the parts you touch
   onto the tokens; anything left out of scope is listed in the PR, never left
   silently. Reviewing an old screen = the §27 checklist, each failed line reported.
5. Clinic hubs still follow `clinic-unified-ui.mdc`; seller U1 only after
   marketplace A4b (or after B7) — see marketplace-extraction-roadmap.
6. Cursor always-on rule: `.cursor/rules/phyzioline-ui-standard.mdc`.

---

## RULE 16 — SIGN-UP AND LOGIN ARE CRITICAL PATHS (TESTED, NEVER SILENT)

Mandatory for any change that touches sign-up, login, OTP, password reset, or
the links that lead into them — forms, Form Requests, controllers, services,
`login.css`, and any CTA that points at `view_register.*`, `view_login.*`,
`company.register.*` or `auth.social.*`.

**Incident (found 2026-10-14):** commit `9f791c061` (2026-07-21) made the
server require `clinic_name` for every clinic, but the `/register` page — where
the /erp "Start free trial" button lands — never had that field. Every clinic
that tried to sign up there for ~3 months was refused with
"اسم العيادة is required", and nothing alerted anyone. The same commit made
every "log in" link that carries `?type=clinic` open the sign-up form instead
of login. `/register/company` was refused the same way (no `country`, no
email confirmation), and its only happy-path test had been marked skipped.

**Rules:**

1. **A form and its Form Request change together.** A field the server
   requires must be rendered, visible and enabled for that account type in
   every form that posts to it. Adding a required rule without the field (or
   removing a field the server still requires) is a production outage.
2. **Every account type × every path has a passing end-to-end test.**
   `Modules/Authentication/tests/Feature/SignupCriticalPathTest.php` posts each
   form exactly as the page renders it and finishes OTP. When you add an
   account type, a sign-up form, or a required field, extend it in the same
   commit.
3. **Never skip or loosen these tests** (`markTestSkipped`, `assertRedirect()`
   alone on a POST that can fail validation). Assert the outcome: no session
   errors, the user exists with the right type, the OTP page is reached.
4. **The real-browser path stays green:** `tests/Browser/Authentication/signup.spec.ts`
   (`@smoke`, blocking in CI) drives /erp → "Start free trial" → clinic
   sign-up → OTP page in Chromium. JavaScript that shows/requires fields is
   only proven there.
5. **Every string on these pages has Arabic** — a `__()` key without an
   `ar.json` entry shows English to an Arabic visitor mid-sign-up. The
   critical-path test checks the auth pages' keys.
6. Run before committing any such change:
   `./vendor/bin/pest Modules/Authentication/tests/Feature/SignupCriticalPathTest.php`
   (CI runs it as its own named step before the full suite).

---

## RULE 17 — AI ENGINE BOUNDARIES (PYTHON THINKS, LARAVEL DECIDES AND WRITES)

Mandatory for any change that adds or touches AI behaviour in any module: prompts,
agents, LLM calls, retrieval, tool definitions, `Modules/AI/**`, or the `ai-engine` repo.

**Context:** on 2026-10-12 the owner moved all AI "thinking" to a Python engine
(`docs/architecture/ai-engine-python-roadmap.md`). The 2026-10-15 assessment found 13 PHP
files calling an LLM provider directly and the account's email/phone in every chat prompt
(`docs/architecture/ai-engine-assessment.md`).

**Rules:**

1. **New AI logic goes in the engine.** PHP AI code is frozen except bug fixes. A new AI
   feature in any module is an engine capability the module calls through its decision
   point, with a deterministic fallback shown as `degraded`.
2. **No new LLM provider call from PHP.** The 13 existing call sites are recorded debt
   (assessment §2) and the Phase 1 exit gate is zero.
3. **The 18 rules and the definition of done apply** —
   `docs/architecture/ai-security-and-governance.md`. Update the capability's row in
   `docs/architecture/ai-traceability-matrix.md` in the same commit.
4. **Money, permissions, patient-record rules and login stay deterministic Laravel code.**
   The model proposes, code applies. No LLM in the `Authentication` path. Authorization is
   checked by Laravel at execution time with the user's own token (ADR-006), never taken
   from model output — including tenant/clinic ids.
5. **Send a provider only what the task needs.** Account and patient contact details,
   national ids and full names never go into a prompt; patients are referred to by id.
   Every outbound payload change gets a test asserting what is *not* sent.
6. **Data ownership (ADR-007):** migrations stay in Laravel; the engine writes only AI
   tables through its own DB role; business data reaches it only through tools.
7. **The engine may run on the current production VPS, with limits** (D2, owner 2026-10-28,
   reversing 2026-10-15): bound to localhost, no local model beside it (the 2026-10-27 outage),
   flags open as `shadow` first, RAM and load watched; sustained pressure means scale or split
   the host. `scripts/check` in the engine repo must pass before every engine commit.
8. Read the roadmap's status table (§12) before AI work and update it when a phase or
   slice changes state.

---

## RULE 18 — NEW FEATURES ARE BUILT IN PYTHON (SCREENS INCLUDED)

Mandatory from 2026-10-19 (owner's decision, roadmap D21) for any **new** feature, screen,
service, integration or module — not only AI.

**Rules:**

1. **New = Python.** A new feature is written in the Python repo (`ai-engine`,
   `C:\D\phyzioline-ai-engine`) — its logic, its jobs and its screens (FastAPI + Jinja2).
   Do not start a new nwidart module, controller, service or Blade screen for it.
2. **Existing PHP stays PHP until it is moved.** Bug fixes and changes to a feature that
   already exists in PHP are made in PHP. Moving an existing feature follows the roadmap's
   phases — never a Big Bang rewrite.
3. **What stays in Laravel, even for a Python feature** (RULE 16, 17.4, ADR-006/007,
   Phase E): login, sign-up and OTP; roles and permissions (the portal role decides who may
   open the feature — Python receives identity only as a short-lived signed token from
   Laravel, never its own passwords); money and payments; OAuth and stored credentials
   (`Modules/Connectors`); and **migrations** — one PostgreSQL schema, the table's migration
   goes in the Laravel module that owns the domain. Python reads and writes its own tables
   through its own restricted DB role, and reaches any other module's data only through
   Laravel tools (MCP).
4. **One look.** Python screens use `docs/design/tokens.json`, Cairo, `#07787C`, RTL and
   Arabic for every string (RULE 13, 15) — no visual fork. Laravel links to them from the
   dashboard only when the feature's `*_URL` is configured.
5. **The server.** A Python feature is built and tested locally in full; on the current VPS
   only under RULE 17.7's limits (D2 as amended 2026-10-28).
6. `scripts/check` in the Python repo passes before every commit; the Laravel side (role,
   migrations, token, tools) gets its own Pest tests.

First feature under this rule: the social media workspace —
`docs/architecture/social-ops-workspace.md`.

**Recorded exceptions** (each one decided by the owner, with its reason; a new exception is
added here, never assumed):

| Date | Feature | Built in | Why | Boundary kept |
|---|---|---|---|---|
| 2026-11-17 | Course quizzes + certificate rules (wizard steps 4–5 of the instructor course wizard; `docs/features/course-quizzes-and-certificate.md`) | Laravel | Owner asked for them as new steps of the existing PHP course wizard, "same look"; grading and certificate issuing touch enrollments and certificates, which stay deterministic Laravel (RULE 17). | No AI in grading. AI-written questions later (e.g. "suggest questions from this lesson") are built in the Python engine and only hand drafts to the instructor's form. |
| 2026-11-09 | Clinic demo meeting booking (`Modules/DemoBooking`, spec `DEMO_BOOKING_SPEC.md`) | Laravel | Almost all of it is CRM leads, email, the scheduler and admin pages — all already in Laravel; in Python it would need two services talking for a simple flow. | Any AI added to it later (meeting summary, lead scoring) is built in the Python engine and talks to the module through API / events (`DemoBooked`, `DemoBookingStatusChanged`). |

---

## RULE 19 — WEB AND APP SHIP TOGETHER (PARITY IS MANDATORY)

**Owner, 2026-11-21:** "anything done on the website is done in the app too — mandatory,
with a clean UI and clean architecture, details done properly."

**Incidents behind it.** 2026-11-20: phone / WhatsApp sign-in and sign-up went live on the
website (0a6e18070) while the app still had e-mail only, and Google sign-ups from the app
were stored without a chosen country. 2026-11-21: the video watch log (3dd06a5c0) counted
web students only — the app had no heartbeat and no endpoint, so app students stayed at 0 %.

1. **A user-facing change is not done until both sides have it.** Every feature, flow, field,
   rule or fix a user can see or feel on the website (screens, sign-in / sign-up, payments,
   progress, notifications, validation messages) ships in the Flutter app
   (`C:\D\APP\Phyzioline-mobile-app`, branch `development`) in the same piece of work.
   Admin-only back-office pages are exempt unless the app already has that area.
2. **Server first, shared logic once.** The app gets an `/api/v1` endpoint that calls the
   **same** service as the web controller (no second copy of the rule — RULE 2), answers in
   `MobileResponse`, has a Pest test, and its request / response is written in `docs/api/`.
3. **App side in Clean Architecture.** `data` (remote data source, models) → `domain`
   (repository contract, use case, entities) → `presentation` (cubit + page), registered in
   the feature's `*_di.dart`; no API calls from widgets.
4. **Clean, native UI — not a copy of the web page.** App theme and tokens (`#07787C`, Cairo),
   RTL, every string in `app_ar.arb` + `app_en.arb`, checked at 360 px Arabic with no overflow
   (a widget test that pumps the page at that size), loading / error / empty states.
5. **Tests on both sides.** Pest for the endpoint; Flutter unit tests for the use case /
   cubit and a widget test for the screen; `flutter analyze` clean.
6. **If the app half cannot be done now** (a store release, a missing design decision), say
   so in the hand-over and log it in `docs/api/mobile-web-parity-plan-2026-11-09.md` with
   what is missing — never leave it silent.
