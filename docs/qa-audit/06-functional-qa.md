# 06 — Functional QA (Completed Pass)

**Repo:** `phyzioline/inventory-app`  
**Date:** 2026-07-30 (re-run after Phases A–C + Staff RBAC / cycle count)  
**Mode:** Scenario matrix + automated Pest on `phyzioline_inventory_test` only  
**Identity:** remote `inventory-app.git` · no `Modules/` ✓

---

## Safety preflight

| Check | Result |
|-------|--------|
| `.env.testing` `DB_DATABASE` | `phyzioline_inventory_test` |
| `phpunit.xml` force | `phyzioline_inventory_test` |
| Command | `./vendor/bin/pest` |

---

## Classification legend

| Tag | Meaning |
|-----|---------|
| **Pass** | Confirmed by Pest or controlled HTTP smoke |
| **Fail** | Confirmed bug (none open in this re-run baseline) |
| **Risk** | Works in happy path; edge not fully automated |
| **Gap** | Scenario not automated / product incomplete |
| **N/R** | Needs browser/manual (SPA-only) |

Severity: **P0** blocking money/stock · **P1** high · **P2** medium · **P3** low

---

## Domain scenario matrix

### Auth & session

| # | Scenario | Steps | Expected | Actual | Sev | Status |
|---|----------|-------|----------|--------|-----|--------|
| A1 | Unauthenticated API | GET `/channels` no session | 401 | 401 | P0 | **Pass** (`ApiAuthzAndIdorTest`) |
| A2 | Login → me | POST login, GET `/auth/me` | user + role + abilities | role=`owner`, abilities present | P0 | **Pass** |
| A3 | Staff viewer cannot invite | Viewer membership + POST `/staff` | 403 | 403 | P0 | **Pass** |
| A4 | Password change wrong current | POST change-password bad current | 422 | Covered in controller; no Pest yet | P2 | **Gap** |

### Permissions / RBAC

| # | Scenario | Expected | Actual | Sev | Status |
|---|----------|----------|--------|-----|--------|
| R1 | Owner wildcard | `*` abilities | Pass | P0 | **Pass** (`StaffRbacTest`) |
| R2 | Warehouse can transfer ability | `transfers.write` true | Pass | P1 | **Pass** |
| R3 | Accountant cannot marketplace import | 403 | 403 | P0 | **Pass** |
| R4 | Super-admin Gate::before | bypass Gates | Code + regenerate 403 for non-SA | P0 | **Pass** (`PhaseASecurity…`) |

### Catalog / SKUs / channels

| # | Scenario | Expected | Actual | Sev | Status |
|---|----------|----------|--------|-----|--------|
| C1 | List channels as owner | 200 | 200 | P1 | **Pass** (smoke) |
| C2 | Cross-tenant channel show | 404 | 404 | P0 | **Pass** (IDOR) |
| C3 | Cross-tenant SKU show | 404 | 404 | P0 | **Pass** (IDOR) |
| C4 | Channel create missing name | 422 | 422 | P1 | **Pass** |
| C5 | Add SKU dialog no wipe on refetch | Form stable while typing | Fixed `wasOpenRef` | P1 | **Pass** (code + prior UI fix; N/R browser) |
| C6 | FBA/FBM pages list channel SKUs | Not ComingSoon | Pages implemented | P2 | **Pass** (code); N/R browser |

### Warehouses / transfers / cycle count

| # | Scenario | Expected | Actual | Sev | Status |
|---|----------|----------|--------|-----|--------|
| W1 | List warehouses | 200 | 200 | P1 | **Pass** |
| W2 | Transfer empty body | 422 | 422 | P1 | **Pass** |
| W3 | Transfer batch legacy inventory | Stock moves | Covered existing suite | P0 | **Pass** |
| W4 | Cycle count create + record | 201 + lines saved | Pass | P1 | **Pass** (smoke) |
| W5 | Cycle count post variances | Adjustments posted | Service path exists; thin Pest | P1 | **Risk** |

### Suppliers / customers / purchases

| # | Scenario | Expected | Actual | Sev | Status |
|---|----------|----------|--------|-----|--------|
| S1 | List suppliers/customers | 200 | 200 | P1 | **Pass** |
| S2 | Supplier pay + SpendGuard | Payment + balance↓ | Pass | P0 | **Pass** (`PhaseA…`) |
| S3 | Smart purchase Gemini | Import works | No Pest (external API) | P2 | **Gap** |

### Marketplace import / orders

| # | Scenario | Expected | Actual | Sev | Status |
|---|----------|----------|--------|-----|--------|
| M1 | Idempotent re-import | No double OUT | Suite green | P0 | **Pass** |
| M2 | Missing file | 422 | 422 | P1 | **Pass** |
| M3 | Async job + poll | 202 + completed | Job + SPA poll; sync queue OK | P1 | **Risk** (no dedicated Pest for job cache) |
| M4 | Rollback Gate + ability | AuthZ required | Gate + policy | P0 | **Pass** (policy); thin HTTP Pest |

### Returns / treasury / settlements / profit

| # | Scenario | Expected | Actual | Sev | Status |
|---|----------|----------|--------|-----|--------|
| T1 | Manual customer return ledger | Consistent | Existing suite | P0 | **Pass** |
| T2 | Merchant restock | Stock IN | Existing suite | P0 | **Pass** |
| T3 | Treasury panels | 200 no morph error | Morph map fixed | P0 | **Pass** |
| T4 | Settlement import atomicity | All-or-nothing | Existing suite | P0 | **Pass** |
| T5 | ProfitDistribution IDOR | 404 other tenant | Pass | P0 | **Pass** |
| T6 | ProfitEngine COGS edge zero cost | Warning UX | UI only | P2 | **Gap** |
| T7 | Paymob webhook HMAC | Reject bad sig | No Pest | P0 | **Gap** |

### Reports / Excel / barcode / alerts

| # | Scenario | Expected | Actual | Sev | Status |
|---|----------|----------|--------|-----|--------|
| X1 | Reports loading/error | States shown | Code updated | P2 | **Risk** N/R |
| X2 | Low-stock alerts | Alerts fire | Not productized | P2 | **Gap** |
| X3 | Barcode receive/ship | Full flow | Partial | P2 | **Gap** |

---

## Automated coverage map (post completion)

| Domain | Pest? | Quality |
|--------|-------|---------|
| DB safety | Yes | Strong |
| Marketplace idempotency | Yes | Strong |
| Settlements | Yes | Strong |
| Returns + treasury | Yes | Strong |
| Transfers | Yes | Strong |
| AuthZ / IDOR / 401 / 422 | Yes | **New** `ApiAuthzAndIdorTest` |
| Staff RBAC abilities | Yes | Strong |
| Cycle count smoke | Yes | **New** thin |
| Supplier pay / ProfitDistribution | Yes | Strong |
| Paymob HMAC | **No** | Gap |
| Purchase Gemini | **No** | Gap |
| Full SPA e2e | **No** | N/R |

---

## Bugs found this pass

None open against the new matrix rows marked **Pass**. Remaining items are **Gap** / **Risk** (Paymob Pest, Gemini, browser e2e, cycle-count post deep test).

---

## Evidence

- `tests/Feature/ApiAuthzAndIdorTest.php`
- `tests/Feature/FunctionalDomainSmokeTest.php`
- `tests/Feature/StaffRbacTest.php`
- `tests/Feature/PhaseASecurityAndTreasuryTest.php`
- `tests/Feature/MarketplaceImportIdempotencyTest.php`
