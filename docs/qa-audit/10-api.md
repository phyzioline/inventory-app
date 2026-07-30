# 10 — API Design & Conventions Audit

**Project:** `phyzioline/inventory-app`  
**Path:** `/home/phyzioline-inventory/htdocs/inventory.phyzioline.com`  
**Date:** 2026-07-30  
**Scope:** Read-only analysis — no code changes applied.

---

## 1. Route Structure

All API routes live in `routes/api.php` under the prefix `/api/inventory` with `web` middleware (session-based auth).

| Section | Route Count (approx) | Middleware |
|---------|---------------------|------------|
| Public auth | 5 (login, logout, register, forgot/reset password) | `web` only |
| Public utility | 1 (`image-proxy`) | `web` only |
| Protected core | ~120+ endpoints | `web` + `auth` |
| Super-admin | 3 (overview, subscriptions, error-log) | `web` + `auth` + `super.admin` |
| Desktop updater | 2 (`/api/v1/inventory/desktop/...`) | None |

---

## 2. Authentication & Authorization

- **Auth mechanism:** Session-based (`web` middleware group + `auth` middleware). No token/Bearer auth for the SPA — the React app uses same-origin cookies.
- **Authorization beyond `auth`:** Minimal. Only two middleware layers observed:
  - `check.subscription.limit:{resource}` — applied to `POST channels` and `POST warehouses`.
  - `super.admin` — applied to the admin prefix.
- **No per-resource authorization (Policies/Gates):** Controllers do not check ownership on show/update/destroy (cross-reference: Security report findings on IDOR).
- **`Gate::before` super-admin bypass** exists in `AppServiceProvider` (mentioned in project rules) — super-admins skip all Gates.

---

## 3. Validation: Inline Only — No Form Requests

| Evidence | Detail |
|----------|--------|
| Form Requests in `app/Presentation/` | **0 files** — grep for `FormRequest` returns no matches |
| Validation pattern | All controllers use `$request->validate([...])` inline |

**Sample controllers and their inline validation:**

| Controller | Method | Validation Style |
|---|---|---|
| `SkuController::store()` | `$request->validate([...])` (line 260) | 8 rules inline |
| `InventoryTransactionController::transfer()` | `$request->validate([...])` (line 749) | 6 rules inline |
| `QuotationController::store()` | `$request->validate([...])` (line 49) | 11 rules inline |
| `ReceiptController::store()` | `$request->validate([...])` (line 55) | 14 rules inline |
| `MarketplaceOrderController::import()` | `$request->validate([...])` (line 39) | 3 rules inline |

**Impact:**
- Validation logic is not reusable across endpoints that share the same payload shape.
- Authorization rules that belong in Form Request `authorize()` are completely absent.
- Testing validation requires full controller integration tests (no unit-testable request class).

---

## 4. Response Shapes: Inconsistent

### 4.1 Raw Eloquent `toArray()` (most common)

```php
// SkuController::show()
return response()->json(Sku::with([...])->findOrFail($id));

// QuotationController::index()
return response()->json(Quotation::with(...)->get());
```

The response shape is whatever Eloquent serializes — including `created_at`, `updated_at`, relation nesting, and nullable fields that may or may not be present depending on eager-loading.

### 4.2 Ad-hoc Arrays

```php
// InventoryTransactionController::skuTracker()
return response()->json([
    'sku_ids_resolved' => $skuIds,
    'movements' => $movements,
    'current_balances' => $currentBalances,
    'total_count' => $totalCount,
    'truncated' => $totalCount > $limit,
]);
```

### 4.3 Mixed Paginated Wrappers

Some endpoints wrap in Laravel's default paginator shape (`data`, `links`, `meta`):
```php
// SettlementController::index()
$settlements = $query->paginate($perPage);
return response()->json($settlements);
```

Others build a custom wrapper:
```php
// SkuController::index() / InventoryOrderController::index()
return response()->json([
    'data' => $skus->values()->all(),
    'current_page' => $paginator->currentPage(),
    'last_page' => $paginator->lastPage(),
    'per_page' => $paginator->perPage(),
    'total' => $paginator->total(),
]);
```

### 4.4 No JsonResource Layer

**0 API Resource classes** exist in the project. Every response is either raw model serialization or a hand-built array. This means:
- No contract enforcement — frontend receives whatever the model exposes.
- Internal columns (e.g., `user_id`, `created_at`) leak unconditionally.
- Changing a model column name is a breaking API change with no adapter layer.

---

## 5. Status Codes & Error Format Inconsistency

| Pattern | Example | Issue |
|---------|---------|-------|
| Validation error (Laravel default) | 422 + `{message, errors: {...}}` | Consistent (via `$request->validate()`) |
| Business rule rejection | 422 + `{message: "..."}` | No `errors` key — different shape from validation |
| Caught exception | 500 + `{error: $e->getMessage()}` | Raw exception message exposed to client |
| Success with message | 200/201 + `{message: "...", ...data}` | Shape varies per endpoint |
| Delete success | 204 + `null` | Consistent |
| Not found (Eloquent) | 404 + `{message: "No query results..."}` | Laravel default — exposes model class name |

**Key inconsistencies:**
- Error key is sometimes `message`, sometimes `error`, sometimes both.
- `InventoryTransactionController::store()` line 740: `return response()->json(['error' => $e->getMessage()], 500)` — leaks internal exception text.
- `InventoryTransactionController::transfer()` line 920: same pattern — catches `\Exception` and returns raw message.

---

## 6. Pagination & Filtering: Sample Analysis

