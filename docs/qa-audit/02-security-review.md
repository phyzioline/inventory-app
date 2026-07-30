# Security Review — inventory-app (`phyzioline/inventory-app`)

**Date:** 2026-07-30  
**Scope:** Authorization, tenant isolation, destructive endpoints, IDOR, CSRF/webhook, secrets  
**Repo:** `/home/phyzioline-inventory/htdocs/inventory.phyzioline.com`  
**Method:** Read-only static analysis  

---

## 1. Auth Stack

### 1.1 Session / CSRF

| Layer | Detail |
|---|---|
| Auth driver | Sanctum session-cookie (`web` middleware group) |
| CSRF | Active for all POST/PUT/PATCH/DELETE via `web` group |
| CSRF exception | `webhooks/paymob` only (`bootstrap/app.php:32`) |
| Route file | `routes/api.php` loaded via `Route::middleware('web')->group(...)` in `routes/web.php:24` |

All API routes are nested under `Route::middleware(['auth'])` (`routes/api.php:66`) except:
- `auth/login`, `auth/logout`, `auth/register`, `auth/forgot-password`, `auth/reset-password` (public)
- `image-proxy` (public, GET only, domain-allowlisted)
- `api/v1/inventory/desktop/*` (public, GET only, Tauri updater)
- `webhooks/paymob` (server-to-server, HMAC-verified)

### 1.2 Gate::before (Super-admin bypass)

```
app/Providers/AppServiceProvider.php:95
Gate::before(fn ($user, string $ability) => $user->is_super_admin ? true : null);
```

- `is_super_admin` is **not** in `User::$fillable` — cannot be mass-assigned.
- Set only via `php artisan admin:grant-super <email>`.
- Gate::before returns `true` (bypass all policies/gates) or `null` (fall through).

### 1.3 Middleware aliases

| Alias | Class | Purpose |
|---|---|---|
| `super.admin` | `App\Http\Middleware\EnsureSuperAdmin` | Aborts 403 unless `$user->is_super_admin` |
| `check.subscription.limit` | `App\Http\Middleware\CheckSubscriptionLimit` | Limits warehouse/channel creation by plan |

`super.admin` is applied only to `admin/overview`, `admin/subscriptions`, `admin/error-log`.

### 1.4 Tenant isolation: `IsIsolatedByUser` trait

**Location:** `app/Infrastructure/Traits/IsIsolatedByUser.php`

**Mechanism:**
- Adds a global scope: `WHERE {table}.user_id = Auth::id()`
- On `creating`: auto-sets `user_id` if null
- Unauthenticated HTTP requests get `WHERE 0 = 1` (returns nothing)
- Console context: no scope applied (for artisan commands)

**Models using the trait (31 models):**

| Model | Uses `IsIsolatedByUser` |
|---|---|
| MasterProduct, InventoryOffer, Sku, SkuInventory | ✓ |
| Channel, InventoryLocation (Warehouse) | ✓ |
| InventoryOrder, InventoryOrderItem, SalesOrder, SalesOrderItem | ✓ |
| PurchaseBatch, PurchaseUpload, PurchaseReturn, PurchaseReturnItem | ✓ |
| Settlement, InventoryReturn, ReturnItem | ✓ |
| InventoryTransaction, InventoryAdjustment | ✓ |
| InventoryRemovalOrder, InventoryRemovalItem | ✓ |
| Vendor, Supplier, Customer, SupplierProductAlias | ✓ |
| Expense, Payment, Receipt | ✓ |
| CapitalSource, Withdrawal, TreasurySulfa | ✓ |
| TreasuryAccount, TreasuryCashTransaction, FinanceAccount | ✓ |
| ASIN, ASINPriceHistory, ProductAlias, DraftMasterProduct | ✓ |
| Subscription | ✓ |

**Models WITHOUT the trait (security-relevant):**

| Model | Risk |
|---|---|
| `ProfitDistribution` | **HIGH** — no `user_id` scope, `findOrFail($id)` exposes cross-tenant data |
| `PurchaseBatchItem` | Low — always accessed via parent `PurchaseBatch` (which IS isolated) |
| `SettlementItem` | Low — accessed via parent `Settlement` or `whereHas('settlement')` |

---

## 2. Destructive / Money / Stock-Critical API Route Matrix

All routes below are under `POST api/inventory/...` or `DELETE api/inventory/...`, protected by `auth` middleware.

