# 03 — Business Logic Audit (Money & Stock Correctness)

**Repo:** `phyzioline/inventory-app` — `/home/phyzioline-inventory/htdocs/inventory.phyzioline.com`  
**Audited:** 2026-07-30  
**Scope:** Critical paths from `.cursor/rules/inventory-critical-paths.mdc` — money/stock flows only.  
**Mode:** Read-only analysis. No code modified.

---

## Table of Contents

1. [MarketplaceImportService](#1-marketplaceimportservice)
2. [TreasurySpendGuard Coverage Matrix](#2-treasuryspendguard-coverage-matrix)
3. [InventoryReturnMutationService](#3-inventoryreturnmutationservice)
4. [SettlementService](#4-settlementservice)
5. [ChannelStockResolver](#5-channelstockresolver)
6. [ProfitEngineService](#6-profitengineservice)
7. [Negative Stock](#7-negative-stock)
8. [Top 10 Business-Logic Findings](#8-top-10-business-logic-findings)

---

## 1. MarketplaceImportService

**File:** `app/Application/Services/MarketplaceImportService.php` (~3,680 lines)

### 1.1 Import Flow Summary

```
import(file, channelId)
  ├── Cache::lock('marketplace_import:user:{uid}', 300s) — serialize per user
  ├── runImport()
  │     ├── resetBatchArrays (newOrderIds, newOrderItemIds, stockOutTxIds, shortages)
  │     ├── parseFile → rows[]
  │     ├── openImportSession()
  │     ├── buildImportAnalysis() → gate check (block if errors/shortage)
  │     ├── for each row → processOrderRow()
  │     │     ├── findOrCreate InventoryOrder (upsert by platform_order_id + channel)
  │     │     ├── findOrCreate InventoryOrderItem (upsert by order + sku)
  │     │     ├── shouldDeductInventoryForChannel? + hasPriorImportedOrderDeduction?
  │     │     │     └── deductInventoryForImportedOrder()
  │     │     │           ├── Merchant: planMerchantOrderDeduction → split store/merchant
  │     │     │           └── Non-merchant: resolveDeductionLocationIdForSku → OUT at location
  │     │     └── record stock_deduction_status (deducted | shortage | not_applicable)
  │     ├── writeLastImportBatchToDatabase() — persist rollback data
  │     └── closeImportSession()
  └── importLock.release()
```

### 1.2 Idempotency Keys & Double-Deduct Guards

| Guard | Mechanism | Evidence | Assessment |
|---|---|---|---|
| **Per-user import serialization** | `Cache::lock('marketplace_import:user:{uid}', 300)` with `block(10)` | Lines 114-126 | **Solid.** Prevents TOCTOU races between hasPriorImportedOrderDeduction check and deduction commit. |
| **hasPriorImportedOrderDeduction()** | Checks `InventoryTransaction` for existing `type=OUT, reference_type=ImportedOrder, reference_id=orderId` matching any candidate sku_id | Lines 2786-2861 | **Solid.** Comprehensive SKU-drift handling: queries by sku_code across items, all channels for same user, and resolves store SKU via master_product link. |
| **DB unique index** | `uq_txn_one_out_per_order_sku` on inventory_transactions | Lines 3001-3035 | **Solid.** SAVEPOINT-based rollback of decrement on UniqueConstraintViolationException. PostgreSQL-safe (avoids aborted-transaction state). |
| **importBatchNewOrderIds gate** | Only deducts for orders created in current batch OR not-yet-deducted pre-existing orders | Lines 1234-1318 | **By-design.** Pre-existing orders only deduct if no prior OUT exists. |

### 1.3 Shortage Recording

Shortages are tracked in `$importStockShortages[]` and persisted on `inventory_order_items.stock_deduction_status = 'shortage'` with `stock_shortage_reason` text. The `buildImportAnalysis()` gate blocks the entire import if ANY row requires deduction but has insufficient stock (configurable via preview).

**Assessment:** By-design. Shortages are surfaced in the API response and on the Orders UI via badges. No silent failures.

### 1.4 Rollback/Retry

`rollbackLastStockDeductionBatch()` reads persisted batch from `marketplace_order_import_last_batches` table, then:
- Reverses each OUT transaction (increments sku_inventory back, deletes the transaction)
- Deletes new order items created in the batch
- Deletes new orders (only those with no other items)

**Risk (MINOR):** Only the LAST batch per user is persisted. A second import overwrites the first batch's rollback data. If the user imports twice then wants to rollback the first import, it's lost. This is by-design (documented as "last batch rollback").

### 1.5 Holes / Risks

| # | Finding | Severity |
|---|---|---|
| 1 | **Cache lock is user-scoped, not global.** Two different users importing the same channel/order sheet concurrently could race on the same order. The unique DB index prevents double-deduction, but both imports would succeed in creating/updating the order, potentially with conflicting data. | RISK — LOW (multi-user same-channel import is uncommon) |
| 2 | The `hasPriorImportedOrderDeduction` does multiple DB queries per item (query items, query SKUs across channels, resolve store SKU). For large sheets (5000+ rows) this could be slow. Not a correctness issue. | RISK — PERF |

---

## 2. TreasurySpendGuard Coverage Matrix

**File:** `app/Application/Services/TreasurySpendGuard.php`

The guard computes `availableCash = total_receipts - total_outflow` via `CashFlowSummaryController::getCoreStatsForUser()` and blocks when `amount > available + 0.00001`.

### Coverage Matrix

| # | Flow / Path | Calls SpendGuard? | Method Called | Evidence |
|---|---|---|---|---|
| 1 | **PaymentController::store** | **YES** | `assertPaymentAllowed()` | `PaymentController.php:95` — skips for cancelled |
| 2 | **PaymentController::update** (amount increase) | **YES** | `assertCompletedPaymentIncreaseAllowed()` | `PaymentController.php:182` |
| 3 | **ExpenseController::store** | **YES** | `assertExpenseAllowed()` | `ExpenseController.php:91` |
| 4 | **ExpenseController::update** (amount increase) | **YES** | `assertExpenseIncreaseAllowed()` | `ExpenseController.php:146` |
| 5 | **PurchaseImportController::store** (cash purchase) | **YES** | `assertPaymentAllowedForUser()` | `PurchaseImportController.php:480` |
| 6 | **PurchaseImportService::createCashPurchasePayment** | **YES** | `assertPaymentAllowedForUser()` | `PurchaseImportService.php:1141` |
| 7 | **InventoryReturnMutationService::syncCustomerRefundPayment** (cash/bank refund) | **YES** | `assertPaymentAllowedForUser()` | `InventoryReturnMutationService.php:147` |
| 8 | **SupplierController::pay** | **NO** | — | `SupplierController.php:432-456` |
| 9 | **InventoryOrderMutationService** (auto-receipt on order create/edit) | N/A (receipt, not spend) | — | Creates Receipt, no spend |
| 10 | **PurchaseReturnController** (supplier refund receipt) | N/A (receipt, not spend) | — | Creates Receipt (incoming), no spend |
| 11 | **SulfaCashMirrorService::syncBorrowReceipt** | N/A (receipt, not spend) | — | Creates Receipt for sulfa borrow |
| 12 | **TreasurySulfaController::repay** | PARTIAL | No direct SpendGuard call | `TreasurySulfaController.php` — creates Expense for repayment but does not call SpendGuard before the expense |
| 13 | **InvoiceEditService** (auto-receipt on edit) | N/A (receipt) | — | Creates/reverses receipts |
| 14 | **CapitalReceiptWriter** | N/A (receipt) | — | Creates Receipt for capital |

### Critical Gaps

| # | Gap | Severity | Evidence |
|---|---|---|---|
| **G1** | **`SupplierController::pay` does NOT call TreasurySpendGuard.** It only decrements `supplier.balance` and has a `// TODO: Record a financial transaction/expense here for full accounting` comment. This means: (a) no treasury balance check, (b) no `inv_payments` row created, (c) the spend is invisible to CashFlowSummary. | **BUG — HIGH** | `SupplierController.php:432-456` |
| **G2** | **`TreasurySulfaController::repay` creates an Expense but does not call `assertExpenseAllowed`.** The sulfa repayment path creates a treasury cash transaction and an expense, but never validates whether the treasury has sufficient balance. | **BUG — MEDIUM** | `TreasurySulfaController.php` — repay method |

---

## 3. InventoryReturnMutationService

**File:** `app/Application/Services/InventoryReturnMutationService.php`

### 3.1 Process/Receive Stock + Ledger Flow

```
upsertFromValidated() → [new + sellable + not completed] → processReturn() → syncCustomerRefundPayment()
process(id) → processReturn() → syncCustomerRefundPayment()
receive(id) → [merchant + sellable + not completed] → processReturn() → syncCustomerRefundPayment()
```

**InventoryReturn::processReturn()** (Domain model, `InventoryReturn.php:72-170`):
- Wraps in DB::transaction
- Loads order items + SKUs
- For merchant orders: resolves store SKU via `ChannelStockResolver::resolveStoreSkuIdForListingSku`
- Sellable disposition: increments `sku_inventory.quantity` + creates `InventoryTransaction(type=IN, reference_type=Return)`
- Damaged/unsellable: calls `InventoryAdjustmentService::adjust()` (records loss, no stock IN)
- If `refund_amount` is zero, auto-calculates credit from order line prices and decrements `order.remaining_amount`
- Sets status = completed, return_status = restocked, inventory_status = restocked

### 3.2 Restock Location Correctness

| Scenario | Restock Target | Assessment |
|---|---|---|
| Non-merchant order | `ChannelStockResolver::resolveDeductionLocationIdForChannel(channelId)` or fallback to order warehouse fields | **By-design.** Returns go to the channel's primary location. |
| Merchant order | Resolves store SKU via master_product link → store channel location | **Solid.** Correctly restocks the main store (المحل), not the merchant virtual bucket. |
| No location found | Falls back to `$order->fulfillment_warehouse_id ?? warehouse_id ?? credit_warehouse_id ?? 1` | **RISK — LOW.** Hardcoded fallback to location_id=1 could restock to wrong location if id=1 doesn't exist or is wrong. |

### 3.3 Risk: Reverse Without Matching Original Location/SKU

**Observation:** `processReturn()` does NOT look up the original OUT transaction to determine where stock was deducted from. Instead, it independently resolves the restock location using `ChannelStockResolver`. If the original deduction happened at a different location (e.g., due to channel remapping or manual transfer since the sale), the restock goes to a different location than the original deduction.

**Severity:** RISK — MEDIUM. Stock accounting at the location level could drift over time. The total on-hand across all locations remains correct, but per-location accuracy degrades.

### 3.4 Treasury Consistency

`syncCustomerRefundPayment()` runs OUTSIDE `processReturn()`'s transaction (by design — documented in comment). This means:
- Stock restock commits even if treasury is insufficient (correct — physical return already happened)
- Treasury payment is blocked with warning in metadata if insufficient
- If customer has no `customer_id`, payment is blocked and logged

**Assessment:** By-design and well-documented. The metadata flagging (`treasury_payment_blocked`) provides an audit trail.

---

## 4. SettlementService

**File:** `app/Application/Services/SettlementService.php`

### 4.1 Duplicate Import Protection

| Format | Mechanism | Assessment |
|---|---|---|
| **XML** | Keyed on `AmazonSettlementID` (report_id). Re-import: updates settlement, **deletes all existing items**, re-inserts. | **By-design.** Full replace on re-import. `report_id` is mandatory (throws if missing). |
| **CSV/TXT (delimited)** | `prepareSettlementForImport()` finds existing by `report_id`. Re-import: updates settlement, **deletes all existing items**, re-inserts. Fallback `report_id` uses `sha1(filename + content)` for content-stable dedup. | **Solid for content-hash fallback.** Risk below. |
| **In-file row dedup** | CSV: `md5(json_encode(row))` tracks seen row hashes per file. Also `resolveDeduplicationDecision()` checks exact field match in same settlement. | **Solid.** Two-layer dedup (in-memory + DB). |

### 4.2 Risks

| # | Finding | Severity |
|---|---|---|
| 1 | **Delete-all-then-reinsert on re-import** means `settlement_items.id` values change. Any external reference to a settlement_item by ID (e.g., `metadata.settlement_item_id` in InventoryReturn) becomes stale after re-import. | RISK — MEDIUM |
| 2 | **Fallback report_id** (`buildFallbackReportIdFromContents`) is content-hash based and stable. But `buildFallbackReportId()` (non-content version) uses `microtime(true)` and would generate a new ID each upload. The non-content version is only used as final fallback when content-hash path fails, which shouldn't happen in practice. | RISK — LOW |

### 4.3 Receipt Creation Consistency

Settlement receipts are created by `ReceiptApplicationService` or `PurchaseReturnController`, NOT by `SettlementService` itself. Settlement import + reconcile only updates `financial_status` and `settlement_status` on orders. Actual cash receipt creation is a separate user action. **No automatic receipt creation from settlement import** — this is by-design.

---

## 5. ChannelStockResolver

**File:** `app/Application/Services/ChannelStockResolver.php`

### 5.1 Intended Rule

```
deductsFromMainStoreBucket(channelId):
  1. Resolve main store channel by name heuristic: "store|shop|main|المحل" in channel name/slug
  2. If channelId == storeId → false (it IS the store, not merchant deducting from store)
  3. If resolveStockScopeChannelId(channelId) == storeId → true
     └── resolveStockScopeChannelId: if isMerchantChannel → return mainStoreId; else return channelId
         └── isMerchantChannel: checks channel.type or name/slug for "merchant|mfn|fbm|تاجر"
```

**Summary:** Merchant/MFN/FBM channels → stock deducted from main store. FBA/other channels → stock deducted from their own bucket.

### 5.2 Main Store Resolution

`resolveMainStoreChannelId()` uses string matching on channel names: `store|shop|main|المحل`. Falls back to hardcoded `MAIN_STORE_CHANNEL_ID = 1`.

**Risks:**

| # | Risk | Severity |
|---|---|---|
| 1 | **Name-based heuristic is fragile.** If someone renames the main store channel or creates a channel named "Amazon Store", it could mis-resolve. | RISK — MEDIUM |
| 2 | **Static cache** `$mainStoreChannelIdCache` persists for the PHP process lifetime but NOT across requests (re-resolved each request). No race risk, but repeated DB queries on every request for channel resolution. | RISK — PERF (LOW) |
| 3 | **No `channel.type` field used for store detection.** `isMerchantChannel` checks `channel.type` for merchant keywords, but `resolveMainStoreChannelId` only checks `name`/`slug`, not `type`. If someone sets `type='main_store'` it wouldn't help. | By-design — store has no type field convention. |

### 5.3 Merchant Fallback to Main Store

`planMerchantOrderDeduction()` as of the current code sets `$merchantAvail = 0.0` and `$fromMerchant = 0.0` (lines 618-619), meaning **merchant channel stock is intentionally ignored** — all deduction comes from the main store. The comment explains: "Merchant warehouse locations may contain phantom stock."

**Assessment:** By-design. Merchant channels are virtual listings only. All physical stock lives in the main store.

---

## 6. ProfitEngineService

**File:** `app/Application/Services/ProfitEngineService.php`

### 6.1 Cost Basis Method

**Weighted average purchase cost**, computed from `purchase_batch_items`:

```sql
SUM(total_price) / SUM(GREATEST(received_quantity, quantity))
```

Grouped by `master_product_id`. This is a **global weighted average** across all purchase batches — not FIFO, not lot-specific.

**Fallback chain** when no batch data exists (`unitCostFromMasterAndSku`):
1. `master.last_purchase_price`
2. `master.cost_price`
3. `master.avg_purchase_price`
4. `master.specifications.cost_price`
5. `sku.last_purchase_price`
6. `sku.cost_price`
7. **0.0** (silent zero)

### 6.2 Null/Zero Cost Handling

| Scenario | Result | Assessment |
|---|---|---|
| No purchase batch history AND no master/sku cost fields | `unitCost = 0.0` | **RISK — MEDIUM.** Profit is overstated (COGS=0). No warning/flag emitted. |
| `sum_qty = 0` in batch average | Returns `0.0` | Same risk as above |
| `sum_total = 0` (free samples?) | Returns `0.0` | By-design for genuinely zero-cost items |
| Settlement net is ≤ 0 for an order | Skipped entirely in `getProfitBySku()` (line 723: `continue` if `$orderNet <= 0`) | By-design — refunded orders excluded from profit |

### 6.3 ROI Metrics vs Period Profit

`getRoiMetrics()` uses a **simpler formula**: `net_profit = total_sales - total_purchases - expenses - losses - refunds`. This does NOT use weighted average COGS — it uses raw purchase batch totals. This will diverge from `getProfitSummary()` which uses COGS per order line.

**Assessment:** RISK — LOW. Two different profit models serving different screens (ROI dashboard vs detailed profit report). Could confuse users if both are shown simultaneously.

---

## 7. Negative Stock

### 7.1 Is Negative Stock Allowed?

**No — negative stock is explicitly prevented in all critical paths:**

| Path | Prevention | Evidence |
|---|---|---|
| **MarketplaceImportService::applyImportStockOutAtLocation** | Checks `available + 1e-9 < quantity`, then uses `WHERE quantity >= qty` in decrement. Records shortage if fails. | Lines 2963-2997 |
| **InventoryTransactionController** (transfers) | Checks `if ((int) $sourceInventory->quantity < 0)` and throws RuntimeException | Lines 879-883, 1111-1113, 1255-1257, 1271-1273, 1301-1303, 1316-1318 |
| **PurchaseImportService::deductFromInventoryWithPreference** | Comment: "never allow negative stock" | Line 2044 |
| **ChannelStockResolver::availableQuantity*** methods | All use `max(0.0, ...)` on quantities returned | Multiple locations |

### 7.2 Gaps Where Negative Stock Could Occur

| # | Gap | Severity |
|---|---|---|
| 1 | **InventoryReturn::processReturn** increments stock unconditionally (`$skuInventory->increment('quantity', $qtyToProcess)`). If called multiple times for the same return (e.g., due to a race between `upsertFromValidated` auto-process and manual `process(id)` call), stock could be double-incremented. The `status === 'completed'` check in `process()` prevents this for the explicit path, but `receive()` checks `status !== 'completed'` separately and could re-trigger. | RISK — LOW (guarded by status check) |
| 2 | **InventoryAdjustmentService::adjust** (called for damaged returns) — not reviewed in this audit but handles stock adjustments for non-sellable items. If it doesn't check for sufficient stock before OUT, could go negative. | NEEDS REVIEW |

---

## 8. Top 10 Business-Logic Findings

### Finding 1: SupplierController::pay Bypasses Treasury Entirely

| | |
|---|---|
| **Severity** | **BUG — HIGH** |
| **Type** | Missing treasury integration |
| **Evidence** | `app/Presentation/Http/Controllers/Api/SupplierController.php:432-456` |
| **Description** | `pay()` only decrements `supplier.balance` and returns. No `TreasurySpendGuard` check, no `Payment` record created, no treasury transaction. The method has a `// TODO` comment acknowledging this gap. Cash leaves the business with zero treasury visibility. |
| **Impact** | Treasury balance is overstated. CashFlowSummary is incorrect. No audit trail for supplier payments via this endpoint. |
| **Recommended Test** | Pest test on `phyzioline_inventory_test`: Call `SupplierController::pay` with amount > available treasury. Assert it should be blocked (currently it won't be). Assert a Payment record is created. Assert CashFlowSummary reflects the outflow. |

---

### Finding 2: InventoryReturn Restock Location May Differ From Original Deduction Location

| | |
|---|---|
| **Severity** | **RISK — MEDIUM** |
| **Type** | Location-level stock drift |
| **Evidence** | `app/Domain/Models/Wms/InventoryReturn.php:72-148` — `processReturn()` resolves location independently via ChannelStockResolver |
| **Description** | `processReturn()` does not look up the original OUT transaction to determine the deduction location. If a channel's primary location changed, or stock was moved between locations after the sale, the restock goes to a potentially different location. |
| **Impact** | Per-location stock counts drift over time. Total on-hand remains correct. Warehouse picking accuracy degrades. |
| **Recommended Test** | Pest test: Create order with OUT at location A. Change channel's primary location to B. Process return. Assert stock incremented at location A (currently would increment at B). |

---

### Finding 3: ProfitEngineService Silent Zero Cost

| | |
|---|---|
| **Severity** | **RISK — MEDIUM** |
| **Type** | Profit overstatement |
| **Evidence** | `app/Application/Services/ProfitEngineService.php:111-129` — `unitCostFromMasterAndSku()` returns 0.0 as final fallback |
| **Description** | When no purchase batch history exists AND no static cost fields are populated on master/SKU, the effective unit cost is 0.0. Profit calculations silently treat the item as zero-cost, overstating profit. No warning, flag, or UI indicator is emitted. |
| **Impact** | Profit reports for newly added products (before first purchase) show inflated margins. Users may make pricing decisions on incorrect data. |
| **Recommended Test** | Pest test: Create order with SKU that has no purchase batches and no cost fields. Call `getProfitBySku()`. Assert the result includes a flag like `cost_source: 'none'` or `zero_cost_warning: true` (currently absent). |

---

### Finding 4: Settlement Re-Import Invalidates SettlementItem IDs in Return Metadata

| | |
|---|---|
| **Severity** | **RISK — MEDIUM** |
| **Type** | Data integrity — stale references |
| **Evidence** | `app/Application/Services/SettlementService.php:226,2254` — `SettlementItem::where('settlement_id', ...)->delete()` on re-import |
| **Description** | Both XML and CSV re-import paths delete all existing `settlement_items` and re-insert them with new IDs. `InventoryReturn.metadata.settlement_item_id` references become stale. `syncReturnFromSettlementItem()` first tries to find returns by `metadata->settlement_item_id`, so stale IDs could cause duplicate returns or orphaned references. |
| **Impact** | After settlement re-import, claim-tracking returns may fail to match their source line. Could lead to duplicate claim returns. |
| **Recommended Test** | Pest test: Import settlement XML. Reconcile (creates returns with settlement_item_id in metadata). Re-import same XML. Assert returns still link to correct settlement items (currently IDs change). |

---

### Finding 5: TreasurySulfaController::repay Skips SpendGuard

| | |
|---|---|
| **Severity** | **BUG — MEDIUM** |
| **Type** | Missing treasury guard |
| **Evidence** | `app/Presentation/Http/Controllers/Api/TreasurySulfaController.php` — `repay()` method |
| **Description** | Sulfa repayment creates an Expense (cash outflow) without calling `TreasurySpendGuard::assertExpenseAllowed()`. A user could repay a sulfa loan even when the treasury has zero or negative available balance. |
| **Impact** | Treasury balance can go negative through sulfa repayments. Inconsistent with ExpenseController which does call SpendGuard. |
| **Recommended Test** | Pest test: Set treasury balance to 0. Attempt sulfa repay. Assert 422 rejection (currently succeeds). |

---

### Finding 6: ChannelStockResolver Main Store Detection Is Name-Heuristic Based

| | |
|---|---|
| **Severity** | **RISK — MEDIUM** |
| **Type** | Fragile configuration |
| **Evidence** | `app/Application/Services/ChannelStockResolver.php:101-130` — `resolveMainStoreChannelId()` |
| **Description** | Main store channel is resolved by matching `store|shop|main|المحل` in channel name/slug. No explicit `is_main_store` flag or `type='store'` convention. Renaming the store channel or creating another channel with "store" in the name could cause mis-resolution. Fallback is hardcoded `MAIN_STORE_CHANNEL_ID = 1`. |
| **Impact** | If the main store is mis-resolved, ALL merchant order deductions go to/from the wrong stock bucket. Every import and return would be incorrect. |
| **Recommended Test** | Pest test: Create two channels with "store" in name. Assert `resolveMainStoreChannelId()` returns the correct one. Test with main store renamed to remove keywords. Assert fallback behavior is acceptable. |

---

### Finding 7: processReturn Can Be Double-Triggered via receive() + process()

| | |
|---|---|
| **Severity** | **RISK — LOW** |
| **Type** | Potential double restock |
| **Evidence** | `app/Application/Services/InventoryReturnMutationService.php:214-247` — `receive()` and `process()` |
| **Description** | `receive()` calls `processReturn()` for merchant+sellable returns. `process()` also calls `processReturn()` guarded by `status !== 'completed'`. If both are called in rapid succession (e.g., API race), the status check should prevent double-processing because `processReturn()` sets `status='completed'` within its transaction. However, the `receive()` method first sets `status='approved'` (line 219) and THEN conditionally calls `processReturn()` (line 236). If `processReturn()` fails, the return is left in 'approved' state, allowing `process()` to re-attempt. This is actually a feature, not a bug — retry on failure is correct. |
| **Impact** | Low. The DB transaction in `processReturn()` ensures atomicity. Double-call would fail on the second attempt since status would be 'completed'. |
| **Recommended Test** | Pest test: Call `receive()` on a merchant sellable return. Assert stock incremented once. Call `process()` on same return. Assert ValidationException('Return already processed'). |

---

### Finding 8: ROI Metrics Use Different Profit Model Than Period Profit

| | |
|---|---|
| **Severity** | **RISK — LOW** |
| **Type** | Inconsistent reporting |
| **Evidence** | `app/Application/Services/ProfitEngineService.php:966-1061` — `getRoiMetrics()` |
| **Description** | `getRoiMetrics()` computes `net_profit = total_sales - total_purchases - expenses - losses - refunds` using raw aggregate sums. `getProfitSummary()` uses per-order weighted-average COGS and settlement net revenue. These two methods can produce significantly different profit numbers for the same period. |
| **Impact** | Users seeing both ROI dashboard and detailed profit report may see different profit figures, causing confusion. |
| **Recommended Test** | Pest test: Create orders with known costs/revenue. Call both `getRoiMetrics()` and `getProfitSummary()`. Document the expected divergence and ensure UI clearly labels which model is used. |

---

### Finding 9: Marketplace Import Lock Is User-Scoped, Not Channel-Scoped

| | |
|---|---|
| **Severity** | **RISK — LOW** |
| **Type** | Concurrency gap |
| **Evidence** | `app/Application/Services/MarketplaceImportService.php:114` — `Cache::lock('marketplace_import:user:'.$uid, 300)` |
| **Description** | The import lock serializes imports per user. Two different users importing the same channel's order sheet concurrently could race on order upserts. The unique DB index on inventory_transactions prevents double-deduction, but order-level data (status, amounts) could have last-writer-wins conflicts. |
| **Impact** | Low in single-user deployments. In multi-user scenarios with shared channels, order metadata could be inconsistent. |
| **Recommended Test** | Pest test: Two users import overlapping order sheets for the same channel concurrently. Assert no double deductions (covered by DB index). Assert order data is consistent (quantity, status). |

---

### Finding 10: InventoryReturn processReturn Hardcodes Fallback Location to ID=1

| | |
|---|---|
| **Severity** | **RISK — LOW** |
| **Type** | Hardcoded fallback |
| **Evidence** | `app/Domain/Models/Wms/InventoryReturn.php:87` — `$defaultLocationId = 1` |
| **Description** | When no location can be resolved from the channel or order, `processReturn()` falls back to `location_id = 1`. If this location doesn't exist or belongs to a different channel/warehouse, stock is restocked to the wrong place. |
| **Impact** | Incorrect per-location stock. Only triggers when channel has no linked location AND order has no warehouse fields set — edge case for well-configured setups. |
| **Recommended Test** | Pest test: Create return for order with channel that has no linked locations. Assert that `processReturn()` either uses a valid location or fails gracefully rather than silently restocking to id=1. |

---

## Summary Severity Distribution

| Severity | Count | Findings |
|---|---|---|
| BUG — HIGH | 1 | #1 (SupplierController::pay) |
| BUG — MEDIUM | 1 | #5 (Sulfa repay skips SpendGuard) |
| RISK — MEDIUM | 4 | #2 (restock location drift), #3 (silent zero cost), #4 (stale settlement_item IDs), #6 (store name heuristic) |
| RISK — LOW | 4 | #7 (double trigger guard), #8 (ROI vs profit model), #9 (user-scoped lock), #10 (hardcoded location fallback) |

---

*End of Business Logic Audit — 03*
