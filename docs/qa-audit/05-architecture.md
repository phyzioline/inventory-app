# 05 — Architecture Review

**Repo:** `phyzioline/inventory-app` — `/home/phyzioline-inventory/htdocs/inventory.phyzioline.com`  
**Date:** 2026-07-30  
**Mode:** Read-only static analysis — no code modified  
**Identity check:** `pwd` = inventory.phyzioline.com · remote = `phyzioline/inventory-app.git` · **no `Modules/`** ✓

---

## Table of Contents

1. [Clean Architecture Compliance](#1-clean-architecture-compliance)
2. [Fat Controllers](#2-fat-controllers)
3. [Missing Form Requests & API Resources](#3-missing-form-requests--api-resources)
4. [Service Layer Analysis](#4-service-layer-analysis)
5. [Dead / Legacy Code](#5-dead--legacy-code)
6. [SOLID / DRY Issues](#6-solid--dry-issues)
7. [Maintainability Scorecard](#7-maintainability-scorecard)
8. [Prioritized Refactor Roadmap](#8-prioritized-refactor-roadmap)

Cross-references: [01-discovery](01-discovery-report.md) · [02-security](02-security-review.md) · [03-business-logic](03-business-logic.md) · [04-feature-gap](04-feature-gap.md)

---

## 1. Clean Architecture Compliance

### 1.1 Target layering (from CLAUDE.md)

| Layer | Expected path | File count |
|---|---|---:|
| Application | `app/Application/` | 30 |
| Domain | `app/Domain/` | 58 |
| Infrastructure | `app/Infrastructure/` | 13 |
| Presentation | `app/Presentation/` | 67 |
| **Total in layers** | | **168** |
| **Leftovers outside layers** | | **8** |

176 PHP files total under `app/`.

### 1.2 Leftover files outside the four layers

| File | Justification | Verdict |
|---|---|---|
| `app/Models/User.php` | Auth user model — Laravel convention | ✅ Acceptable |
| `app/Providers/AppServiceProvider.php` | Bootstrap, bindings | ✅ Acceptable |
| `app/Providers/DatabaseSafetyServiceProvider.php` | Safety guard registration | ✅ Acceptable |
| `app/Support/DatabaseSafetyGuard.php` | Production wipe protection | ✅ Acceptable |
| `app/Http/Controllers/Controller.php` | Base controller (all Presentation controllers extend it) | ✅ Acceptable |
| `app/Http/Middleware/CheckSubscriptionLimit.php` | Global middleware | ✅ Acceptable |
| `app/Http/Middleware/EnsureSuperAdmin.php` | Global middleware | ✅ Acceptable |
| `app/Console/Commands/BackfillReturnLedgerLinks.php` | **Misplaced** — one-off backfill command. Should be under `Presentation/Console/Commands/` | ⚠️ Violation |

**Assessment: 95% compliant.** Only one file (`BackfillReturnLedgerLinks`) breaks placement conventions. The allowed leftovers (`User`, providers, middleware, base Controller, safety guard) are explicitly blessed in the project rules.

### 1.3 Domain layer internals

| Sub-path | Count | Notes |
|---|---|---|
| `Domain/Models/Wms/*` | 50 | Core WMS models — well organized |
| `Domain/Models/Product.php` | 1 | Legacy morph shim (see §5.1) |
| `Domain/Models/Subscription*.php` | 3 | SaaS models |
| `Domain/Events/*` | 5 | Thin domain events |
| `Domain/ValueObjects/InvoiceSnapshot.php` | 1 | Single value object |
| `Domain/Contracts/` | 0 | **Missing entirely** |

**Gap:** Zero interfaces/contracts in the Domain layer. Services depend directly on concrete model classes. This weakens testability and violates the Dependency Inversion Principle (see §6).

---

## 2. Fat Controllers

### 2.1 Line-count ranking (all controllers)

| # | Controller | Lines | Public methods | `validate()` calls | `DB::` calls |
|--:|---|---:|---:|---:|---:|
| 1 | **InventoryTransactionController** | **1,391** | 9 | 5 | 15 |
| 2 | **PurchaseImportController** | **1,225** | 16 | 7 | 2 |
| 3 | **MasterProductController** | **890** | 11 | 5 | 15 |
| 4 | **SupplierController** | **741** | 9 | 2 | 0 |
| 5 | **CustomerController** | **717** | 10 | 3 | 2 |
| 6 | SettlementController | 694 | 11 | 3 | 7 |
| 7 | CashFlowSummaryController | 654 | 4 | 0 | — |
| 8 | SkuController | 521 | 7 | 2 | — |
| 9 | ChannelSkuImportController | 496 | 4 | — | — |
| 10 | FbaShipmentTransferController | 447 | 1 | — | — |
| 11 | PurchaseReturnController | 440 | 5 | — | — |
| 12 | AsnTransferController | 402 | 3 | — | — |

**Threshold:** Clean controllers should stay under ~150 lines. Anything above 300 is a clear refactoring candidate.

### 2.2 Detailed breakdown — top 5 offenders

#### InventoryTransactionController (1,391 lines)

- **9 public methods** with zero private/protected helpers — all logic is inline.
- **15 raw `DB::` calls** including complex query building with joins, subqueries, and aggregates.
- **5 inline `validate()` calls** — no Form Requests.
- `index()` alone contains complex paginated query building with ~15 filters, aggregate subqueries, and conditional joins — this is query service logic.
- `store()` performs multi-step stock mutation with `DB::transaction`, balance checks, and cross-location inventory creation — duplicates work that `InventoryTransactionService` should own.
- `transfer()` / `transferBatch()` contain full transfer orchestration with per-item stock checks, a nested loop, and rollback logic.

**Refactoring plan:**
- Extract query logic → `InventoryTransactionQueryService` (index, skuTracker)
- Extract mutation logic → expand existing `InventoryTransactionService` (store, transfer, transferBatch, updateTransfer)
- Extract all 5 `validate()` calls → `StoreTransactionRequest`, `TransferRequest`, `TransferBatchRequest` Form Requests
- All `DB::` calls in this controller should live in services or query objects

#### PurchaseImportController (1,225 lines)

- **16 public methods** — this controller covers upload, preview, batch CRUD, approval, receive, cancel, and payment metadata.
- **7 inline `validate()` calls**.
- Has constructor DI for `PurchaseImportService` (good), but still does inline `TreasurySpendGuard` calls via `app()` at line 480.
- The `store()` method directly manipulates `PurchaseBatch`, `PurchaseBatchItem`, and `SkuInventory` instead of delegating to the service.
- Approval and receive flows contain treasury/stock logic that belongs in the Application layer.

**Refactoring plan:**
- Consolidate all batch state-transition logic into `PurchaseImportService`
- Extract 7 `validate()` calls → Form Requests (`UploadPurchaseRequest`, `StorePurchaseBatchRequest`, `UpdatePaymentMetaRequest`, etc.)
- Remove direct `app(TreasurySpendGuard)` from controller — inject or delegate through service

#### MasterProductController (890 lines)

- **11 public methods** with 5 inline `validate()` calls and **15 `DB::` calls**.
- `index()` builds a complex Eloquent query with conditional joins and subqueries entirely in the controller.
- `store()` / `update()` contain slug generation, SKU linking, and channel listing logic that belongs in a service.
- `ensureChannelListing()` even accepts `PurchaseImportService` as a parameter — mixing concerns.

**Refactoring plan:**
- Extract → `MasterProductService` (CRUD + slug + SKU linking)
- Extract → `MasterProductQueryService` (index queries)
- Extract 5 `validate()` → Form Requests

#### SupplierController (741 lines) & CustomerController (717 lines)

- Both follow a similar pattern: CRUD + bulk upload + account ledger summary.
- Inline `validate()`, direct Eloquent queries with joins, and embedded Excel import logic.
- `SupplierController::bulkUpload()` contains full spreadsheet parsing and batch insert logic.
- `CustomerController::accountSummary()` builds complex financial aggregate queries.

**Refactoring plan:**
- `SupplierController`: bulk import logic → `SupplierImportService`; account summary → existing `FinanceAccountLedgerService` or new query service
- `CustomerController`: same pattern — query logic → service; Form Requests for validation

### 2.3 Summary: controller health

| Metric | Value |
|---|---|
| Controllers > 500 lines | 8 |
| Controllers > 300 lines | 12 |
| Controllers using `DB::` facade directly | 6 (worst: ITController with 15 calls) |
| Total inline `validate()` calls across all controllers | ~75 |
| Form Requests in use | **0** |
| API Resources in use | **0** |

---

## 3. Missing Form Requests & API Resources

### 3.1 Form Requests

**Current state: Zero Form Requests exist anywhere in the project.**

`app/Presentation/Http/Requests/` does not exist. All 46 controllers that accept user input use `Illuminate\Http\Request` directly and call `$request->validate()` inline. This means:

- Validation rules are not reusable across endpoints
- Authorization logic (`authorize()`) is entirely absent from the request layer
- Testing requires hitting full controller methods instead of isolated request validation
- API documentation generation cannot introspect typed request objects

**Highest-priority Form Requests needed (by controller fatness):**

| Controller | Estimated request classes needed |
|---|---|
| InventoryTransactionController | 4 (Store, Transfer, TransferBatch, Update) |
| PurchaseImportController | 5 (Upload, Store, Update, AddItem, PaymentMeta) |
| MasterProductController | 3 (Store, Update, BulkLink) |
| SupplierController | 2 (Store/Update, BulkUpload) |
| CustomerController | 2 (Store/Update, Receive) |
| SettlementController | 3 (Store, Import, Summary) |
| **Total estimated** | **~30–35 Form Request classes** |

### 3.2 API Resources

**Current state: Zero API Resource classes exist.**

Controllers return raw Eloquent models or manual `response()->json()` arrays. Consequences:

- No consistent response shape contract between backend and SPA
- Sensitive attributes may leak (e.g., `user_id`, pivot data, internal timestamps)
- No centralized place to format money, dates, or nested relations
- Frontend must defensively handle shifting response shapes

**Highest-priority API Resources needed:**

| Entity | Notes |
|---|---|
| `InventoryTransactionResource` | Complex response with joins — fragile inline array building |
| `MasterProductResource` | Includes nested SKUs, channel listings |
| `PurchaseBatchResource` | Nested items, payment status |
| `SupplierResource` / `CustomerResource` | Account summaries included inline |
| `SettlementResource` | Nested settlement items |

---

## 4. Service Layer Analysis

### 4.1 Service inventory (27 services, 17,087 total lines)

| Service | Lines | Primary consumers |
|---|---:|---|
| MarketplaceImportService | 3,678 | InventoryOrderController, MarketplaceOrderController, SettlementService |
| SettlementService | 2,378 | SettlementController |
| PurchaseImportService | 2,180 | PurchaseImportController, MasterProductController |
| ProfitEngineService | 1,685 | ProfitReportController, InventoryOrderController, SettlementController, SkuController |
| InventoryReturnImportService | 1,124 | ReturnController, InventoryReturnMutationService |
| InventoryOrderMutationService | 1,050 | InventoryOrderController |
| ChannelStockResolver | 949 | — |
| InventoryValuationService | 542 | — |
| ProductImportService | 494 | ProductImportController |
| InvoiceEditService | 370 | InvoiceEditController |
| InventoryReturnMutationService | 302 | ReturnController |
| DashboardMetricsService | 263 | DashboardMetricsController |
| FinanceAccountLedgerService | 247 | — |
| SupplierIdentityConsolidationService | 221 | ConsolidateSupplierIdentityCommand |
| MatchingEngineService | 219 | — |
| InventoryAdjustmentService | 205 | — |
| ReceiptApplicationService | 188 | — |
| InventoryReturnListingService | 146 | ReturnController |
| TreasurySpendGuard | 138 | ExpenseController, PaymentController, PurchaseImportController, InventoryReturnMutationService, PurchaseImportService |
| SubscriptionCheckoutService | 130 | SubscriptionController |
| SulfaCashMirrorService | 120 | — |
| TreasuryLedgerService | 87 | — |
| InventoryReportQueryService | 86 | InventoryReportController |
| CapitalReceiptWriter | 83 | — |
| TauriDesktopUpdateService | 80 | InventoryDesktopUpdateController |
| InventoryTransactionService | 70 | ChannelSkuImportController, InventoryAdjustmentImportController |
| SkuImageResolver | 52 | — |

### 4.2 Boundary concerns

#### Return services trio

Three services collaborate on returns:

| Service | Responsibility | Lines |
|---|---|---:|
| `InventoryReturnImportService` | Parse & import return sheets, status transition logic | 1,124 |
| `InventoryReturnMutationService` | Upsert, process, receive returns, sync refund payments | 302 |
| `InventoryReturnListingService` | Paginated listing query | 146 |

**Boundary issue:** `InventoryReturnImportService` accepts `Request $request` directly in its public methods (`importFromRequest`, `importLedgerFromRequest`). This couples an Application-layer service to the HTTP layer — it should receive a DTO or validated array, not the raw request. The Presentation layer should extract data before calling the service.

The split across three classes is a good SRP practice, but `ImportService` at 1,124 lines is a candidate for further decomposition (parser vs orchestrator).

#### MarketplaceImportService (3,678 lines) vs InventoryOrderMutationService (1,050 lines)

These two services both touch `InventoryOrder` and `InventoryOrderItem` records, but from different angles:

- **MarketplaceImportService**: Import from spreadsheet → create orders → stock deduction → idempotency tracking. Called by `InventoryOrderController` and `MarketplaceOrderController`.
- **InventoryOrderMutationService**: Manual CRUD store/update/cancel on orders. Called only by `InventoryOrderController`.

**Boundary risk:** The stock deduction path in `MarketplaceImportService` bypasses `InventoryOrderMutationService` entirely. If deduction logic needs to change, two code paths exist. Consider having `MarketplaceImportService` delegate the actual order creation/deduction to `InventoryOrderMutationService`, with the import service owning only the parsing and orchestration.

#### TreasurySpendGuard placement

`TreasurySpendGuard` lives in `app/Application/Services/` — architecturally correct as Application-layer policy. However, it is consumed via `app(TreasurySpendGuard::class)` service-locator calls in 3 controllers (Expense, Payment, PurchaseImport) and 1 service (PurchaseImportService), rather than constructor injection.

**Issues:**
- Service locator pattern makes dependencies invisible and harder to test
- The class is registered as a singleton in `AppServiceProvider`, so DI would work identically
- Controllers that call it directly embed treasury policy checks in Presentation — the guard should be invoked exclusively from Application services

### 4.3 Giant services

`MarketplaceImportService` at 3,678 lines is the largest service and a SRP concern. Its 5 public methods span: file parsing, order creation, stock deduction, batch rollback, and retry logic. This could decompose into:

- `MarketplaceSheetParser` — file parsing and row normalization
- `MarketplaceOrderCreator` — order/item creation and idempotency
- `MarketplaceStockDeductor` — stock OUT logic with rollback capability

Similarly, `SettlementService` (2,378 lines) and `PurchaseImportService` (2,180 lines) combine parsing, validation, orchestration, and query logic in single classes.

---

## 5. Dead / Legacy Code

### 5.1 Product morph shim (`app/Domain/Models/Product.php`)

A 229-line model documented as a "standalone-extraction note" leftover. Per its own docblock:

> "A repo-wide grep confirmed this model has zero callers inside Inventory's own Presentation/Application/Infrastructure layers; the real Inventory/WMS catalog is `App\Domain\Models\Wms\MasterProduct / Sku`."

Current grep confirms: **zero references** to `App\Domain\Models\Product` from any controller, service, or infrastructure file. The only reference was `ProductCreated` event, which itself has no callers.

**Verdict:** Dead code. Both `Product.php` and `ProductCreated.php` can be safely removed.

### 5.2 TransferController — semi-dead

`TransferController` (258 lines) has 4 routes registered but its `index()` method returns an empty array with a comment "For now, return empty array." The actual transfer functionality lives in `InventoryTransactionController::transfer()` and `transferBatch()`, plus the separate `AsnTransferController` and `FbaShipmentTransferController`.

**Verdict:** `TransferController` appears to be a vestigial scaffold. Its bulk-upload feature overlaps with what `InventoryTransactionController` already does. Candidate for removal or consolidation.

### 5.3 Supabase remnants in frontend

**43 frontend files** still import from `@/lib/supabase-services` (1,083 lines). However, inspecting `supabase-services.ts` reveals it was **already refactored**: it now imports from `@/lib/api` (the Laravel API client) and no longer references Supabase at all. The filename is misleading.

`supabase.ts` (219 lines) contains only TypeScript interfaces (type definitions) — no Supabase client connection. The Supabase SDK is not present in `package.json`.

**Verdict:** Supabase is functionally eliminated. The files should be renamed to remove the misleading "supabase" naming:
- `supabase-services.ts` → `api-services.ts` or similar
- `supabase.ts` → `api-types.ts` or merge into existing type files

### 5.4 BackfillReturnLedgerLinks

One-off backfill command in `app/Console/Commands/` — placement should be `Presentation/Console/Commands/`. Additionally, if this backfill has already run in production, the command itself may be dead code.

### 5.5 InventoryMorphTypes

`app/Infrastructure/Support/InventoryMorphTypes.php` maps legacy monolith morph class names (`App\Models\Inventory\InventoryOrder`) to current classes. Only consumed by `TreasuryPanelController`. Low risk but monitor — once all legacy morph strings are migrated in the database, this can be removed.

---

## 6. SOLID / DRY Issues

### 6.1 Single Responsibility Principle (SRP) violations

| Evidence | Path |
|---|---|
| `InventoryTransactionController` handles CRUD, transfers, batch transfers, queries, and stock mutations in 1,391 lines | `app/Presentation/Http/Controllers/Api/InventoryTransactionController.php` |
| `MarketplaceImportService` parses files, creates orders, deducts stock, rolls back, and retries in 3,678 lines | `app/Application/Services/MarketplaceImportService.php` |
| `PurchaseImportController` manages uploads, batch CRUD, approval workflow, receiving, cancellation, and payment metadata | `app/Presentation/Http/Controllers/Api/PurchaseImportController.php` |
| `CashFlowSummaryController` at 654 lines contains `getCoreStats()` and `getCoreStatsForUser()` methods that compute treasury/financial aggregates — this is Application-layer query logic, not controller responsibility | `app/Presentation/Http/Controllers/Api/CashFlowSummaryController.php` |

### 6.2 Open/Closed Principle (OCP) violations

- Stock movement types (IN, OUT, TRANSFER, ADJUSTMENT) are handled by if/switch chains in controllers rather than via strategy or command patterns.
- `MarketplaceImportService` hard-codes marketplace-specific parsing logic — adding a new marketplace format requires modifying the existing class rather than extending it.

### 6.3 Liskov Substitution Principle (LSP)

No significant violations detected. The model inheritance hierarchy is flat (all extend `Model` directly).

### 6.4 Interface Segregation Principle (ISP)

**Domain has zero interfaces.** Services depend on concrete Eloquent models directly. No contracts exist for:
- Stock mutation operations
- Treasury/ledger writes  
- Import parsing

This makes it impossible to swap implementations or create test doubles without full Eloquent model bootstrapping.

### 6.5 Dependency Inversion Principle (DIP) violations

| Evidence | Path |
|---|---|
| `TreasurySpendGuard` consumed via `app()` service locator in 3 controllers and 1 service instead of constructor DI | `ExpenseController`, `PaymentController`, `PurchaseImportController`, `PurchaseImportService` |
| `ProfitEngineService` consumed via `app()` in 2 controllers instead of DI | `InventoryOrderController`, `SettlementController` |
| `InventoryReturnImportService` accepts `Illuminate\Http\Request` directly — Application service depends on HTTP layer | `app/Application/Services/InventoryReturnImportService.php` |
| All services depend on concrete Eloquent models — no repository abstractions | project-wide |

### 6.6 DRY violations

| Duplication | Locations |
|---|---|
| Inline validation rules for inventory transactions appear in `InventoryTransactionController::store()`, `transfer()`, and `transferBatch()` with overlapping field sets | `InventoryTransactionController.php` |
| Stock balance calculation (`SkuInventory` sum queries) duplicated across `InventoryTransactionController`, `ChannelStockResolver`, and `InventoryAdjustmentService` | 3 files |
| `TreasurySpendGuard` invocation pattern `app(TreasurySpendGuard::class)->assertPaymentAllowed(...)` repeated identically in 4 locations instead of being encapsulated in the service that orchestrates the payment | 4 files |
| Supplier/Customer bulk-upload Excel parsing follows identical patterns but is implemented independently in each controller | `SupplierController`, `CustomerController` |

---

## 7. Maintainability Scorecard

| Dimension | Score (1–5) | Notes |
|---|:---:|---|
| **Layer separation** | 4 | Clean four-layer structure with only 1 misplaced file. Excellent for a monolith extraction. |
| **Controller thinness** | 2 | 8 controllers over 500 lines; top controller at 1,391. Significant business logic lives in Presentation. |
| **Form Requests** | 1 | None exist. ~75 inline validate() calls across all controllers. |
| **API Resources** | 1 | None exist. Raw models/arrays returned to SPA. |
| **Service boundaries** | 3 | 27 services with mostly clear responsibilities, but MarketplaceImportService (3,678 lines) is a god service. Some cross-boundary coupling. |
| **Domain contracts** | 1 | Zero interfaces in Domain. All dependencies are on concretions. |
| **Value objects** | 1 | Only 1 value object (`InvoiceSnapshot`). Money, SKU codes, quantities are primitives everywhere. |
| **DRY** | 2 | Stock balance queries, validation rules, and guard invocations duplicated across files. |
| **Dead code** | 4 | Only `Product.php` morph shim + `TransferController` scaffold + naming vestiges. Relatively clean. |
| **Test coverage** | 2 | 19 test files — reasonable for critical paths but gaps in CRUD controller coverage. No request/resource tests possible without Form Requests/Resources. |
| **Dependency injection** | 3 | Most controllers use constructor DI, but ~6 use `app()` service locator. One service accepts raw `Request`. |
| **Overall** | **2.5** | The Clean Architecture skeleton is solid. The principal debt is fat controllers, missing request/response abstractions, and service gigantism. |

**Legend:** 1 = Critical gap · 2 = Significant debt · 3 = Acceptable · 4 = Good · 5 = Exemplary

---

## 8. Prioritized Refactor Roadmap

### NOW — High impact, low risk (sprint 1–2)

| # | Item | Impact | Effort |
|--:|---|---|---|
| 1 | **Create Form Requests** for the top 5 fat controllers (~20 classes). Start with `InventoryTransactionController` and `PurchaseImportController`. Each `$request->validate()` becomes a typed `FormRequest` class under `Presentation/Http/Requests/`. | Removes ~40 inline validate() blocks, enables request-level authorization, improves testability | Medium |
| 2 | **Extract query logic from InventoryTransactionController** into `InventoryTransactionQueryService` (index, skuTracker filters/aggregations). Controller drops from ~1,391 to ~400 lines. | Biggest single-controller win; removes 15 `DB::` calls from Presentation | Medium |
| 3 | **Move BackfillReturnLedgerLinks.php** from `app/Console/Commands/` to `Presentation/Console/Commands/`. | 1-minute rename; fixes the only placement violation | Trivial |
| 4 | **Replace `app()` service locator calls** with constructor DI for `TreasurySpendGuard` and `ProfitEngineService` in all controllers. | Makes dependencies explicit; enables mocking in tests | Low |
| 5 | **Delete dead Product morph shim** — remove `app/Domain/Models/Product.php` and `app/Domain/Events/ProductCreated.php`. Verify zero callers first (confirmed in this audit). | Removes 230+ lines of dead code and confusion risk | Trivial |

### NEXT — Structural improvements (sprint 3–5)

| # | Item | Impact | Effort |
|--:|---|---|---|
| 6 | **Extract mutation logic from fat controllers** into services: `MasterProductService`, `SupplierService`/`CustomerService` for CRUD + bulk upload, expanded `InventoryTransactionService` for store/transfer/batch. | 5 controllers become thin; business logic moves to testable services | High |
| 7 | **Create API Resource classes** for the top 10 entities. Start with `InventoryTransactionResource`, `MasterProductResource`, `PurchaseBatchResource`. | Consistent API contract, prevents attribute leakage, enables response testing | Medium |
| 8 | **Decompose MarketplaceImportService** (3,678 lines) into Parser, OrderCreator, and StockDeductor. Have MarketplaceImportService orchestrate them. | SRP compliance for the most critical import path | High |
| 9 | **Fix InventoryReturnImportService** to accept DTOs instead of `Request` objects. Create `ReturnImportDTO` to decouple Application from HTTP. | Proper layer boundary; enables CLI/job-driven imports | Low |
| 10 | **Rename Supabase remnant files**: `supabase-services.ts` → `api-services.ts`, `supabase.ts` → `api-types.ts`. Update all 43 importers. | Eliminates developer confusion; no functional change | Low |
| 11 | **Consolidate or remove TransferController** — evaluate whether `bulkUpload()` and `executeBulkTransfer()` duplicate `InventoryTransactionController::transferBatch()`. If redundant, remove. | Reduces controller sprawl and dead routes | Low |

### LATER — Architectural maturity (quarter 3+)

| # | Item | Impact | Effort |
|--:|---|---|---|
| 12 | **Introduce Domain Contracts** (interfaces) for core operations: `StockMutator`, `LedgerWriter`, `TreasuryPolicy`. Bind in `AppServiceProvider`. | DIP compliance; enables testing with doubles; opens door for alternate implementations | High |
| 13 | **Introduce Value Objects**: `Money`, `SkuCode`, `Quantity` to replace raw float/string primitives in domain models and services. | Type safety; prevents currency/unit confusion; self-documenting code | High |
| 14 | **Decompose SettlementService** (2,378 lines) and **PurchaseImportService** (2,180 lines) following the same pattern as MarketplaceImportService decomposition. | SRP compliance for the second and third largest services | High |
| 15 | **Add integration test coverage** for controller → service flows, especially the CRUD paths that currently have zero coverage. Form Requests and Resources from earlier phases make this tractable. | Regression safety for the 8 critical paths identified in [03-business-logic](03-business-logic.md) | High |
| 16 | **Evaluate CQRS-lite** for read-heavy endpoints: `InventoryTransactionController::index()`, `CashFlowSummaryController::overview()`, `ProfitReportController`. Separate read models/projections from write services. | Performance + clean separation of query vs command | Very High |

---

## Appendix A — File Counts Summary

| Category | Count |
|---|---:|
| Total PHP files under `app/` | 176 |
| Application services | 27 |
| Domain models (Wms) | 50 |
| Domain events | 5 |
| Domain value objects | 1 |
| Domain contracts/interfaces | 0 |
| Infrastructure files | 13 |
| Presentation controllers | 52 |
| Presentation console commands | 17 |
| Form Requests | 0 |
| API Resources | 0 |
| Database migrations | 82 |
| Test files | 19 |
| Frontend files importing `supabase-services` | 43 |

## Appendix B — Controller line counts (complete)

| Controller | Lines |
|---|---:|
| InventoryTransactionController | 1,391 |
| PurchaseImportController | 1,225 |
| MasterProductController | 890 |
| SupplierController | 741 |
| CustomerController | 717 |
| SettlementController | 694 |
| CashFlowSummaryController | 654 |
| SkuController | 521 |
| ChannelSkuImportController | 496 |
| FbaShipmentTransferController | 447 |
| PurchaseReturnController | 440 |
| AsnTransferController | 402 |
| RemovalController | 371 |
| BarcodeReturnController | 341 |
| QuotationController | 324 |
| ProfitReportController | 298 |
| InventoryAdjustmentImportController | 274 |
| PaymentController | 265 |
| TransferController | 258 |
| ASINController | 256 |
| ChannelController | 249 |
| InventoryLocationController | 228 |
| InventoryController | 220 |
| InventoryOrderController | 216 |
| InventoryAuthController | 213 |
| MarketplaceOrderController | 207 |
| TreasuryPanelController | 194 |
| ReceiptController | 188 |
| ExpenseController | 184 |
| ProductImportController | 177 |
| TreasurySulfaController | 173 |
| VendorController | 150 |
| ImageProxyController | 142 |
| ReturnController | 135 |
| DraftProductReviewController | 135 |
| CapitalSourceController | 132 |
| AdminErrorLogController | 114 |
| PaymobWebhookController | 99 |
| InvoiceEditController | 88 |
| All remaining (Admin*) | <100 each |

---

*End of Architecture Review. This is a read-only analysis document — no product code was modified.*