### 2.1 Order & Import (Stock OUT)

| HTTP | Path | Controller::method | Policy/Gate beyond `auth` | Risk |
|---|---|---|---|---|
| POST | `orders/{id}/cancel` | `InventoryOrderController::cancel` | **None** | Stock reversal |
| POST | `orders/import` | `InventoryOrderController::import` | **None** | Bulk order create + stock OUT |
| POST | `marketplace/import` | `MarketplaceOrderController::import` | **None** | Marketplace CSV → orders + stock OUT |
| POST | `marketplace/import/rollback-last` | `MarketplaceOrderController::rollbackLast` | **None** | Reverses last import stock deductions |
| POST | `marketplace/import/retry-stock-deductions` | `MarketplaceOrderController::retryStockDeductions` | **None** | Re-runs pending stock deductions |
| PUT | `orders/{id}/financial-edit` | `InvoiceEditController::edit` | **None** | Edits completed order financials |

### 2.2 Purchase Lifecycle (Stock IN + AP)

| HTTP | Path | Controller::method | Policy/Gate beyond `auth` | Risk |
|---|---|---|---|---|
| POST | `purchases/smart-import/batches` | `PurchaseImportController::store` | **None** (validates ownership via `Rule::exists` + `user_id`) | Creates + auto-approves + receives invoice |
| POST | `purchases/smart-import/batches/{id}/approve` | `PurchaseImportController::approve` | **None** | Approves purchase → updates vendor payable |
| POST | `purchases/smart-import/batches/{id}/receive` | `PurchaseImportController::receive` | **None** | Stock IN + vendor balance adjustment |
| POST | `purchases/smart-import/batches/{id}/cancel` | `PurchaseImportController::cancel` | **None** | Cancels batch, optionally reverses stock |
| DELETE | `purchases/smart-import/batches/{batchId}/items/{itemId}` | `PurchaseImportController::removeItem` | **None** | Removes line from received invoice → stock OUT |
| POST | `purchases/smart-import/batches/{id}/payment-meta` | `PurchaseImportController::updatePaymentMeta` | **None** | Changes paid/remaining → vendor balance |

### 2.3 Returns (Stock + Ledger)

| HTTP | Path | Controller::method | Policy/Gate beyond `auth` | Risk |
|---|---|---|---|---|
| POST | `returns/{id}/process` | `ReturnController::process` | **None** | Processes return → stock IN + ledger |
| POST | `returns/{id}/receive` | `ReturnController::receive` | **None** | Receives return |
| POST | `returns/import` | `ReturnController::import` | **None** | Bulk return import |
| POST | `purchase-returns` | `PurchaseReturnController::store` | **None** | Purchase return → stock OUT + vendor credit |
| PUT | `purchase-returns/{id}` | `PurchaseReturnController::update` | **None** | Edits return lines → stock deltas |

### 2.4 Financial (Treasury / Money)

| HTTP | Path | Controller::method | Policy/Gate beyond `auth` | Risk |
|---|---|---|---|---|
| POST | `withdrawals/{id}/approve` | `WithdrawalController::approve` | **None** | Approves capital withdrawal |
| POST | `withdrawals/{id}/complete` | `WithdrawalController::complete` | **None** | Marks withdrawal as paid out |
| POST | `payments` | `PaymentController::store` | **None** (TreasurySpendGuard) | Creates payment → updates supplier/vendor balance |
| DELETE | `payments/{id}` | `PaymentController::destroy` | **None** (blocks completed) | Deletes pending payment |
| POST | `expenses` | `ExpenseController::store` | **None** (TreasurySpendGuard) | Creates expense |
| DELETE | `expenses/{id}` | `ExpenseController::destroy` | **None** | Deletes expense (no status check) |
| POST | `receipts` | `ReceiptController::store` | **None** | Creates receipt (incoming money) |
| DELETE | `receipts/{id}` | `ReceiptController::destroy` | **None** (no status check) | Deletes receipt |
| POST | `finance/sulfas` | `TreasurySulfaController::store` | **None** | Creates sulfa (borrow) → treasury IN |
| POST | `finance/sulfas/{id}/repay` | `TreasurySulfaController::repay` | **None** | Records repayment → treasury OUT |
| POST | `profit-distributions/{id}/mark-paid` | `ProfitDistributionController::markPaid` | **None** | Marks profit distribution as paid |
| POST | `suppliers/{id}/pay` | `SupplierController::pay` | **None** | Direct balance reduction |

