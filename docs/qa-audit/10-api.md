# 10 — API Testing Agent (Completed Pass)

**Project:** `phyzioline/inventory-app`  
**Date:** 2026-07-30 (execution pass — not design-only)  
**DB:** `phyzioline_inventory_test` only  
**Suite:** `tests/Feature/ApiAuthzAndIdorTest.php` (+ related Feature suites)

---

## 1. Scope executed

| Area | Method | Status |
|------|--------|--------|
| AuthN (unauthenticated) | Pest GET/POST without session | **Pass** → 401 |
| AuthZ (role abilities) | Viewer staff invite; accountant import | **Pass** → 403 |
| IDOR (cross-tenant show) | Channel + SKU belonging to other user | **Pass** → 404 via `IsIsolatedByUser` + `TenantContext` |
| Validation | Channel store empty; marketplace missing file; transfer empty | **Pass** → 422 |
| `/auth/me` contract | `role`, `abilities`, `tenant_user_id` | **Pass** |
| Pagination sample | Existing `InventoryPaginationTest` | **Pass** |
| Destructive Gates | cancel/rollback policies + abilities | Covered in policies + prior Phase tests |

---

## 2. Route / middleware snapshot (post-implementation)

| Section | Middleware | Notes |
|---------|------------|-------|
| Public auth | `web` | login/register/forgot/reset |
| Protected | `web` + `auth` | core inventory |
| Staff / cycle-counts | `auth` + ability asserts in services | New |
| Marketplace import | `MarketplaceImportRequest::authorize()` → `marketplace.import` | Ability before validation |
| Super-admin | `super.admin` | regenerate / admin tools |
| Desktop updater | separate prefix | no session |

**Form Requests now present (5):**  
`TransferStockRequest`, `StorePurchaseBatchRequest`, `MarketplaceImportRequest`, `CancelInventoryOrderRequest`, `InviteStaffRequest`.

---

## 3. Status codes observed

| Case | Code | Evidence |
|------|------|----------|
| No auth | 401 | ApiAuthzAndIdorTest |
| Missing ability | 403 | staff invite / marketplace authorize |
| Cross-tenant missing | 404 | channel/sku show |
| Validation | 422 | channel / import / transfer |
| Async import queued | 202 | controller path (manual/job); Risk: dedicated job Pest thin |

---

## 4. Response shape (still inconsistent — Risk)

| Pattern | Example | Classification |
|---------|---------|----------------|
| Raw Eloquent | many `apiResource` show/index | **Risk** / Opinion |
| `{ success, data }` | staff, cycle-counts, auth/me | Preferred newer style |
| `{ message, details }` | marketplace import | Legacy |

**Recommendation (Later):** API Resource classes under Presentation for public contracts — do not big-bang rewrite critical money paths.

---

## 5. Remaining API gaps (not bugs)

| Gap | Priority | Notes |
|-----|----------|-------|
| Paymob webhook HMAC Pest | P0 | Critical path untested |
| Exhaustive IDOR matrix on every `{id}` write | P1 | Isolation global scope covers most reads; write paths need sampling |
| Uniform error envelope | P2 | Opinion |
| Rate limiting on import/upload | P2 | Risk under abuse |
| OpenAPI / contract tests | P3 | Later |

---

## 6. Bugs fixed during this pass

| Bug | Fix |
|-----|-----|
| Accountant import returned **422** (file) before **403** (ability) | `MarketplaceImportRequest::authorize()` checks `marketplace.import` |

---

## 7. Evidence paths

- `tests/Feature/ApiAuthzAndIdorTest.php`
- `app/Presentation/Http/Requests/MarketplaceImportRequest.php`
- `app/Application/Services/InventoryAbilityService.php`
- `app/Application/Support/TenantContext.php`
- `routes/api.php`