| Endpoint | Pagination | Filtering | Issues |
|---|---|---|---|
| `GET /orders` | Optional (`paginate=true` or `page>0`) | channel, order_id (search), date range | Falls back to unbounded `->get()` if no paginate flag |
| `GET /skus` | Optional (`paginate=true`) | channel_id, offer_id, linked, search | Falls back to unbounded `->get()` |
| `GET /transactions` | Optional (`paginate=true`) | sku_id, location_id, type | Falls back to unbounded `->get()` |
| `GET /quotations` | **None** | **None** | Always returns all rows |
| `GET /settlements` | Always paginated | channel_id, channel_ids[], search | Good |
| `GET /receipts` | Always paginated | search, warehouse_id, date range | Good |

**Filtering anti-patterns:**
- `$request->has('search')` does not check for empty string — `?search=` triggers a `WHERE ... LIKE '%%'` scan.
- No sorting parameter exposed on most endpoints (hardcoded `orderBy`).

---

## 7. Upload Endpoint Risks

| Endpoint | Controller | Accepted Types | Size Limit | Virus Scan |
|---|---|---|---|---|
| `POST /marketplace/import` | `MarketplaceOrderController::import()` | `csv,txt,xlsx,xls` | PHP default (server `upload_max_filesize`) | None |
| `POST /settlements/import` | `SettlementController::import()` | Delegated to service; accepts XML/TXT/CSV | PHP default | None |
| `POST /purchases/smart-import/upload` | `PurchaseImportController::upload()` | Stored to local disk (`purchase-uploads/`) | PHP default | None |
| `POST /barcode/scan-image` | `BarcodeReturnController::scanImage()` | Image (likely sent to external API) | PHP default | None |
| `POST /channels/{id}/import/upload` | `ChannelSkuImportController::upload()` | Spreadsheet | PHP default | None |
| `POST /adjustments/import` | `InventoryAdjustmentImportController::import()` | Spreadsheet | PHP default | None |

**Risks:**
- No explicit `max:` file size in validation rules visible in controllers.
- Files stored to local disk (`storage/app/purchase-uploads/`) without cleanup schedule.
- PhpSpreadsheet parsing of user-uploaded XLSX is a known memory/CPU amplification vector (zip bombs, formula injection).
- No server-side content-type verification beyond extension (MIME sniffing bypass possible).

---

## 8. Critical Money/Stock Endpoint Scorecard

| Endpoint | Auth | Tenant Scope | Idempotency | Validation | Transaction | Score |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| `POST /marketplace/import` | ✅ | ✅ (user_id) | ✅ (uq index + hasPrior check) | ⚠️ (minimal) | ✅ | 4/5 |
| `POST /transactions/transfer` | ✅ | ⚠️ (no user_id filter on SKU ownership) | ✅ (client_transfer_id) | ✅ | ✅ (locked rows) | 4/5 |
| `POST /transactions/transfer-batch` | ✅ | ⚠️ | ✅ (client_transfer_id per item) | ✅ | ✅ | 4/5 |
| `POST /receipts` | ✅ | ✅ (finance_account user check) | ❌ (no dedup key) | ✅ (14 rules) | ⚠️ (no explicit DB::transaction) | 2.5/5 |
| `POST /payments` | ✅ | ⚠️ | ❌ | ✅ | ⚠️ | 2/5 |
| `POST /profit-distributions` | ✅ | ❌ (no tenant filter) | ❌ | ⚠️ (3 rules only) | ❌ | 1/5 |
| `POST /orders/{id}/financial-edit` | ✅ | ⚠️ | ❌ | Delegated to service | ✅ | 3/5 |
| `POST /withdrawals/{id}/approve` | ✅ | ❌ (findOrFail without user scope) | ❌ | ❌ (no validation) | ⚠️ | 1/5 |

Legend: ✅ = good, ⚠️ = partial/missing checks, ❌ = absent

---

## 9. Proposed API Conventions

The following conventions would standardize the API surface for both internal SPA consumption and future external integrations:

### 9.1 Response Envelope

```json
{
  "data": { ... },           // Single resource or array
  "meta": {                  // Pagination (when applicable)
    "current_page": 1,
    "last_page": 10,
    "per_page": 50,
    "total": 487
  },
  "message": "Success"      // Optional human-readable message
}
```

### 9.2 Error Envelope

```json
{
  "message": "Validation failed",
  "errors": {               // Field-level errors (422)
    "amount": ["The amount field is required."]
  },
  "code": "INSUFFICIENT_STOCK"  // Machine-readable error code
}
```

### 9.3 Standard Conventions

| Concern | Convention |
|---------|-----------|
| **Pagination** | Always paginate list endpoints. Default 50, max 200. Client must send `page` param. |
| **Filtering** | Accept `filter[field]` query params. Validate & whitelist allowed filter fields. |
| **Sorting** | Accept `sort=field` / `sort=-field` (descending). Default per endpoint. |
| **Validation** | Extract to Form Request classes. One request class per action (Store/Update). |
| **Resources** | Introduce `JsonResource` classes for all public-facing responses. Never expose raw Eloquent. |
| **Status codes** | 200 (ok), 201 (created), 204 (deleted), 400 (bad request), 401 (unauthed), 403 (forbidden), 404 (not found), 422 (validation/business rule), 500 (server error). |
| **Idempotency** | All POST endpoints that create resources or mutate money/stock must accept an `Idempotency-Key` header. |
| **Versioning** | Prefix `/api/v2/inventory/...` for new conventions; keep `/api/inventory/...` as v1 legacy. |
| **Rate limiting** | Apply per-user throttle on import/upload endpoints (e.g., 5 requests/minute). |