### 2.5 Settlement / Reconciliation

| HTTP | Path | Controller::method | Policy/Gate beyond `auth` | Risk |
|---|---|---|---|---|
| POST | `settlements/import` | `SettlementController::import` | **None** | Imports Amazon settlement → auto-reconciles + creates receipt |
| POST | `settlements/{id}/reconcile` | `SettlementController::reconcile` | **None** | Re-reconciles settlement → updates order financial statuses |
| DELETE | `settlements/{id}` | `SettlementController::destroy` | **None** | Deletes settlement + linked receipt + recomputes order statuses |

### 2.6 Product / SKU / Bulk Destructive

| HTTP | Path | Controller::method | Policy/Gate beyond `auth` | Risk |
|---|---|---|---|---|
| POST | `master-products/bulk-delete` | `MasterProductController::bulkDelete` | **None** | Bulk-deletes master products |
| DELETE | `master-products/{id}` | `MasterProductController::destroy` | **None** | Deletes single master product |
| POST | `admin/regenerate-master-products` | `MasterProductController::regenerateFromOrphans` | **None** | **Accepts `user_id` parameter — IDOR** |
| POST | `transfers/execute` | `TransferController::executeBulkTransfer` | **None** | Bulk stock transfers (dead code — references non-existent models) |

### 2.7 Admin-only Routes (super.admin middleware)

| HTTP | Path | Controller::method | Middleware |
|---|---|---|---|
| GET | `admin/overview` | `AdminDashboardController::overview` | `super.admin` |
| GET | `admin/subscriptions` | `AdminSubscriptionController::index` | `super.admin` |
| GET | `admin/error-log` | `AdminErrorLogController::index` | `super.admin` |

### 2.8 Subscription (Self-service)

| HTTP | Path | Controller::method | Risk |
|---|---|---|---|
| POST | `subscription/upgrade` | `SubscriptionController::upgrade` | Triggers Paymob checkout |
| POST | `subscription/cancel` | `SubscriptionController::cancel` | Cancels subscription |

---

## 3. IDOR Risk Assessment

### 3.1 Primary Defense: Global Scopes

Most models use `IsIsolatedByUser`, which auto-scopes every query with `WHERE user_id = Auth::id()`. This means `Model::findOrFail($id)` will return 404 if the record belongs to a different tenant — **effective IDOR prevention for these models**.

### 3.2 IDOR Vulnerabilities Found

#### F1 — `ProfitDistribution` has NO tenant isolation (HIGH)

**File:** `app/Domain/Models/Wms/ProfitDistribution.php:8`

```php
class ProfitDistribution extends Model
{
    // NO use IsIsolatedByUser;
```

`ProfitDistributionController` calls `ProfitDistribution::findOrFail($id)` — any authenticated user can view, update, or mark-as-paid any tenant's profit distribution by guessing IDs.

#### F2 — `regenerateFromOrphans` accepts arbitrary `user_id` (HIGH)

**File:** `app/Presentation/Http/Controllers/Api/MasterProductController.php:733`

```php
$userId = $request->user_id ?? auth()->id();
```

Any authenticated user can pass `user_id=<victim_id>` to create master products and link orphan SKUs in another tenant's namespace. Route `POST admin/regenerate-master-products` has no `super.admin` middleware despite the `admin/` prefix.

#### F3 — `CheckSubscriptionLimit` counts across all tenants (MEDIUM)

**File:** `app/Http/Middleware/CheckSubscriptionLimit.php:49`

```php
$current = $modelClass::count();
```

Although `IsIsolatedByUser` global scope should restrict this to the current user's rows, the middleware does not explicitly filter by `user_id`. If the scope is ever bypassed (e.g., middleware ordering, console context edge cases), the count would be global.

#### F4 — Settlement import `withoutGlobalScopes` tenant adoption (LOW)

**File:** `app/Presentation/Http/Controllers/Api/SettlementController.php:310-314`

```php
$settlement = Settlement::withoutGlobalScopes()->find($settlementId);
if ($settlement && empty($settlement->user_id)) {
    $settlement->user_id = Auth::id();
```

A tenant can "claim" orphan settlements (null `user_id`) created by settlement imports before they were assigned. The settlement must have been imported in the same request, so the window is narrow, but the pattern is fragile.

