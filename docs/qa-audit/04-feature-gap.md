# 04 — Feature Gap Analysis

**Repo:** `phyzioline/inventory-app` — `/home/phyzioline-inventory/htdocs/inventory.phyzioline.com`  
**Date:** 2026-07-30  
**Agent:** Feature Gap Analysis  
**Mode:** Read-only static analysis — no code modified  
**Identity check:** `pwd` = inventory.phyzioline.com · remote = `phyzioline/inventory-app.git` · **no `Modules/`** ✓

---

## Table of Contents

1. [Full Physical / Cycle Count](#1-full-physical--cycle-count-with-variance-posting)
2. [Immutable Stock Movement Ledger](#2-complete-stock-movement-ledger-immutable-audit)
3. [Audit Trail for Financial Edits / Cancellations](#3-audit-trail-for-financial-edits--cancellations)
4. [Fine-grained RBAC Permissions](#4-fine-grained-rbac-permissions)
5. [Low-Stock Alerts + Reorder Points / PO Suggestions](#5-low-stock-alerts--reorder-points--po-suggestions)
6. [Batch / Lot / Serial Tracking](#6-batchlot--serial-tracking)
7. [Inventory Valuation Methods (Weighted Avg vs FIFO)](#7-inventory-valuation-methods)
8. [Channel-level P&L and Fee Handling](#8-channel-level-pl-and-fee-handling)
9. [Idempotent Marketplace Import](#9-idempotent-marketplace-import)
10. [Return Reason Analytics + Claims Workflow](#10-return-reason-analytics--claims-workflow)
11. [Multi-user Roles Within One Tenant](#11-multi-user-roles-within-one-tenant)
12. [Async Job Processing for Large Imports](#12-async-job-processing-for-large-imports)
13. [Webhooks / Integrations Beyond Paymob](#13-webhooks--integrations-beyond-paymob)
14. [Barcode Receive / Ship Completeness](#14-barcode-receive--ship-completeness)
15. [Backup / Restore Runbooks](#15-backuprestore-runbooks)
16. [FBA / FBM Operational Pages](#16-fbafbm-operational-pages)
17. [Subscription Entitlement Enforcement Breadth](#17-subscription-entitlement-enforcement-breadth)
18. [Tauri Desktop Client Feature Parity](#18-tauri-desktop-client-feature-parity)
19. [Top 10 Missing Features](#19-top-10-missing-features-ranked)
20. [Now / Next / Later Roadmap](#20-now--next--later-roadmap)

---

## 1. Full Physical / Cycle Count with Variance Posting

| | |
|---|---|
| **Status** | **Missing** |
| **Priority** | High |

### Evidence

- `InventoryAdjustment` model + `InventoryAdjustmentService` + `InventoryAdjustments.tsx` page exist and support types `DAMAGE`, `LOST`, `THEFT`, `EXPIRED`, `CORRECTION`, `OPENING_BALANCE`, `STOCK_IN`. Each adjustment creates an `InventoryTransaction` record.
- There is **no** dedicated physical-count or cycle-count workflow: no `PhysicalCount`/`CycleCount` model, no "freeze stock / count / post variance" flow, no batch or location-range count sheet export or import wizard distinct from the generic adjustment import.
- `InventoryAdjustmentImportController` provides a bulk-import shortcut (template download + upload), which can simulate a manual count, but it has **no variance comparison** against current system quantities, no count sheet generation, no frozen-at-count-time snapshot, and no approval/sign-off gate.
- The comment inside `InventoryAdjustmentImportController` references "Found during stocktake" as an example reason, confirming the intent is only ad-hoc.

### Why it Matters

Physical counts are a legal and operational requirement for any business holding physical inventory. For a **medical devices / physical shop** context the count is typically mandated quarterly or annually. Without a structured cycle-count workflow, variances are never systematically compared against book quantities, so losses and counting errors accumulate silently.

### Impact if Absent

- Stock accuracy degrades over time → wrong re-order decisions, overselling, and misreported COGS.
- Accountants cannot sign off the balance sheet without a documented count.
- Shrinkage (theft, damage) is booked inconsistently.

### Architectural Sketch (Clean Architecture)

```
Domain/Models/Wms/PhysicalCount.php             — header (location, date, status: open|counting|posted)
Domain/Models/Wms/PhysicalCountItem.php          — SKU × expected qty × counted qty × variance
Application/Services/PhysicalCountService.php    — open/freeze/post(variance → InventoryAdjustment)
Presentation/Http/Controllers/Api/PhysicalCountController.php
database/migrations/YYYY_create_physical_counts_tables.php
resources/frontend/src/lib/pages/PhysicalCount.tsx
resources/frontend/src/components/inventory/PhysicalCountWizard.tsx
```

Flow: owner opens count → system exports current quantities → staff enter counted values → service computes variance → on approval, posts one `InventoryAdjustment` per SKU with type `CORRECTION` and links back to `physical_count_id`.

---

## 2. Complete Stock Movement Ledger (Immutable Audit)

| | |
|---|---|
| **Status** | **Partial** |
| **Priority** | High |

### Evidence

- `InventoryTransaction` model + `InventoryTransactionService` record every stock IN/OUT with `sku_id`, `location_id`, `type`, `quantity`, `reference_type`, `reference_id`, `user_id`.
- `InventoryTransactions.tsx` SPA page + `/api/inventory/transactions/sku-tracker` route provide a per-SKU movement view.
- **Gaps:**
  - No `balance_after` column is stored (the service receives it as a parameter for logging only, it is **not persisted**). The running balance must be recomputed at query time.
  - `reference_type` is a plain string (`'ImportedOrder'`, `'Adjustment'`, `'TRANSFER'`, etc.) with **no polymorphic integrity** — rows can be orphaned.
  - `notes` is in `$fillable` but the `InventoryTransactionService::recordTransaction()` **does not write it** to the DB (it only logs it); the column may not even exist on the table (schema guard comment: "not stored in current schema").
  - No soft-delete or update prohibition: any code with DB access could mutate or delete rows.
  - No hash-chain or append-only DB trigger to make the ledger tamper-evident.

### Why it Matters

A professional WMS ledger is the single source of truth for all stock changes. Recomputing balance from scratch at query time is expensive (N rows scanned) and inconsistent under concurrent writes.

### Impact if Absent

- Running balance cannot be shown in real time without a full table scan.
- Missing `notes` breaks traceability ("why did this unit leave?").
- Mutability exposes the system to inadvertent or malicious record changes with no detection.

### Architectural Sketch

```
database/migrations: ADD COLUMN balance_after NUMERIC(12,4) TO inventory_transactions
                     ADD COLUMN notes TEXT TO inventory_transactions
                     ADD immutable trigger (PG RULE / RLS / application-layer guard)
Application/Services/InventoryTransactionService.php — persist balance_after + notes
Domain/Contracts/ImmutableLedgerContract.php — enforce no-update / no-delete
```

---

## 3. Audit Trail for Financial Edits / Cancellations

| | |
|---|---|
| **Status** | **Partial (orders only)** |
| **Priority** | High |

### Evidence

- **`InvoiceEditLog`** (`inv_invoice_edit_logs`) records before/after JSON snapshots, items delta, payment delta, reason, and user for every sales-order financial edit. This is well-implemented.
- Route `GET /api/inventory/orders/{id}/edit-history` exposes the history. `InvoiceEditController` covers the edit + history endpoints.
- **Gaps:**
  - Only sales `InventoryOrder` edits are tracked. **Cancellations** (`POST /orders/{id}/cancel`) do **not** write to `inv_invoice_edit_logs` — the cancel path in `InventoryOrderMutationService` was not observed to create an edit-log entry.
  - **Purchase invoice edits** — `PurchaseReturnController`, `PurchaseImportController` — have no analogous edit-log table or before/after snapshot.
  - **Treasury edits** (receipts, payments, expenses) have no per-row audit trail beyond `created_at`/`updated_at`.
  - **Return mutations** (`InventoryReturnMutationService`) have no dedicated edit log.
  - The `InvoiceEditLog` has no immutability guard (no soft-delete only, no PG-level row protection).

### Why it Matters

Egyptian VAT/tax regulation (Law 91/2005 and e-invoicing decrees) and basic accounting governance require that every financial document change is traceable with who, when, and what.

### Impact if Absent

- Cancellation reasons are lost — auditors cannot reconstruct why revenue was reversed.
- Purchase and treasury mutations leave no trail → forensic investigation after an error is impossible.

### Architectural Sketch

```
Domain/Models/Wms/DocumentAuditLog.php    — polymorphic (auditable_type, auditable_id), before/after, user, action
Application/Services/AuditLogService.php  — record(model, action, before, after, reason)
```

Attach observers to `InventoryOrder`, `Receipt`, `Payment`, `Expense`, `PurchaseBatch`, `InventoryReturn` for `updated` and `deleted` events.

---

## 4. Fine-grained RBAC Permissions

| | |
|---|---|
| **Status** | **Missing** |
| **Priority** | High |

### Evidence

- Auth: `Gate::before` super-admin bypass + `IsIsolatedByUser` tenant isolation. All authenticated users within the same tenant share identical permissions.
- `User` model has **no `role` column**, no `roles` relationship, no policy classes, no `spatie/laravel-permission` or equivalent.
- `EnsureSuperAdmin` middleware exists only for admin routes.
- `CheckSubscriptionLimit` controls resource creation limits but **not action permissions**.
- Discovery report (01) confirms: "Formal Policies: **0**".
- Security review (02) flags: "Any authenticated user can call all 168 routes including rollback, cancel, financial edit, withdrawal approval."

### Why it Matters

Real-world warehouse teams have owners, warehouse staff, accountants, sales agents, and read-only viewers. Without RBAC, a warehouse picker can approve withdrawals or roll back marketplace imports.

### Impact if Absent

- Any staff member can delete/cancel/rollback financial transactions.
- No audit trail of who is authorized to do what.
- Cannot onboard staff safely without sharing owner-level access.

### Architectural Sketch

```
Domain/Models/Wms/Role.php              — predefined: owner, accountant, warehouse_staff, sales_agent, viewer
Domain/Models/Wms/Permission.php        — granular: orders.cancel, treasury.withdraw.approve, imports.rollback …
Infrastructure/Policies/OrderPolicy.php — cancel, edit, rollback
Infrastructure/Policies/WithdrawalPolicy.php
app/Http/Middleware/CheckPermission.php — lightweight gate check
```

`spatie/laravel-permission` is the de facto standard; alternatively define a `roles` JSONB column on `users` and use `Gate::define` in `AppServiceProvider`. Multi-user tenant table schema: add `tenant_user_roles` pivot.

---

## 5. Low-Stock Alerts + Reorder Points / PO Suggestions

| | |
|---|---|
| **Status** | **Partial** |
| **Priority** | Medium |

### Evidence

- `min_stock` is stored in `master_products.specifications` (JSONB) and surfaced in `AddProductModal`, import template, and `ProductImportService`.
- `DashboardMetricsService` computes `low_stock_count` by comparing `SUM(sku_inventory.quantity) < min_stock`. The dashboard's `LowStockAlerts` component shows a paginated list with a "Reorder" button per item.
- Admin panel (`AdminOverview`) shows aggregate low-stock counts by tenant.
- **Gaps:**
  - The dashboard "Reorder" button in `LowStockAlerts.tsx` is a **UI placeholder** — it has no `onClick` handler that creates a purchase order or PO suggestion.
  - No **reorder point** (minimum before triggering) is stored separately from `min_stock`; no **reorder quantity** or **lead-time days** columns.
  - No **email / push notification** when stock crosses the threshold — alerts only appear in the dashboard widget (user must be logged in).
  - No **suggested PO generation** from low-stock SKUs (no `AutoPurchaseOrderService`).
  - `min_stock` lives inside JSONB which makes indexed SQL comparisons awkward (current workaround: `::text::jsonb->>'min_stock'`).

### Impact if Absent

- Users miss low-stock conditions when not looking at the dashboard.
- Restocking is entirely manual, leading to stockouts on fast-moving SKUs.

### Architectural Sketch

```
Domain/Models/Wms/ReorderRule.php       — sku_id, min_stock, reorder_qty, lead_days
Application/Services/ReorderSuggestionService.php — compute suggested POs from ReorderRule
Infrastructure/Jobs/LowStockNotificationJob.php    — scheduled daily, send email
Presentation/Console/Commands/SendLowStockAlerts.php
```

Migrate `min_stock` out of JSONB → dedicated `reorder_rules` table for indexable queries.

---

## 6. Batch / Lot / Serial Tracking

| | |
|---|---|
| **Status** | **Missing** |
| **Priority** | High (medical devices context) |

### Evidence

- `PurchaseBatch` / `PurchaseBatchItem` track **purchase batches** (supplier invoice → received items + `remaining_quantity` for FIFO), but this is a **costing batch**, not a **product lot/serial** batch.
- No `lot_number`, `serial_number`, `expiry_date` columns on `sku_inventory`, `purchase_batch_items`, or any WMS model.
- `BatchTracking.tsx` page is named for purchase batches (import batches visible in the UI), not product lot tracking.
- No `InventoryTransaction` carries a lot/serial reference.
- `Sku` model has no batch-tracking flag.

### Why it Matters

Medical devices sold in Egypt are regulated by CAPMAS and NAQAAE. Lot numbers and expiry dates are **legally required** on shipping documents and must be traceable from supplier to patient. Even for non-regulated items, lot tracking enables targeted recalls and FIFO/FEFO expiry management.

### Impact if Absent

- Cannot comply with Egyptian medical device regulations (Law 51/2017).
- Cannot run targeted recalls (which lots went to which customers?).
- Expiry management is manual → risk of shipping expired products.
- FIFO cannot be enforced by expiry date (FEFO).

### Architectural Sketch

```
Domain/Models/Wms/ProductLot.php         — lot_number, expiry_date, sku_id, supplier_id, manufactured_date
Domain/Models/Wms/SerialNumber.php       — serial, sku_id, lot_id, status (available|sold|returned)
Domain/Models/Wms/SkuInventoryLot.php    — sku_id, location_id, lot_id, quantity
Application/Services/LotTrackingService.php
```

SKU-level flag `track_lots` / `track_serials` in `master_products` to keep simple SKUs unaffected.

---

## 7. Inventory Valuation Methods

| | |
|---|---|
| **Status** | **Partial (FIFO implemented, Weighted Average partially, not user-selectable)** |
| **Priority** | Medium |

### Evidence

- `InventoryAdjustmentService` docblock: "Adjust stock with FIFO costing." Adjustment losses consume FIFO layers from `purchase_batch_items.remaining_quantity`.
- `ProfitEngineService`: uses **weighted average** purchase cost from `purchase_batch_items` (`SUM(cost × qty) / SUM(qty)`) for COGS calculation.
- `InventoryValuationService`: computes warehouse value as `qty × effective_purchase_cost` via `ProfitEngineService`.
- The system therefore uses **FIFO for physical stock deduction** but **weighted average for COGS reporting**. This is a **mixed methodology** — not a deliberate user choice.
- No `valuation_method` setting per SKU or per tenant.
- No documentation in the app or codebase explaining this dual approach.

### Why it Matters

Egyptian Accounting Standards (EAS-2) require a consistent, disclosed valuation method. Mixing FIFO stock depletion with weighted average COGS produces subtly incorrect profit figures that neither FIFO nor weighted average alone would produce.

### Impact if Absent

- Reported profit is inaccurate depending on price variance between purchase lots.
- Cannot satisfy an external auditor asking "which method do you use?"
- Users cannot switch methods as their business scales.

### Architectural Sketch

```
config/inventory.php  — 'valuation_method' => env('INVENTORY_VALUATION_METHOD', 'weighted_avg')
Domain/ValueObjects/ValuationMethod.php  — FIFO | WEIGHTED_AVG
Application/Services/InventoryValuationService.php  — dispatch to method-specific resolver
```

Short-term: document the current mixed approach in code and the UI settings page. Long-term: unify to a single method per tenant.

---

## 8. Channel-level P&L and Fee Handling

| | |
|---|---|
| **Status** | **Partial** |
| **Priority** | High |

### Evidence

- `SettlementService` imports Amazon/Noon settlement CSV/XML files and stores `fee_amount` per `SettlementItem`. Settlement totals (revenue, fees, COGS) are available via reconcile commands and the `Reconciliation.tsx` page.
- `ProfitEngineService::settlementAwareOrderCogsAndRevenue()` adjusts revenue for fee deductions visible in settlement data.
- `ProfitReportController` exposes channel-filtered profit views.
- `Channel` model + `ChannelController.metrics` provides per-channel stock summaries.
- **Gaps:**
  - **Fee types** from Amazon (FBA fulfillment fees, referral fees, storage fees, ad spend) are all collapsed into `fee_amount` — no breakdown by fee type.
  - **Noon-specific fees** (commission, VAT on commission, NDR charges) are handled similarly without type breakdown.
  - **Advertising spend** (Amazon Ads / Noon Ads) has no dedicated model or import path — it must be entered as a manual `Expense`.
  - **Channel P&L statement** (Revenue − COGS − Fulfillment − Referral − Ads − Returns = Net) is **not a discrete report** — users must mentally assemble this from `ProfitEngine` + `Reconciliation` + `Expenses`.
  - **Non-settlement channels** (physical shop, direct B2B) have no fee structure at all.

### Impact if Absent

- Cannot isolate true Amazon vs Noon vs shop profitability on a single screen.
- Advertising ROI is invisible.
- Margin decisions are based on incomplete channel economics.

### Architectural Sketch

```
Domain/Models/Wms/ChannelFee.php          — fee_type (referral|fulfillment|storage|ads|returns|other), amount, period
Application/Services/ChannelPLService.php  — aggregate revenue/COGS/fees/ads into P&L line
Presentation/Http/Controllers/Api/ChannelPLController.php
resources/frontend/src/lib/pages/ChannelPL.tsx  — tabbed per-channel P&L statement
```

---

## 9. Idempotent Marketplace Import

| | |
|---|---|
| **Status** | **Present (strong — ~85% complete)** |
| **Priority** | Low (existing gaps are edge-case) |

### Evidence (strong aspects)

- `Cache::lock('marketplace_import:user:{uid}', 300s)` serializes concurrent imports per user.
- `hasPriorImportedOrderDeduction()` checks `inventory_transactions` for a prior `OUT` with `reference_type = 'ImportedOrder'` and the specific order-item IDs before deducting.
- `unique_deduction_per_order_sku` DB migration adds a unique constraint on `(inventory_order_id, sku_id, reference_type)` in `inventory_transactions` — DB-level double-deduct prevention.
- `marketplace_order_import_last_batches` table persists rollback data beyond cache TTL.
- `retryStockDeductions` command re-processes shortage lines idempotently via the same `hasPriorImportedOrderDeduction` guard.
- `importBatchNewOrderIds` / `importBatchNewOrderItemIds` / `importBatchStockOutTransactionIds` arrays segregate new vs pre-existing rows for precise rollback.
- Import sessions table (`inventory_import_sessions`) records open/close lifecycle.

### Remaining gaps

| Gap | Risk |
|---|---|
| FBA orders are marked `hint: fba_no_local_deduction` and skipped — no post-hoc FBA removal reconcile for stock shortfall | Low |
| Rollback deletes `InventoryTransaction` rows (mutable ledger) rather than reversing with a compensating entry | Medium |
| Large sheet (>2000 rows) timeout mitigation uses `set_time_limit(600)` + memory bump in-request — not truly async | Medium |
| Preview is capped at 2000 rows but full analysis runs synchronously | Low |

### Completeness Score: **85 / 100**

---

## 10. Return Reason Analytics + Claims Workflow

| | |
|---|---|
| **Status** | **Partial** |
| **Priority** | Medium |

### Evidence

- `ReturnAnalytics.tsx` page: filterable by date, channel, reason, product; shows return rate %, total loss, refund totals, top return reasons.
- `AmazonClaimsHub.tsx` component: three tabs — FBA not returned, Merchant returns, Customer did not receive — with copy-order-number for SAFE-T / reimbursement workflow. `returnDisplayUtils.ts` + `returnReimbursementUtils.ts` compute reimbursement categories.
- `InventoryReturnImportService` stores `return_reason_code` and derives `disposition`.
- **Gaps:**
  - Claims are **tracked only for Amazon**; Noon return claims have no equivalent workflow.
  - No **backend Claims model** — claim status (submitted, approved, amount) is not persisted. The `AmazonClaimsHub` is display-only; users copy order numbers manually then track claims in Amazon Seller Central.
  - No **claims amount receivable** integrated with the treasury ledger.
  - Return reason analytics load up to 500 returns client-side — no server-side aggregation, will degrade with volume.
  - No **return reason trending** (monthly rate by reason) or **SKU-level return rate** report beyond the existing flat table.

### Impact if Absent

- Reimbursement claims are untracked → money left on the table.
- No integrated claims receivable → treasury is understated.

### Architectural Sketch

```
Domain/Models/Wms/ReturnClaim.php             — return_id, channel, claim_reference, status, amount, filed_at, resolved_at
Application/Services/ReturnClaimService.php   — file, track, receive reimbursement → TreasuryLedger credit
Presentation/Http/Controllers/Api/ReturnClaimController.php
resources/frontend/src/lib/pages/ReturnClaims.tsx
```

---

## 11. Multi-user Roles Within One Tenant

| | |
|---|---|
| **Status** | **Missing** |
| **Priority** | High |

### Evidence

- `IsIsolatedByUser` scopes all WMS records to `user_id = Auth::id()`. This means each `User` **is** an isolated tenant — there is **no tenant → members relationship**.
- The `User` model has no `role`, `team_id`, or `invited_by` column.
- No invitation flow, no staff management UI.
- `User::$fillable` = `['name', 'company_name', 'email', 'password', 'phone', 'currency', 'preferred_locale']` — no role field.
- `CheckSubscriptionLimit` counts resources by user_id, reinforcing the single-user-per-account model.

### Why it Matters

Most real-world inventory operations require at least 2 people (owner + warehouse staff). The current architecture forces every staff member to log in as the owner, which destroys accountability and prevents any RBAC.

### Impact if Absent

- No accountability: all actions appear under one user.
- Password sharing (security risk).
- Cannot differentiate owner vs staff permissions.
- Growth stopper for small teams.

### Architectural Sketch

```
database/migrations: ADD COLUMN owner_user_id INT TO users (nullable, FK self-referential)
                     OR CREATE TABLE tenant_members (tenant_id, user_id, role, invited_at, accepted_at)
Domain/Models/Wms/TenantMember.php
IsIsolatedByUser: scope by tenant_id instead of user_id
Application/Services/TeamInvitationService.php  — email invite flow
resources/frontend/src/lib/pages/TeamSettings.tsx
```

This is a **significant schema migration** — `user_id` on all WMS tables would need to become `tenant_id`. Plan as a versioned migration with back-fill.

---

## 12. Async Job Processing for Large Imports

| | |
|---|---|
| **Status** | **Missing** |
| **Priority** | High |

### Evidence

- Queue driver is configured (`config/queue.php` default = `database`, `.env` shows `QUEUE_CONNECTION=redis`). Redis queue is set up.
- **Zero** `Queueable` job classes exist in `app/` (`find app/ -name "*.php" | xargs grep -l "implements ShouldQueue"` → 0 results; discovery report confirms "Queue Jobs: **0**").
- All heavy operations run synchronously in the HTTP request:
  - `MarketplaceImportService::import()` — up to 3,680 lines of logic, sets `set_time_limit(600)` and bumps memory to 512 MB.
  - `PurchaseImportService` (Gemini OCR + spreadsheet parsing).
  - `SettlementService::import()`.
  - `ProductImportService`.
  - `InventoryReturnImportService`.
- Gemini OCR in `BarcodeReturnController::scanImage()` calls an external API synchronously in a request.

### Why it Matters

HTTP requests exceeding 60s will be killed by PHP-FPM or nginx. Even with `set_time_limit(600)`, a 5,000-row Amazon sheet can exhaust memory or hit the process ceiling. Users get no progress feedback and cannot recover from a mid-import crash without a rollback.

### Impact if Absent

- Large sheet imports silently fail after PHP timeout → partial data in DB + confused user.
- Gemini OCR blocks the web worker thread.
- Cannot scale concurrent imports across multiple users.
- No retry logic for transient failures (network blip, Gemini rate limit).

### Architectural Sketch

```
Infrastructure/Jobs/MarketplaceImportJob.php    — implements ShouldQueue, retries(3)
Infrastructure/Jobs/PurchaseImportJob.php
Infrastructure/Jobs/SettlementImportJob.php
Infrastructure/Jobs/ProductImportJob.php
Infrastructure/Jobs/GeminiOcrJob.php
Application/Services/ImportJobDispatcher.php    — thin orchestrator: store file → dispatch job → return job_id
Presentation/Http/Controllers/Api/ImportStatusController.php  — poll job status (or Reverb push)
resources/frontend/src/hooks/useImportStatus.ts — polling hook
```

Horizon for queue monitoring is highly recommended; add `laravel/horizon` to `composer.json`.

---

## 13. Webhooks / Integrations Beyond Paymob

| | |
|---|---|
| **Status** | **Partial (Paymob + CRM outbound only)** |
| **Priority** | Medium |

### Evidence

- **Paymob webhook** (`/webhooks/paymob`): HMAC-verified, CSRF-excepted, handles subscription payment callbacks. Well-implemented.
- **Monolith CRM outbound** (`MonolithCrmWebhookClient`): fires on `Customer`/`Vendor` created/updated to sync contacts to `phyzioline.com`. Best-effort, not queued.
- **Gemini API** (`GeminiService`, `BarcodeReturnController`): purchase OCR + barcode label OCR.
- **Missing inbound integrations:**
  - Amazon SP-API (real-time order feed, FBA inventory sync, removal orders) — currently only CSV/sheet upload.
  - Noon Partner API — currently only CSV upload.
  - Shipping couriers (J&T, Bosta, Aramex, MyFatoorah) — no tracking webhook.
  - ERP / accounting export (QuickBooks, Xero, or custom) — no API.
  - WhatsApp Business API for low-stock or order alerts.
  - Egypt e-Invoicing portal (ETA) — no submission API.

### Impact if Absent

- Amazon / Noon order data is 24–48h stale (depends on manual sheet upload cadence).
- Shipment tracking is manually entered.
- Egypt ETA e-invoicing compliance gap for B2B customers.

### Architectural Sketch

```
Infrastructure/External/AmazonSpApiClient.php   — SP-API orders + inventory
Infrastructure/External/NoonApiClient.php
Infrastructure/External/EtaInvoiceClient.php    — Egypt ETA e-invoice submission
Infrastructure/Jobs/PollAmazonOrdersJob.php     — scheduled every 15 min
Domain/Contracts/MarketplaceConnectorContract.php — uniform interface
```

---

## 14. Barcode Receive / Ship Completeness

| | |
|---|---|
| **Status** | **Partial** |
| **Priority** | Medium |

### Evidence

- `BarcodeReturnController`: scan barcode / OCR image → detect Amazon order ID, VRET, AWB, Mylerz, or product barcode. Returns product + channel context. Supports Gemini-powered label OCR.
- `ReturnScannerDialog.tsx`: UI for scanning a barcode and processing the return.
- ASN transfer (`AsnTransferController`) prints barcodes for Noon ASN sheets.
- `Product.barcode` field stored; importable via `ProductImportService`.
- **Gaps:**
  - Barcode scanning covers **returns only** — no scan-to-receive flow for purchase invoices (staff manually select SKU from dropdown in `PurchaseInvoiceDialog`).
  - No **scan-to-pick / scan-to-ship** for outbound sales orders.
  - No **warehouse bin / shelf barcoding** — `InventoryLocation` has no barcode.
  - Scan hardware (USB / Bluetooth scanner) is not tested — `ReturnScannerDialog` relies on camera OCR which is too slow for a warehouse floor.
  - No **GS1-128 / GS1-DataMatrix** label generation for products — only ASN barcodes are printed.

### Impact if Absent

- Receiving errors (wrong SKU, wrong quantity) go undetected.
- Pick errors reach customers.
- No scan-based audit trail for shipping.

### Architectural Sketch

```
resources/frontend/src/components/inventory/ReceiveScanDialog.tsx  — scan during purchase receive
resources/frontend/src/components/inventory/ShipScanDialog.tsx     — confirm outbound pick
Presentation/Http/Controllers/Api/BarcodeReceiveController.php     — POST scan → match PO line → record receipt
Presentation/Http/Controllers/Api/BarcodeShipController.php        — POST scan → validate pick → emit OUT
```

Physical hardware: recommend Zebra / Honeywell USB HID scanner (simulates keyboard) — works with any `<input>` that handles `Enter` on scan completion.

---

## 15. Backup / Restore Runbooks

| | |
|---|---|
| **Status** | **Partial (backup present; restore undocumented)** |
| **Priority** | Medium |

### Evidence

- `/home/phyzioline-inventory/backup_inventory_pgsql.sh` — daily cron, dumps `phyzioline_inventory` to `/home/phyzioline-inventory/backups/databases/phyzioline_inventory/{date}/`. Keeps 30 days. Validates DB name matches production (refuses `_test`). Solid.
- `/etc/cron.d/phyzioline_inventory_backup` triggers the script at 02:10 UTC.
- **Gaps:**
  - No **restore runbook** document for `inventory-app`. (`docs/reference/from-phyzioline-monolith/CLAUDE.md` references a `docs/server/RUNBOOK.md` for the monolith — this is the wrong project.)
  - No **restore test** (backup-restore drill).
  - No **application-layer backup** (`.env`, `public/app/` SPA build, `storage/`).
  - No documented **RTO/RPO** targets.
  - Incident 2026-07-27 (`migrate:fresh` wipe) — recovery relied on the daily backup but the incident response procedure is not codified.

### Impact if Absent

- Under incident pressure, staff may pick the wrong backup file or wrong DB target.
- No drill → restore procedure is untested → extended downtime during actual recovery.

### Architectural Sketch (documentation, not code)

```
docs/runbooks/backup-restore.md   — step-by-step restore commands, env setup, smoke-test checklist
docs/runbooks/disaster-recovery.md — RTO/RPO, escalation contacts, rollback vs restore decision tree
```

Minimal restore command:
```bash
gunzip -c /home/phyzioline-inventory/backups/databases/phyzioline_inventory/latest/*.sql.gz \
  | psql -U $DB_USERNAME -h $DB_HOST -d phyzioline_inventory_restore
```

---

## 16. FBA / FBM Operational Pages

| | |
|---|---|
| **Status** | **Missing (ComingSoon stubs)** |
| **Priority** | Medium |

### Evidence

```tsx
// resources/frontend/src/lib/pages/AmazonFBA.tsx
export default function AmazonFBA() { return <ComingSoon title="Amazon FBA Inventory" />; }

// resources/frontend/src/lib/pages/AmazonFBM.tsx
export default function AmazonFBM() { return <ComingSoon title="Amazon FBM Inventory" />; }
```

- Routes `/#/amazon-fba` and `/#/amazon-fbm` exist in `App.tsx` but both render the `ComingSoon` component.
- Partial FBA infrastructure exists:
  - `FbaShipmentTransferController` + `FbaRequestTransferDialog.tsx` — create FBA inbound shipment transfers.
  - `RemovalController` + `RemovalImportDialog.tsx` — import Amazon removal orders.
  - `InventoryRemovalOrder` / `InventoryRemovalItem` models.
  - `AsnTransferController` — Noon ASN barcode printing.
- **What is missing for FBA page:**
  - Real-time FBA on-hand balance (requires SP-API integration or manual Stranded/Inventory health report import).
  - FBA Reserved/Inbound/Available breakdown per ASIN.
  - Restock recommendation (FBA days of supply).
  - Removal order dashboard.
- **What is missing for FBM page:**
  - Order queue for merchant-fulfilled orders.
  - Pick-pack-ship workflow.
  - Courier label generation / manifests.

### Architectural Sketch

```
resources/frontend/src/lib/pages/AmazonFBA.tsx  — replace ComingSoon with:
  ASIN inventory table, inbound shipment list, removal order list, restock calculator
resources/frontend/src/lib/pages/AmazonFBM.tsx  — replace ComingSoon with:
  Pending order queue, pick-list export, ship-confirm dialog
```

---

## 17. Subscription Entitlement Enforcement Breadth

| | |
|---|---|
| **Status** | **Partial (narrow — only 2 limits enforced)** |
| **Priority** | Medium |

### Evidence

- `CheckSubscriptionLimit` middleware enforces limits on:
  - `warehouses` — `POST /api/inventory/warehouses`
  - `channels` — `POST /api/inventory/channels`
- `SubscriptionPlan::limit($type)` reads from a `limits` JSONB column on the plan.
- Discovery: "only two limit types today."
- **Not enforced:**
  - Number of SKUs / master products.
  - Number of users / staff members (not yet a feature, but plan limit needed for future).
  - API rate limits per plan tier.
  - Feature gates (e.g., settlements, profit engine, Gemini OCR only on paid plans).
  - Monthly import volume.
- Subscription status is checked in `CheckSubscriptionLimit` (must be `trial` or `active`) but **no middleware guards any other route** — an expired subscription user still has full access to all data and operations.

### Impact if Absent

- Revenue leakage: expired or free users can use premium features.
- Cannot enforce tiered feature access (e.g., "settlements only on Pro plan").

### Architectural Sketch

```
Domain/Contracts/EntitlementContract.php    — can(string $feature): bool
Application/Services/EntitlementService.php — read plan->features JSONB + subscription status
app/Http/Middleware/CheckFeatureEntitlement.php — route-level gate
```

Add `features` JSONB column to `subscription_plans` alongside `limits`. Apply `CheckFeatureEntitlement` to premium routes (settlements, profit-engine export, FBA tools).

---

## 18. Tauri Desktop Client Feature Parity

| | |
|---|---|
| **Status** | **Thin wrapper — no dedicated offline features** |
| **Priority** | Low |

### Evidence

```json
// tauri-inventory-app/tauri.conf.json
"devUrl": "https://inventory.phyzioline.com/app/index.html#/login",
"frontendDist": "../src"
```

- The desktop client is a **Tauri 2.0 WebView shell** that loads the production web SPA URL. It has no local database, no offline mode, and no desktop-specific UI.
- `tauri-inventory-app/src/` contains a minimal offline placeholder HTML only.
- Plugins installed: `@tauri-apps/plugin-updater` (auto-update), `@tauri-apps/plugin-shell`, `@tauri-apps/plugin-notification`.
- `TauriDesktopUpdateService` + `InventoryDesktopUpdateController` provide the auto-update feed (`/api/v1/inventory/desktop/*`).
- **Desktop-specific features that are absent:**
  - Local barcode scanner hardware integration (HID/USB) beyond what the browser supports.
  - Offline mode with sync queue (no SQLite/local store).
  - Native OS notifications for low-stock / import completion.
  - System tray order alerts.
  - Native print dialog for invoices / labels.
  - File system watcher for auto-import of downloaded settlement files.

### Impact if Absent

- Desktop app provides no additional value over opening Chrome — users may not install it.
- Auto-update infrastructure exists but the client has nothing unique to update.

### Architectural Sketch (Tauri-specific)

```
tauri-inventory-app/src-tauri/src/barcode.rs  — USB HID scanner IPC command
tauri-inventory-app/src-tauri/src/printer.rs  — native print dialog
tauri-inventory-app/src/offline/             — local IndexedDB queue + sync worker
```

Short-term: use `plugin-notification` to show native OS alerts when the backend Reverb event fires.

---

## 19. Top 10 Missing Features Ranked

*For a Noon/Amazon + physical shop inventory business in Egypt.*

| Rank | Feature | Status | Business Impact | Priority |
|:---:|---|---|---|:---:|
| **1** | **Multi-user / staff roles + RBAC** | Missing | Blocks team scaling; all ops run as owner | **High** |
| **2** | **Async job queue for imports** | Missing | Import crashes on >2k rows; no progress feedback | **High** |
| **3** | **Batch / lot / serial tracking** | Missing | Legal compliance for medical devices; recall risk | **High** |
| **4** | **Physical / cycle count workflow** | Missing | Stock accuracy degrades; cannot close accounts | **High** |
| **5** | **Channel-level P&L statement** | Partial | Cannot isolate Amazon vs Noon vs shop profit | **High** |
| **6** | **Reorder points → auto PO suggestions** | Partial | Manual restocking → stockouts on busy SKUs | **Medium** |
| **7** | **Amazon SP-API / Noon API real-time sync** | Missing | Orders are stale by upload cadence (hours/days) | **Medium** |
| **8** | **FBA / FBM operational pages** | Missing | ~30% of features are ComingSoon stubs | **Medium** |
| **9** | **Return claims tracking + treasury integration** | Partial | Reimbursement money is untracked; treasury understated | **Medium** |
| **10** | **Egypt ETA e-Invoice submission** | Missing | Legal compliance risk for B2B invoices >5,000 EGP | **Medium** |

---

## 20. Now / Next / Later Roadmap

*Tied to all four QA-audit docs (01-discovery, 02-security, 03-business-logic, 04-feature-gap).*

---

### NOW (0–6 weeks) — Stop the Bleeding

These address active correctness or security risks and require no major schema changes.

| # | Item | Source finding | Effort |
|---|---|---|---|
| N1 | **Async import jobs** — move `MarketplaceImportService`, `PurchaseImportService`, `SettlementService` to `ShouldQueue` jobs; add Horizon | 01-discovery #3, 04-feature-gap #12 | 2 weeks |
| N2 | **Laravel Policies for destructive routes** — cancel, rollback, withdrawal approve, financial-edit | 01-discovery #1, 02-security §3 | 1 week |
| N3 | **Persist `balance_after` + `notes` in InventoryTransaction** — migration + service update | 04-feature-gap #2 | 3 days |
| N4 | **Unified audit log for cancellations and treasury mutations** — `DocumentAuditLog` observer pattern | 04-feature-gap #3 | 1 week |
| N5 | **Reorder notification email** — scheduled command reads `min_stock` and emails owner | 04-feature-gap #5 | 3 days |
| N6 | **Backup/restore runbook document** — `docs/runbooks/backup-restore.md` | 04-feature-gap #15 | 1 day |
| N7 | **Fix rollback to use compensating entry** — instead of deleting `InventoryTransaction` rows | 04-feature-gap #9, 03-business-logic | 3 days |
| N8 | **Subscription guard on all routes** — expired subscription must block all write operations | 04-feature-gap #17 | 2 days |

---

### NEXT (6–16 weeks) — Competitive Parity

These are significant features that require new models and SPA pages but no architectural breaks.

| # | Item | Source finding | Effort |
|---|---|---|---|
| X1 | **Physical / cycle count module** — `PhysicalCount` + `PhysicalCountItem` models, wizard UI | 04-feature-gap #1 | 3 weeks |
| X2 | **Multi-user staff + role system** — `TenantMember`, invitation flow, `role` gates | 04-feature-gap #11, 04-feature-gap #4 | 4 weeks |
| X3 | **FBA operational page** — replace ComingSoon with ASIN inventory table, inbound shipments, removal orders | 04-feature-gap #16 | 2 weeks |
| X4 | **FBM order queue + pick-pack-ship** | 04-feature-gap #16 | 3 weeks |
| X5 | **Return claims model + treasury integration** | 04-feature-gap #10 | 2 weeks |
| X6 | **Channel P&L report** — fee type breakdown + ads expense slot | 04-feature-gap #8 | 2 weeks |
| X7 | **Reorder rules table + PO suggestion service** | 04-feature-gap #5 | 1 week |
| X8 | **Scan-to-receive + scan-to-ship** barcoding | 04-feature-gap #14 | 2 weeks |
| X9 | **Entitlement service + feature flags per plan** | 04-feature-gap #17, 02-security | 1 week |
| X10 | **Form Requests for fat controllers** (purchase, transaction, settlement) | 01-discovery #2 | 2 weeks |

---

### LATER (16+ weeks) — Strategic Differentiation

These require external API integrations, significant infrastructure, or long-term architectural work.

| # | Item | Source finding | Effort |
|---|---|---|---|
| L1 | **Amazon SP-API + Noon API real-time connector** — replace CSV-only import | 04-feature-gap #13 | 6–8 weeks |
| L2 | **Batch / lot / serial tracking** — schema + domain models + UI | 04-feature-gap #6 | 6 weeks |
| L3 | **Egypt ETA e-Invoice integration** — B2B invoice submission API | 04-feature-gap #13 | 4 weeks |
| L4 | **Unify valuation method (FIFO vs Weighted Avg)** — resolve dual-method debt | 04-feature-gap #7, 03-business-logic | 3 weeks |
| L5 | **Tauri offline mode** — local SQLite queue, barcode HID, native print | 04-feature-gap #18 | 8 weeks |
| L6 | **Shipping courier webhooks** (J&T, Bosta, Aramex) — inbound tracking | 04-feature-gap #13 | 3 weeks |
| L7 | **Migrate `user_id` scoping → `tenant_id`** — prerequisite for true multi-user | 04-feature-gap #11 | 8 weeks |
| L8 | **E2E / Playwright SPA tests** — critical flows (import, checkout, return) | 01-discovery §4 | ongoing |

---

## Appendix: Feature Status Matrix

| # | Feature | Status | Priority |
|:---:|---|:---:|:---:|
| 1 | Physical / cycle count | ❌ Missing | High |
| 2 | Immutable stock ledger (balance_after + notes) | ⚠️ Partial | High |
| 3 | Audit trail (cancellations + purchase + treasury) | ⚠️ Partial | High |
| 4 | Fine-grained RBAC | ❌ Missing | High |
| 5 | Low-stock alerts (dashboard) | ✅ Present | — |
| 5b | Reorder points → PO suggestions | ⚠️ Partial | Medium |
| 5c | Low-stock email / push notifications | ❌ Missing | Medium |
| 6 | Batch / lot / serial tracking | ❌ Missing | High |
| 7 | Inventory valuation method choice | ⚠️ Partial | Medium |
| 8 | Channel-level P&L + fee breakdown | ⚠️ Partial | High |
| 9 | Idempotent marketplace import | ✅ Present (85%) | — |
| 10 | Return reason analytics | ✅ Present | — |
| 10b | Claims tracking + treasury integration | ⚠️ Partial | Medium |
| 11 | Multi-user staff roles within one tenant | ❌ Missing | High |
| 12 | Async job processing | ❌ Missing | High |
| 13 | Webhooks / integrations beyond Paymob | ⚠️ Partial | Medium |
| 14 | Barcode receive / ship | ⚠️ Partial (returns only) | Medium |
| 15 | Backup script | ✅ Present | — |
| 15b | Restore runbook documented | ❌ Missing | Medium |
| 16 | FBA / FBM pages | ❌ ComingSoon | Medium |
| 17 | Subscription entitlement breadth | ⚠️ Partial | Medium |
| 18 | Desktop Tauri feature parity | ⚠️ Thin wrapper | Low |

**Legend:** ✅ Present · ⚠️ Partial · ❌ Missing/ComingSoon

---

*End of report. No code was modified. All evidence references files in `/home/phyzioline-inventory/htdocs/inventory.phyzioline.com`.*
