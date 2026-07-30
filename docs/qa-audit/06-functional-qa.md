# 06 — Functional QA (Existing Pest Suite)

**Repo:** `phyzioline/inventory-app` — `/home/phyzioline-inventory/htdocs/inventory.phyzioline.com`  
**Date:** 2026-07-30  
**Mode:** Run existing suite only — **no new tests authored**  
**Identity:** remote `phyzioline/inventory-app.git` · no `Modules/` ✓

---

## 1. Safety preflight

| Check | Result |
|-------|--------|
| `pwd` | `/home/phyzioline-inventory/htdocs/inventory.phyzioline.com` |
| `git remote` | `https://github.com/phyzioline/inventory-app.git` |
| `.env` `DB_DATABASE` | `phyzioline_inventory` (prod — not used by Pest) |
| `.env.testing` `DB_DATABASE` | `phyzioline_inventory_test` ✓ |
| `phpunit.xml` | `DB_DATABASE=phyzioline_inventory_test` **force="true"** ✓ |
| Test DB exists | `phyzioline_inventory_test` present on PostgreSQL ✓ |

Command run:

```bash
./vendor/bin/pest --colors=never
```

DB target confirmed: `phyzioline_inventory_test` (see UniqueConstraintViolation connection detail in failure output).

---

## 2. Suite result summary

| Metric | Value |
|--------|------:|
| Passed | **45** |
| Failed | **9** |
| Assertions | 143 |
| Duration | ~6.2s |
| Listed tests | 54 Pest cases across 17 files |

**Verdict:** Suite is **not green**. Critical-path coverage exists but marketplace import idempotency regressions dominate failures.

---

## 3. Pass / fail matrix by file

| File | Result | Notes |
|------|--------|-------|
| `Unit/DatabaseSafetyGuardTest` | PASS (2) | Prod wipe guard OK |
| `Unit/InventoryReportQueryServiceTest` | PASS (2) | |
| `Unit/InventoryReturnImportServiceTest` | PASS (3) | |
| `Unit/MarketplaceDateParsingTest` | PASS (2) | Egypt DMY |
| `Unit/SettlementReturnSyncTest` | PASS (8) | Claim line filters |
| `Feature/DashboardMetricsServiceTest` | PASS (1) | |
| `Feature/InventoryPaginationTest` | PASS (1) | |
| `Feature/InventoryPhaseAFixesTest` | PASS (2) | SKU name / offer whitelist |
| `Feature/InventoryTransferBroadcastTest` | PASS (1) | |
| `Feature/InventoryTransferLegacyInventoryTest` | PASS (2) | Legacy sku_inventory merge |
| `Feature/ManualCustomerReturnLedgerAndTreasuryTest` | PASS (3) | Ledger + cash refund + insufficient treasury |
| `Feature/MerchantReturnReceiveRestockTest` | PASS (2) | Merchant restock / FBA no auto-restock |
| `Feature/ModuleSmokeTest` | PASS (2) | |
| `Feature/ReturnStatusTransitionTest` | PASS (2) | |
| `Feature/SettlementImportAtomicityTest` | PASS (3) | Rollback + `--user` scope |
| `Feature/MarketplaceImportIdempotencyTest` | **FAIL 8 / PASS 8** | See §4 |
| `Feature/TreasuryPanelTest` | **FAIL 1 / PASS 1** | Legacy morph class missing |

---

## 4. Failed cases (detail)

### 4.1 MarketplaceImportIdempotencyTest (8 failures)

Dominant exception: `ValidationException` — Arabic message:

> يوجد 1 صفّاً يتطلب خصماً من المخزون لكن الرصيد غير كافٍ …

Thrown from `MarketplaceImportService` (~lines 122–146) when import gate blocks on insufficient stock.

| Case group | Symptom |
|------------|---------|
| SKU drift idempotency | ValidationException (shortage gate) |
| Historical import ×2 / new on top | ValidationException |
| Stock deduction status durable tags | ValidationException / related |
| Order id column re-import | ValidationException |
| hasPriorImportedOrderDeduction | ValidationException |
| Preview row sampling (blocking shortages) | ValidationException |
| One case | `UniqueConstraintViolationException` on `skus_user_channel_sku_unique` (`user_id, channel_id, sku`) |

