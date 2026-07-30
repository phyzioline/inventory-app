# 13 — Executive Scorecard (Unified report)

**Date:** 2026-07-30  
**Repo:** `phyzioline/inventory-app`  
**Purpose:** Single executable summary after completing partial agents + post-implementation refresh.  
**Tests:** Pest on `phyzioline_inventory_test` only.

---

## 1. Bugs

| ID | Type | Finding | Severity | Status |
|----|------|---------|----------|--------|
| B1 | Security | ProfitDistribution without tenant scope | P0 | **Fixed** |
| B2 | Security | regenerate-master-products client `user_id` | P0 | **Fixed** |
| B3 | Logic | Supplier pay without SpendGuard / Payment | P0 | **Fixed** |
| B4 | DB/Logic | Legacy morph `App\Models\Inventory\InventoryOrder` | P0 | **Fixed** |
| B5 | Test/Logic | Marketplace idempotency suite red | P0 | **Fixed** |
| B6 | UI | AddSKU form wipe on refetch | P1 | **Fixed** |
| B7 | API/AuthZ | Import ability checked after validation → wrong 422 | P1 | **Fixed** (this pass) |
| B8 | Risk | Response shapes inconsistent | P2 | Open (Opinion/Risk) |
| B9 | Gap | Paymob HMAC untested | P0 test gap | **Fixed** (PaymobWebhookHmacTest) |

---

## 2. Feature gaps (still material)

| Gap | Priority | Notes |
|-----|----------|-------|
| Low-stock alerts + reorder points | High | **MVP shipped** (`LowStockAlertService` + `/inventory/low-stock`) |
| Immutable stock ledger / full audit coverage | High | Broader: pay / settlement delete / transfer / cycle post (+ cancel/rollback) |
| Full valuation method switch (FIFO vs weighted) UX | Med | Engine exists; productization thin |
| Paymob / webhook automated tests | High | **Fixed** |
| Deep FBA ops (not just SKU list) | Med | MVP pages only |
| Lot/serial end-to-end UI | Med | Columns exist; UI minimal |
| Cycle count post deep + print | Med | MVP API + page |
| Tauri parity | Low | Separate client |

---

## 3. Improvement suggestions

1. Expand `InventoryAuditLogService` to supplier pay, settlement delete, transfer batch.
2. Add `PaymobWebhookHmacTest` before next subscription change.
3. Sample write-IDOR Pest for `PUT/DELETE` on channels/orders.
4. Prefer `{ success, data, error }` envelope on new endpoints only.
5. Keep CI safety workflow blocking wrong `DB_DATABASE`.

---

## 4. Priorities (Now / Next / Later)

### Now
- Keep Pest green on test DB
- Ship SPA build when requested (`public/app/`)
- Paymob HMAC Pest

### Next
- Low-stock alerts
- Broader audit log coverage
- Write-path IDOR sampling
- Cycle-count post deep tests

### Later
- OpenAPI, uniform resources
- Full WMS lot/serial workflows
- Tauri parity
- Phase 2 auto-patch PRs

---

## 5. Domain completion %

Scores = product completeness × test confidence (judgment from Discovery + Feature Gap + this pass).  
100% = professional WMS/accounting for that domain.

| Domain | % | Notes |
|--------|--:|-------|
| Auth / session | 85 | Solid; password-edge Pest thin |
| Staff RBAC | 70 | v1 roles live; not every route gated |
| Master products / SKUs | 80 | Strong; AddSKU UI fixed |
| Channels | 75 | Core good; FBA/FBM MVP only |
| Warehouses / transfers | 80 | Covered + Pest |
| Cycle counts | 45 | MVP |
| Lot / serial | 25 | Columns only |
| Purchases | 70 | Gemini external untested |
| Marketplace import | 85 | Idempotency + async + AuthZ |
| Orders / sales | 75 | Strong import path |
| Returns | 80 | Suites green |
| Treasury | 75 | SpendGuard + panels |
| Settlements | 80 | Atomic import tested |
| Profit / COGS | 70 | Engine strong; edges Gap |
| Reports / KPIs | 55 | Loading UX better; alerts missing |
| Subscriptions / Paymob | 60 | Live path; HMAC Pest Gap |
| Architecture / CA placement | 85 | Layers respected |
| DB integrity | 75 | Soft deletes + partial unique; more indexes Later |

**Overall inventory product (weighted critical paths): ~72%**

---

## 6. Agents completion

| # | Agent | Report status |
|---|--------|---------------|
| 01 | Discovery | Refresh needed → see §7 + `01` update |
| 02 | Security | Done (design + P0 fixes) |
| 03 | Business Logic | Done |
| 04 | Feature Gap | Done (living) |
| 05 | Architecture | Done |
| 06 | Functional QA | **Completed this pass** (matrix + Pest) |
| 07 | UI/UX | Done + form fix |
| 08 | Performance | Done (design) |
| 09 | Database | Done + Phase C migrations |
| 10 | API Testing | **Completed this pass** (executed) |
| — | Unified scorecard | **This file** |
| — | CI safety checklist | `.github/workflows/inventory-qa-safety.yml` |
| — | Phase 2 auto patches/PRs | **Scaffolding** — `14-phase-2.md` + `inventory:qa-propose-patches` (no auto-PR) |

---

## 7. System map delta (post-implementation)

| Metric (was → now) | Value |
|--------------------|------:|
| Application services | ~31 |
| Queue Jobs | 1 (`ProcessMarketplaceImportJob`) |
| Formal Policies | 1 (`DestructiveInventoryPolicy`) |
| Form Requests | 5 |
| Staff RBAC | `tenant_memberships` + `TenantContext` |
| Cycle counts | tables + API + SPA page |
| Audit logs | `inventory_audit_logs` |

Full narrative map remains in `01-discovery-report.md` (snapshot section updated).

---

## 8. Evidence index

| Artifact | Path |
|----------|------|
| Functional matrix | `docs/qa-audit/06-functional-qa.md` |
| API execution | `docs/qa-audit/10-api.md` |
| Feature gaps | `docs/qa-audit/04-feature-gap.md` |
| Roadmap | `docs/qa-audit/ROADMAP.md` |
| New Pest | `tests/Feature/ApiAuthzAndIdorTest.php`, `FunctionalDomainSmokeTest.php` |
| Safety CI | `.github/workflows/inventory-qa-safety.yml` |