#### F5 — `MasterProductController::show()` orphan adoption (LOW)

**File:** `app/Presentation/Http/Controllers/Api/MasterProductController.php:491-499`

```php
$product = MasterProduct::withoutGlobalScope('user_isolation')...->find($id);
if ($product) {
    if ($product->user_id === null) {
        $product->update(['user_id' => auth()->id()]);
    } elseif ($product->user_id != auth()->id()) {
        abort(404);
    }
}
```

Properly aborts 404 for other tenants' products. The orphan-claiming logic is intentional (migration from monolith where `user_id` was nullable). Risk is that the first authenticated user to request a product "wins" it.

### 3.3 `withoutGlobalScopes` Usage (Cross-tenant access points)

| File | Usage | Risk |
|---|---|---|
| `MasterProductController.php:209-278` | Orphan adoption — assigns null `user_id` rows to current user | Low (intentional migration aid) |
| `MasterProductController.php:491` | Show product — checks `user_id` before returning | Low (properly guarded) |
| `SettlementController.php:310` | Settlement import — adopts orphan settlements | Low (narrow window) |
| `SettlementController.php:662-668` | Settlement delete — cleans up cross-scope receipts/items | Low (cleanup of own settlement's children) |
| `FinanceAccountLedgerService.php` | Various ledger queries | Needs review |
| `DashboardMetricsService.php` | Metrics aggregation | Needs review |
| `MarketplaceImportService.php` | Import idempotency checks | Needs review |
| `TreasurySpendGuard.php` | Balance calculations | Needs review |
| `PurchaseBatch.php` | Static method context | Needs review |
| `DraftMasterProduct.php` | Draft processing | Needs review |
| `CustomerController.php` | Customer queries | Needs review |
| `CashFlowSummaryController.php` | Cash flow aggregation | Needs review |
| `InventoryTransactionController.php` | Transfer logic | Needs review |

---

## 4. CSRF / Webhook / File Upload

### 4.1 CSRF Exceptions

**File:** `bootstrap/app.php:32-34`

```php
$middleware->validateCsrfTokens(except: [
    'webhooks/paymob',
]);
```

Only `webhooks/paymob` is exempted. This is correct — the Paymob webhook is verified by HMAC instead.

### 4.2 Paymob Webhook HMAC Verification

**File:** `app/Presentation/Http/Controllers/Api/PaymobWebhookController.php:78-98`

- Uses `hash_hmac('sha512', ...)` with `config('services.paymob.hmac_secret')`.
- Uses `hash_equals()` for timing-safe comparison. ✓
- Returns `false` if secret is empty or HMAC is empty (fail-closed). ✓
- Field order is hardcoded in `HMAC_FIELDS` constant — must match Paymob's documented order.

**Assessment:** Well-implemented. The docblock correctly warns about field-order sensitivity.

### 4.3 File Upload Validation

| Endpoint | Validation | Max Size | Assessment |
|---|---|---|---|
| Marketplace import | `mimes:csv,txt,xlsx,xls` | Default (2MB) | OK |
| Purchase smart-import | `mimes:pdf,jpg,jpeg,png,xlsx,xls\|max:20480` | 20MB | OK |
| Supplier bulk upload | `mimes:xlsx,xls,csv\|max:10240` | 10MB | OK |
| Transfer bulk upload | `mimes:xlsx,xls,csv\|max:10240` | 10MB | OK |
| Barcode scan-image | Needs review | — | Uses file for Gemini OCR |
| Channel SKU import | Needs review | — | — |

No file type / content sniffing beyond MIME extension check. PHP's `mimes` rule checks the file extension, not magic bytes — a renamed executable could pass. **MEDIUM risk** for the image upload paths that feed into Gemini (PDF/JPG/PNG).

---

## 5. Secrets

### 5.1 `.env.example` Patterns (no real secrets)

| Key | Default | Used by |
|---|---|---|
| `APP_KEY` | (empty) | Laravel encryption |
| `DB_PASSWORD` | `password` | PostgreSQL |
| `PAYMOB_SECRET_KEY` | (empty) | `PaymobCheckoutClient` |
| `PAYMOB_PUBLIC_KEY` | (empty) | `PaymobCheckoutClient` |
| `PAYMOB_HMAC_SECRET` | (empty) | `PaymobWebhookController` |
| `GEMINI_API_KEY` | (empty) | `GeminiService`, `PurchaseImportService`, `BarcodeReturnController` |
| `MONOLITH_WEBHOOK_SECRET` | (empty) | `MonolithCrmWebhookClient` |
| `REVERB_APP_SECRET` | (empty) | Reverb WebSocket |

All secrets are read from `config()` / `env()`. No hardcoded production secrets found in `app/`.

### 5.2 API Key in URL Query String (MEDIUM)

**Files:**
- `app/Infrastructure/External/GeminiService.php:76` — `"...?alt=sse&key={$apiKey}"`
- `app/Application/Services/PurchaseImportService.php:1315` — `"...?key=".$apiKey`
- `app/Presentation/Http/Controllers/Api/BarcodeReturnController.php:309` — `"...?key=".$apiKey`

The Gemini API key is passed as a URL query parameter in all three locations. URL query strings are logged in:
- Web server access logs (nginx/Apache)
- Application debug logs (if URL is logged)
- Browser history (if client-side, not applicable here)
- Proxy logs

Google's own client libraries send the key via header (`x-goog-api-key`), not URL. This is a **credentials leak vector**.

### 5.3 Trusted Proxies

**File:** `.env.example:15`

```
TRUSTED_PROXIES=*
```

Default is `*` (trust all proxies). In production behind a known reverse proxy (Cloudflare, nginx), this should be restricted to the actual proxy IP(s) to prevent IP spoofing via `X-Forwarded-For`.

---

## 6. Top 8 Security Findings

### F1 — `ProfitDistribution` model lacks tenant isolation
**Severity: HIGH**

| Detail | Value |
|---|---|
| Model | `app/Domain/Models/Wms/ProfitDistribution.php` |
| Controller | `app/Presentation/Http/Controllers/Api/ProfitDistributionController.php` |
| Impact | Any authenticated user can read/update/mark-paid any tenant's profit distributions |
| Root cause | Model does not `use IsIsolatedByUser` |
| Fix | Add `use IsIsolatedByUser;` to `ProfitDistribution`. Ensure `user_id` column exists in the table. Add `user_id` to `$fillable`. |

---

### F2 — Admin regenerate endpoint accepts arbitrary `user_id` (IDOR)
**Severity: HIGH**

| Detail | Value |
|---|---|
| Route | `POST api/inventory/admin/regenerate-master-products` |
| File | `app/Presentation/Http/Controllers/Api/MasterProductController.php:733` |
| Impact | Any authenticated user can create master products in another tenant's namespace |
| Root cause | `$request->user_id ?? auth()->id()` — no `super.admin` middleware on this route |
| Fix | (a) Add `->middleware('super.admin')` to the route, OR (b) remove `$request->user_id` and always use `auth()->id()` |

---

### F3 — Zero formal Policies — no per-action authorization
**Severity: HIGH**

| Detail | Value |
|---|---|
| Evidence | `Glob('**/Policies/*.php')` returns 0 files |
| Impact | All 60+ destructive endpoints rely solely on `auth` + global scope. No role-based authorization for approve vs create vs delete. Any user in a tenant can approve withdrawals, delete settlements, cancel orders, etc. |
| Root cause | Authorization was never implemented beyond tenant isolation |
| Fix | Create Policies under `app/Domain/Policies/` or `app/Application/Policies/`. Priority: `WithdrawalPolicy` (approve/complete), `PurchaseBatchPolicy` (approve/receive/cancel), `SettlementPolicy` (delete/reconcile), `PaymentPolicy` (status transitions). Register via `AuthServiceProvider` or `Gate::policy()`. |

---

### F4 — Gemini API key leaked in URL query strings
**Severity: MEDIUM**

| Detail | Value |
|---|---|
| Files | `GeminiService.php:76`, `PurchaseImportService.php:1315`, `BarcodeReturnController.php:309` |
| Impact | API key appears in nginx access logs, potentially in error logs/APM traces |
| Root cause | Using Google's REST endpoint with `?key=` instead of header-based auth |
| Fix | Use `x-goog-api-key` HTTP header instead: `Http::withHeaders(['x-goog-api-key' => $apiKey])->post($urlWithoutKey, ...)` |

---

### F5 — Expense and Receipt deletion has no status/guard check
**Severity: MEDIUM**

| Detail | Value |
|---|---|
| Endpoints | `DELETE expenses/{id}`, `DELETE receipts/{id}` |
| Files | `ExpenseController.php:157-163`, `ReceiptController.php:161-167` |
| Impact | Deleting a receipt/expense that was auto-created by settlement import or sulfa repayment leaves orphan ledger entries, breaks treasury balance consistency |
| Root cause | No check for `reference_type` (auto-created records should be immutable or cascade-delete) |
| Fix | Block deletion of records with `reference_type IS NOT NULL` (auto-linked to settlements, sulfas, purchase returns). Or add a `TreasuryLedgerGuard` that validates cascade consistency before delete. |

---

### F6 — `TRUSTED_PROXIES=*` default allows IP spoofing
**Severity: MEDIUM**

| Detail | Value |
|---|---|
| File | `.env.example:15`, `bootstrap/app.php:20-25` |
| Impact | Attacker can spoof client IP via `X-Forwarded-For` header, bypassing IP-based rate limiting or logging |
| Root cause | Wildcard default for development convenience, not narrowed for production |
| Fix | Set `TRUSTED_PROXIES` to actual reverse proxy IPs (e.g., Cloudflare ranges or `127.0.0.1` for local nginx) |

---

### F7 — File upload MIME validation uses extension only, not magic bytes
**Severity: MEDIUM**

| Detail | Value |
|---|---|
| Endpoints | Purchase smart-import upload (`mimes:pdf,jpg,jpeg,png,xlsx,xls\|max:20480`) |
| Files | `PurchaseImportController.php:227` |
| Impact | A renamed executable/polyglot file could pass validation. The file content is then sent to Gemini for OCR or processed by PhpSpreadsheet, which could trigger vulnerabilities in parsers |
| Root cause | Laravel's `mimes` rule checks extension mapping, not file magic bytes |
| Fix | Add content-type validation or use a package like `file-type` to verify magic bytes. For images, validate with `image` rule or `getimagesize()`. For PDFs, check `%PDF` magic bytes. |

---

### F8 — `TransferController` references non-existent models (dead code)
**Severity: LOW**

| Detail | Value |
|---|---|
| File | `app/Presentation/Http/Controllers/Api/TransferController.php` |
| Evidence | Imports `App\Domain\Models\Wms\Inventory`, `App\Domain\Models\Wms\Product` — these classes do not exist |
| Impact | `executeBulkTransfer` would 500 if called. `bulkUpload` would 500 on SKU lookup. No functional damage since it would fail before any DB writes. |
| Root cause | Legacy controller from monolith migration, never updated to new model names |
| Fix | Either remove the controller and its routes, or rewrite to use `SkuInventory`/`MasterProduct`/`InventoryLocation`. The transfer functionality is already implemented properly in `InventoryTransactionController::transfer/transferBatch`. |

---

## 7. Summary of Authorization Posture

| Aspect | Status |
|---|---|
| Authentication | ✓ Sanctum session + CSRF on all mutating routes |
| Tenant isolation | ✓ Strong — `IsIsolatedByUser` on 31+ models, except `ProfitDistribution` |
| CSRF protection | ✓ Active, with correct Paymob HMAC exception |
| Webhook verification | ✓ HMAC SHA-512, timing-safe, fail-closed |
| Per-action authorization (Policies) | ✗ **Missing entirely** — any tenant user can perform any action |
| Role-based access control | ✗ Only super-admin vs regular user; no roles within a tenant |
| Rate limiting | ✗ No API rate limiting observed on destructive endpoints |
| Audit trail | Partial — `InventoryTransaction` logs stock changes, but no generic audit log for financial actions |

---

## 8. Recommended Priority Actions

1. **Immediate:** Add `IsIsolatedByUser` to `ProfitDistribution` model and backfill `user_id`.
2. **Immediate:** Fix the `regenerateFromOrphans` IDOR — either gate it behind `super.admin` or remove `$request->user_id`.
3. **Short-term:** Create `WithdrawalPolicy`, `PurchaseBatchPolicy`, `SettlementPolicy`, `PaymentPolicy` — at minimum gate approve/complete/delete actions.
4. **Short-term:** Move Gemini API key from URL query string to `x-goog-api-key` header.
5. **Short-term:** Add deletion guards for auto-created receipts/expenses (those with `reference_type`).
6. **Medium-term:** Narrow `TRUSTED_PROXIES` in production `.env`.
7. **Medium-term:** Add file content validation (magic bytes) for upload endpoints.
8. **Cleanup:** Remove or rewrite `TransferController` dead code.