**Classification:**

- **Risk / Bug (test or product):** Shortage gate may be stricter than tests expect, **or** fixtures no longer seed enough stock for merchant/MFN paths after `ChannelStockResolver` / gate changes.
- **Bug (data setup):** Unique SKU constraint violation suggests test creates duplicate `(user, channel, sku)` without `firstOrCreate` / cleanup between cases — flaky isolation under `RefreshDatabase` or shared state.

**Do not treat as “import is broken in prod” without reproducing with the same sheet + stock; treat as High QA debt on the most critical suite.**

### 4.2 TreasuryPanelTest — legacy morph

```
Class "App\Models\Inventory\InventoryOrder" not found
at MorphTo.php (createModelByType)
tests/Feature/TreasuryPanelTest.php:69
```

**Classification:** **Bug** — morph map / legacy type string still points at monolith class `App\Models\Inventory\InventoryOrder` instead of `App\Domain\Models\Wms\InventoryOrder` (or equivalent). Eager-load of receipts with legacy morph type fails.

Related debt: Domain `Product` morph shim / InventoryMorphTypes (see Architecture + Security).

---

## 5. Domain coverage map (existing suite)

| Domain | Covered? | Quality |
|--------|----------|---------|
| DB safety | Yes | Strong |
| Marketplace import idempotency | Partial | Suite exists but **8 red** |
| Settlements import/reconcile | Yes | Green |
| Returns + treasury ledger | Yes | Green |
| Merchant restock | Yes | Green |
| Transfers / legacy inventory | Yes | Green |
| Pagination / Phase A SKU API | Yes | Thin but green |
| ProfitEngine / COGS | **No** | Gap |
| TreasurySpendGuard | **No** direct | Gap (returns path exercises refund guard indirectly) |
| Supplier pay | **No** | Gap (Business Logic P0) |
| PurchaseImport / Gemini | **No** | Gap |
| Paymob webhook / HMAC | **No** | Gap |
| Policies / RBAC | **N/A** | None to test |
| Channel SKU CRUD / AddSKU form | **No** | Gap (UI regression: form reset) |
| ProfitDistribution isolation | **No** | Gap (Security P0) |

---

## 6. Suggested Pest names (plan only — do not author now)

| Priority | Suggested test | Why |
|----------|----------------|-----|
| P0 | `ProfitDistributionTenantIsolationTest` | Security F1 IDOR |
| P0 | `RegenerateMasterProductsAuthzTest` | Security F2 |
| P0 | `SupplierPayTreasurySpendGuardTest` | Business Logic HIGH |
| P0 | `MarketplaceImportIdempotencyTest` **repair** | Restore green on critical path |
| P0 | `TreasuryPanelLegacyMorphMapTest` / fix morph map | Green treasury panel |
| P1 | `TreasurySpendGuardCoverageTest` | Matrix from 03-business-logic |
| P1 | `SulfaRepaySpendGuardTest` | Med bug |
| P1 | `ProfitEngineZeroCostWarningTest` | Silent COGS=0 |
| P1 | `PurchaseImportServiceSmokeTest` | Fat controller / Gemini boundary |
| P2 | `AddSkuDialogOpenSeedOnce` (frontend) | Regression for wasOpenRef |
| P2 | `PaymobWebhookHmacTest` | Subscription critical path |

---

## 7. Recommendations

1. **Fix morph map** for legacy `App\Models\Inventory\InventoryOrder` → current WMS model (unblocks TreasuryPanelTest).
2. **Stabilize MarketplaceImportIdempotencyTest fixtures** (stock seed + SKU uniqueness) before trusting import QA.
3. Author P0 Pest list above in a dedicated “write tests” pass after hotfixes.
4. Keep CI gated on `phyzioline_inventory_test` + `DatabaseSafetyGuard` only.

---

## 8. Evidence

- Full log: `/tmp/inventory-pest-06.txt` (session artifact)
- Suite paths: `tests/Feature/*`, `tests/Unit/*`
- Safety: `app/Support/DatabaseSafetyGuard.php`, `phpunit.xml`
