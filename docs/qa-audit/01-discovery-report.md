# Discovery Report — inventory-app

**Date:** 2026-07-30  
**Agent:** Project Discovery  
**Identity check:** `pwd` = inventory.phyzioline.com · remote = `phyzioline/inventory-app.git` · **no `Modules/`**

---

## 1. System snapshot

| Metric | Value |
|--------|------:|
| Migrations | 83 |
| Application services | 27 |
| API controllers | ~48 |
| Domain WMS models | 48 |
| Route declarations | ~168 (`/api/inventory`) |
| SPA pages (lazy) | 50 |
| Pest/PHPUnit test files | 17 (+ Pest.php/TestCase) |
| Queue Jobs | **0** |
| Formal Policies | **0** |

**Auth:** Sanctum session + CSRF · `Gate::before` super-admin bypass · tenant isolation via `IsIsolatedByUser`  
**DB safety:** `.env.testing` + `phpunit.xml` force `phyzioline_inventory_test` · `DatabaseSafetyGuard`

---

## 2. Domain map (backend → UI)

| Domain | Key services / models | Primary UI | Critical? |
|--------|----------------------|------------|-----------|
| Marketplace import + stock OUT | `MarketplaceImportService`, orders/items, `stock_deduction_status` | `Orders`, `OrderImportDialog` | **YES** |
| Channels / SKUs | `Channel`, `Sku`, `ChannelStockResolver`, import dialogs | `Channels`, `ChannelDetail`, `AddSKUDialog` | YES |
| Master catalog | `MasterProduct`, `MatchingEngineService`, product import | `MasterProducts`, import/drafts | YES |
| Warehouses / transfers | `InventoryTransactionService`, locations, tracker | `Warehouses`, `Transfers`, transfer dialogs | YES |
| Purchases | `PurchaseImportService` (Gemini), batches, receive | `PurchaseInvoices`, `SmartPurchaseImport` | YES |
| Returns + ledger | `InventoryReturnMutationService`, import, restock | `Returns`, return dialogs | **YES** |
| Settlements | `SettlementService` + reconcile commands | `Reconciliation` | YES |
| Treasury / cash | `TreasuryLedgerService`, `TreasurySpendGuard`, sulfa | Bank, Receipts, Payments, Capital, Sulfa | **YES** |
| Profit / COGS | `ProfitEngineService`, `InventoryValuationService` | `ProfitEngine` (multi-view) | YES |
| CRM | Customer / Vendor / Supplier | `CustomersSuppliers` | med |
| Subscriptions | `SubscriptionCheckoutService`, Paymob | `Subscription`, Admin | med |
| Reports / dashboard | metrics, dead-stock, margin alerts | `Dashboard`, `Reports` | med |
| Amazon tools | ASINs, removals; FBA/FBM pages | ASINs live; **FBA/FBM ComingSoon** | gap |

---

## 3. Clean Architecture layout

```
app/
  Application/Services/   (27 — orchestration)
  Application/DTOs/       (thin — mostly invoice)
  Domain/Models/Wms/      (48)
  Domain/Events/          (5)
  Infrastructure/         Observers, Paymob, Gemini, morph helpers
  Presentation/Http/Api/  Controllers
  Presentation/Console/   Ops / reconcile / repair commands
  Models/User.php         Auth
  Support/DatabaseSafetyGuard.php
resources/frontend/src/   React SPA → public/app/
```

---

## 4. Test coverage (critical paths)

**Present:** marketplace import idempotency · settlement atomicity · treasury panel · customer return ledger · merchant restock · return transitions · transfers · DB safety guard · report queries.

**Missing / weak:** `ProfitEngineService` · `TreasurySpendGuard` unit/feature · Paymob webhook · purchase smart-import · invoice edit · order mutation · channel SKU CRUD · policies (N/A) · SPA e2e.

---

## 5. Top 10 risks / gaps (priority for next agents)

| # | Finding | Type | Priority | Next agent |
|---|---------|------|----------|------------|
| 1 | No resource Policies — any auth user can hit destructive APIs (rollback, cancel, withdrawals) | Security | **High** | Security |
| 2 | Fat controllers (e.g. InventoryTransaction ~1.3k LOC, PurchaseImport ~1.2k) — validation inline, no Form Requests | Architecture | **High** | Architecture |
| 3 | No Jobs/queues — large imports & Gemini run in HTTP request | Perf / Reliability | **High** | Performance |
| 4 | Money-path tests thin: ProfitEngine, SpendGuard, Paymob, PurchaseImport | QA gap | **High** | Business Logic + Functional |
| 5 | `TreasurySpendGuard` not centralized; supplier pay has accounting TODO | Logic | **High** | Business Logic |
| 6 | SPA fat pages (ProfitEngine 2.3k+, Returns/Orders/Purchases >1k) + weak loading on some reports | UX | Medium | UI & UX |
| 7 | No global 401→login redirect; upload timeout=0 | UX / API | Medium | UI + API |
| 8 | Amazon FBA/FBM routes are ComingSoon stubs | Feature gap | Medium | Feature Gap |
| 9 | Misleading `ReturnItem` → table `returns`; legacy `Product` morph shim | Maintainability | Medium | Architecture + DB |
| 10 | Subscription limits only on channel/warehouse create; reorder/audit-trail incomplete vs WMS best practice | Feature gap | Medium–High | Feature Gap |

---

## 6. Domain completeness (estimate)

Judgement from code + UI presence + tests — not a formal scorecard yet.

| Domain | Estimate | Notes |
|--------|--------:|-------|
| Marketplace import | 75% | Strong service + idempotency tests + repair commands |
| Returns | 75% | Good mutation tests; naming debt |
| Channels / SKU | 70% | Full UI; form-reset bug fixed 2026-07-30 |
| Purchases | 70% | Gemini dependency risk; fat controller |
| Settlements | 70% | Import + CLI reconcile |
| Warehouses / transfers | 65% | Tests for transfer; adjustments mixed patterns |
| Treasury | 60% | Guard exists but uneven enforcement |
| Profit / COGS | 55% | Large UI; thin automated tests |
| AuthZ / fine permissions | 35% | Tenant isolation only |
| Queue / async ops | 10% | None |
| Full cycle count / audit trail | 30–40% | Adjustments + transactions exist; full audit incomplete |
| Reorder points / alerts | 40% | Dashboard low-stock exists; not full reorder workflow |
| FBA/FBM channel UX | 15% | ComingSoon |

---

## 7. Recommended next runs (in order)

1. **Security Review Agent** — IDOR / missing policies on money+stock mutations  
2. **Business Logic Agent** — SpendGuard coverage matrix + import idempotency walk  
3. **Feature Gap Agent** — WMS checklist (count cycle, audit trail, reorder, batches)  
4. **Architecture Agent** — fat controller / Form Request plan  
5. **Functional QA** — Pest expansion on High gaps (test DB only)

---

## Evidence anchors

- Services: `app/Application/Services/`  
- Critical rules: `.cursor/rules/inventory-critical-paths.mdc`  
- Tests: `tests/Feature/*`, `tests/Unit/*`  
- SPA router: `resources/frontend/src/lib/App.tsx`  
- API: `routes/api.php`, `resources/frontend/src/lib/api.ts`
