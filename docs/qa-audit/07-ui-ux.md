# UI/UX Review — Inventory App SPA

**Date:** 2026-07-30  
**Scope:** `resources/frontend/src/` (READ-ONLY inspection — no product code modified)  
**Auditor:** AI QA Agent  
**Status:** Complete

---

## Table of Contents

1. [Fat Pages — Line-Count Audit](#1-fat-pages--line-count-audit)
2. [Session Expiry — 401/419 Handling in `lib/api.ts`](#2-session-expiry--401419-handling-in-libapiuts)
3. [Upload timeout=0 Risks](#3-upload-timeout0-risks)
4. [Loading / Empty / Error State Inconsistencies](#4-loading--empty--error-state-inconsistencies)
5. [ComingSoon FBA/FBM Stubs](#5-comingsoon-fbafbm-stubs)
6. [AddSKUDialog — `wasOpenRef` Fix & Regression Guard](#6-addskudialog--wasopenref-fix--regression-guard)
7. [RTL / Arabic — `LanguageContext` Notes](#7-rtl--arabic--languagecontext-notes)
8. [Accessibility Quick Notes](#8-accessibility-quick-notes)
9. [Severity-Ranked Findings Table](#9-severity-ranked-findings-table)
10. [Page Scorecard](#10-page-scorecard)
11. [Recommended UX Fixes (No Code)](#11-recommended-ux-fixes-no-code)

---

## 1. Fat Pages — Line-Count Audit

All files inspected via `wc -l`. The threshold for "fat" is ≥ 1 000 lines for a page component.

### 1.1 Pages (`src/lib/pages/`)

| File | Lines | Notes |
|---|---|---|
| `ProfitEngine.tsx` | **2 338** | Single `export default function ProfitEngine()` from line 196. Contains 6 sub-view branches (`by-period`, `by-channel`, `by-sku`, `by-product`, `roi`, `capital-cycle`), ≈15 `useQuery` calls, complex memoised derivations, chart renders, platform-fee upload, and > 10 toolbar sections — all inline. |
| `MasterProducts.tsx` | **1 695** | Single component `const MasterProducts = () => {` (line 104). Owns pagination, search, filters, delete, restore, SKU management, and all table/modal orchestration inline. |
| `PurchaseInvoices.tsx` | **1 486** | Contains full in-page invoice detail panel (not a separate component), 6+ inline mutation handlers, and complex print/export logic. |
| `CapitalManagement.tsx` | **1 472** | Combines capital source list, cash-flow chart, KPI cards, and add/delete forms. At least 3 logical sections that could be split. |
| `Returns.tsx` | **1 408** | 3 tabs (Returns / Amazon Claims / Removals) with full table bodies, 5+ helper functions, import dialogs, and export logic — all in one file. |
| `Orders.tsx` | **1 315** | 8 helper functions before the default export; inline rollback, cancel, image-picker, and import orchestration. |
| `SmartPurchaseImport.tsx` | **1 279** | Two distinct UI states (file upload wizard, batch review) plus item editing forms — effectively two pages sharing one component. |
| `ChannelDetail.tsx` | **1 071** | Borderline; product list, SKU assignment, and channel metrics in one component. |

**Total SPA page lines: 31 698** across 44 page files — average 720 lines/page, median ≈ 600 lines. Seven pages are > 1 000 lines and need decomposition.

### 1.2 Large Dialog/Component Files

The page bloat pattern is replicated in several component dialogs:

| File | Lines |
|---|---|
| `PurchaseInvoiceDialog.tsx` | 1 456 |
| `FbaRequestTransferDialog.tsx` | 1 245 |
| `QuotationDialog.tsx` | 1 244 |
| `OrderImportDialog.tsx` | 1 217 |
| `TransferModal.tsx` | 1 178 |

These are dialogs, not pages — 1 000+ line dialogs are very difficult to maintain or test in isolation.

---

## 2. Session Expiry — 401/419 Handling in `lib/api.ts`

**File:** `src/lib/api.ts` lines 30–35

### 2.1 Current behaviour

```
error.response?.status === 401 || error.response?.status === 419
  → console.warn only
  → Promise.reject(error) (passes error to caller)
```

The HTML-body detector (lines 20–28) rejects with `new Error('Session expired - received HTML instead of JSON')` but also does **not** redirect.

**There is no global redirect-to-login on 401 or 419.**

### 2.2 What actually happens when a session expires mid-session

1. User is idle. Laravel session expires (default: 120 min).
2. User clicks an action (save, import, filter change).
3. Axios interceptor gets 401/419, logs the warning, re-rejects.
4. The calling component's `onError` / `catch` fires — usually a `toast.error()` with a generic API message (e.g. "Unauthenticated.", "CSRF token mismatch").
5. The user sees a red toast with a cryptic message but **remains on the authenticated page**. No re-login prompt is shown.
6. `AuthContext.refreshUser()` is only called at page-load; it sets `user = null` on failure, which would redirect via `ProtectedRoute` — but only if the component re-mounts. An idle user on a loaded page will not re-check.

### 2.3 HTML redirect detection gap

The HTML body check (line 24) only fires for **successful** (2xx) responses whose `Content-Type` is `text/html`. A Laravel 302 redirect to `/login` returns a **3xx**, which axios follows automatically — the resolved URL is `/login`'s HTML page. This response body detection catches that case. However, the rejection message `'Session expired - received HTML instead of JSON'` is raw and never shown as a user-facing notification.

### 2.4 Severity

**HIGH** — users doing long import/review workflows (Profit Engine, PurchaseInvoices) are the most affected. A 2-hour session silently expires mid-task, mutations fail with a cryptic message, and the user may attempt retries that all fail.

---

## 3. Upload `timeout=0` Risks

**Default in `api.upload()`:**

```typescript
// src/lib/api.ts line 87
timeout: config.timeoutMs ?? 0,  // 0 = no timeout in axios
```

Axios interprets `timeout: 0` as **"wait forever"**. The network request will never time out unless the OS/browser kills it.

### 3.1 Callers that pass an explicit timeout

Only two dialog files set `MARKETPLACE_IMPORT_UPLOAD_TIMEOUT_MS = 600_000` (10 minutes):

| File | Timeout |
|---|---|
| `MarketplaceOrderImportDialog.tsx` | 600 000 ms |
| `OrderImportDialog.tsx` | 600 000 ms |

### 3.2 Callers that receive `timeout = 0` (infinite hang)

| File | Endpoint | UX Impact |
|---|---|---|
| `RemovalImportDialog.tsx` | `/removals/import` | Spinner hangs forever on slow server |
| `ChannelSkuImportDialog.tsx` | `channels/{id}/import/upload` | Same |
| `FbaReturnsSheetDialog.tsx` | `/returns/import` | Same |
| `ReturnScannerDialog.tsx` (×2) | `/barcode/scan-image`, `/returns/import` | Barcode scan may hang on bad image |
| `InventoryLedgerSheetDialog.tsx` | `/returns/import-inventory-ledger` | Same |
| `Reconciliation.tsx` | `/settlements/import` | Same |
| `Returns.tsx` | `/returns/import` | Same |
| `SmartPurchaseImport.tsx` | `/purchases/smart-import/upload` | 20 MB cap, but no timeout |
| `ProfitEngine.tsx` | `/reports/platform-fees/import` | Same |
| `useAmazonSettlements.ts` | `/settlements/import` | Same |

### 3.3 Additional: raw `fetch()` calls (outside axios entirely)

Two dialogs bypass the axios client and use the native `fetch()` API with **no `signal` / `AbortController`** — meaning they also have no timeout, AND they do not send the axios-managed XSRF token:

| File | Endpoint | Issues |
|---|---|---|
| `BulkSupplierUploadDialog.tsx` | `/api/inventory/suppliers/bulk-upload` | No timeout, no axios interceptor |
| `BulkASINUploadDialog.tsx` | `/api/inventory/asins/bulk-upload` | Same |

Both manually add `X-Requested-With: XMLHttpRequest` but rely on session cookie without the double-submit CSRF token that axios manages automatically.

---

## 4. Loading / Empty / Error State Inconsistencies

A review of how each major page handles the three UI states: **loading** (data in flight), **empty** (zero results), and **error** (network/server failure).

### 4.1 State coverage by page

| Page | Loading | Empty | Error | Notes |
|---|---|---|---|---|
| `Reports.tsx` (778 lines) | ❌ None | ⚠️ Implicit (charts render with 0 data) | ❌ None | All 8 hook destructures discard `isLoading` and `isError`. Charts and tables simply mount empty and silently fill. Users cannot distinguish "loading" from "no data". |
| `ReturnAnalytics.tsx` (630 lines) | ⚠️ Partial | ⚠️ Partial (per-chart section only) | ❌ None | `returnsLoading` / `ordersLoading` are tracked but only render an inline `<p>Loading...</p>` within chart sections, not a full-page state. No `isError` used. |
| `ProfitEngine.tsx` (2 338 lines) | ✅ View-aware `isLoading` computed | ⚠️ Implicit | ❌ None | Good loading gate at line 1292; no error UI for query failures. |
| `Orders.tsx` (1 315 lines) | ✅ Full-page spinner | ✅ Empty-state message (line 947) | ✅ Error display (line 964) | Best-practice example in the codebase. |
| `Returns.tsx` (1 408 lines) | ✅ `returnsBootstrapping` guard | ✅ Conditional message | ⚠️ Toast only | No in-page error state UI; failures show toast and leave a blank list. |
| `MasterProducts.tsx` (1 695 lines) | ✅ `loadingProducts` with skeleton | ✅ Error + refresh button (line 1141) | ✅ `productsLoadError` shown | Good coverage. |
| `PurchaseInvoices.tsx` (1 486 lines) | ✅ Loading state (line 741) | ✅ Implicit via empty table | ⚠️ Toast only | Same pattern as Returns — no in-page error UI. |
| `CapitalManagement.tsx` (1 472 lines) | ✅ `loadingSources` + `financialSnapshotPending` | ✅ Source list empty state | ✅ Full error UI with retry button (line 748) | Best example of error UI with translated retry. |
| `SmartPurchaseImport.tsx` (1 279 lines) | ✅ `isLoading` gate (line 422) | ✅ Upload wizard empty state | ⚠️ Toast only | Hardcoded English errors (`'File too large. Max 20MB.'`, `'Upload failed'`) not going through `t()`. |

### 4.2 `Reports.tsx` — critical detail

All 8 data hooks are called with default-value destructuring only:

```tsx
// lines 83–93 — isLoading, isError NEVER captured
const { data: warehouses = [] } = useWarehouses();
const { data: suppliers = [] } = useSuppliers();
const { data: products = [] } = useProducts();
// ... etc.
```

When the API is slow or fails, the page renders immediately with empty arrays. A user opening the Reports page sees blank charts and empty tables with no indication of whether data is still loading or failed to load. This is the most visible page for management-level users.

---

## 5. ComingSoon FBA/FBM Stubs

### 5.1 Affected files

| File | Route | Content |
|---|---|---|
| `src/lib/pages/AmazonFBA.tsx` | `/channels/amazon/fba` | 5 lines: `<ComingSoon title="Amazon FBA Inventory" />` |
| `src/lib/pages/AmazonFBM.tsx` | `/channels/amazon/fbm` | 5 lines: `<ComingSoon title="Amazon FBM Inventory" />` |

### 5.2 ComingSoon component issues (`ComingSoon.tsx`, 41 lines)

1. **Hardcoded English body text** — "This module is under development. We're working hard to bring you this feature soon." — not translated, despite `useLanguage()` being imported and `t` being called. The body text bypasses `t()` entirely.
2. **"Back to Dashboard" button** — hardcoded English string, not translated.
3. **"Coming Soon" fallback** — `title || 'Coming Soon'` — the fallback is English-only.
4. **No user expectation setting** — no ETA hint, no "notify me" option, no description of what the feature will do. Users navigating to FBA/FBM from the sidebar get a dead end with zero context.
5. **These are live navigable routes** — the Channels sidebar presumably links to these. Users can reach them in production. The `Construction` icon + pulse animation is the only cue that nothing is there.

### 5.3 Other Amazon pages that exist but are not stubs

`AmazonImport.tsx`, `AmazonOrders.tsx`, and `AmazonPayments.tsx` appear to be real pages that are implemented but **entirely English-only** — no Arabic translation, no `isAr` handling, no `t()` calls. If the app is used in Arabic mode, these pages will appear in English while the rest of the UI is in Arabic.

---

## 6. AddSKUDialog — `wasOpenRef` Fix & Regression Guard

**File:** `src/components/inventory/AddSKUDialog.tsx` lines 47–65

### 6.1 The fix (currently in place)

```tsx
const wasOpenRef = useRef(false);

useEffect(() => {
    if (open && !wasOpenRef.current) {
        setFormData(buildFormFromProps(initialData, offerId, presetChannelId));
    }
    wasOpenRef.current = open;
}, [open, initialData, offerId, presetChannelId]);
```

**Intent:** Prevent the form from being re-seeded from `initialData` when the parent re-renders (e.g., background query refetch changes object reference) while the dialog is open and the user is actively typing. Correctly guards with `!wasOpenRef.current` — seeding only on the `false → true` transition.

### 6.2 Regression risks

1. **`initialData` dependency in the effect** — `initialData` is in the dependency array but is only used inside the `if (open && !wasOpenRef.current)` branch. If a future developer sees "why is `initialData` in deps but not used unconditionally?" and removes the guard logic while keeping the dependency, the original re-seed bug returns.
2. **No test coverage for this guard** — The form-reset scenario (parent-rerenders-while-dialog-is-open) has no automated test. A `useRef`-based fix is invisible to the type system and easy to accidentally break.
3. **`presetChannelId` in deps** — If `ChannelDetail` passes an inline `initialData={{ channel_id }}` AND the parent re-renders (same root cause), `presetChannelId` could also trigger re-seed if the `open && !wasOpenRef.current` condition is somehow met. Low risk currently, but worth noting.

### 6.3 Hardcoded English strings in the same dialog (mixed i18n)

Despite having `isAr` available, the following strings are hardcoded English and never translated:

| Element | Hardcoded string |
|---|---|
| Dialog title (create) | `'Add New SKU'` |
| Dialog title (edit) | `'Edit SKU'` |
| Cancel button | `'Cancel'` |
| Submit button (create) | `'Add SKU'` |
| Submit button (edit) | `'Save Changes'` |
| Checkbox label | `'Active SKU'` |
| SKU field label | `'SKU Code *'` |
| Marketplace ID label | `'Marketplace ID (ASIN/Product ID)'` |

The LanguageContext **does** have `'skus.addSku'`, `'skus.skuCode'`, `'common.cancel'`, `'settings.saveChanges'` keys available — they are not used here.

---

## 7. RTL / Arabic — `LanguageContext` Notes

**File:** `src/contexts/LanguageContext.tsx` — **2 983 lines**

### 7.1 Architecture

A custom flat key-value store (two massive objects: `en` at ~1 500 keys, `ar` at ~1 400 keys) with a `t(key)` lookup function. No external i18n library (`i18next`, `react-intl`, `lingui`) is used.

**Strengths:**
- `document.documentElement.dir` is set correctly on language change (line 2957).
- `dir` value is exposed via context and used in layout components (Sidebar, dialogs).
- Numbers shown in Arabic contexts use `dir="ltr"` overrides where appropriate (email fields, amounts, codes).
- RTL layout switching (sidebar position, chevron icon direction, arrow direction) is handled consistently via `dir === 'rtl'` checks.

### 7.2 Inconsistent localisation approach

Three different patterns co-exist across the codebase:

| Pattern | Example | Problem |
|---|---|---|
| `t('key')` via context | `t('common.loading')` | Correct — falls back to English key if missing |
| `isAr ? 'عربي' : 'English'` inline ternary | Most field labels | Bypasses the key-value store; creates duplication |
| Hardcoded English | `AddSKUDialog` title, `SmartPurchaseImport` error toasts, `ComingSoon` body | Missing Arabic entirely |

The `t('key') \|\| 'fallback'` pattern (e.g., `t('common.loading') \|\| 'Loading...'`) suggests translation keys may be missing and the fallback is an acknowledgment of that.

### 7.3 Size risk

At 2 983 lines, `LanguageContext.tsx` is the third-largest file in the project (behind `ProfitEngine.tsx` and `MasterProducts.tsx`). The entire translation dictionary is eagerly loaded in the JS bundle regardless of the active language, doubling the localisation footprint at runtime.

### 7.4 ErrorBoundary is English-only

`src/components/ErrorBoundary.tsx` renders "Something went wrong", "The application encountered an unexpected error.", "Try Again", and "Refresh Page" — all hardcoded English, no `t()` or `isAr`. This is the first thing a user sees after a crash.

---

## 8. Accessibility Quick Notes

**Metric:** Total `aria-label` / `role=` / `tabIndex` / `sr-only` occurrences:
- In all **page** files (`src/lib/pages/**`): **10** occurrences across 44 files
- In all **component** files (`src/components/**`): **37** occurrences

This is very low coverage for an application of this size.

### 8.1 What is handled correctly

- Dialog/modal focus trap and keyboard close: handled by **Radix UI** `Dialog`, `DropdownMenu`, `Select` primitives — safe.
- Action menus in `Orders.tsx` table rows have `aria-label={t('orders.actionsMenu')}` — one of the few explicit labels.
- `alt` attributes on image thumbnails (e.g., `OrderThumb`, `GroupProductThumbs`) — verified present.
- Error boundary renders an `<h1>` — screen readers will announce it as a landmark.

### 8.2 Known gaps

| Issue | Location | Impact |
|---|---|---|
| `<table>` headers lack `scope="col"` | Orders, Returns, PurchaseInvoices, Reports tables | Screen readers may not associate header with column |
| Status badges are colour-only for financial meaning | Profit Engine (green/red), Orders shortage badges | Low vision / colour-blind users cannot distinguish status without text |
| `GlobalFetchingIndicator` has no `aria-live` region | `AppLayout` | Screen readers don't announce background fetch activity |
| `ErrorBoundary.tsx` not translated | App-wide | Arabic users see English crash screen |
| `ComingSoon.tsx` has no `lang` or `aria-label` | FBA/FBM routes | Accessibility tree shows English text in Arabic document |
| Icon-only buttons (where they exist) | Various import dialogs | Need `aria-label` when no visible text accompanies the icon |
| Focus not restored to trigger on dialog close | Several dialogs | Keyboard users lose position after closing a modal |
| `<input type="checkbox">` in AddSKUDialog uses raw HTML `<input>`, not the design-system `Checkbox` | `AddSKUDialog.tsx` line 206 | Styling inconsistency; design system component may carry ARIA roles |

---

## 9. Severity-Ranked Findings Table

| # | Finding | Severity | Affected Pages / Files |
|---|---|---|---|
| F-01 | No global redirect on 401/419 — session expiry shows cryptic toast | **Critical** | All authenticated pages via `api.ts` |
| F-02 | `Reports.tsx` has zero loading/error UI — all 8 data hooks discard `isLoading` / `isError` | **High** | `Reports.tsx` |
| F-03 | 9 `api.upload()` callers + 2 raw `fetch()` callers have no timeout — infinite browser hang on slow server | **High** | `RemovalImportDialog`, `FbaReturnsSheetDialog`, `ReturnScannerDialog`, `InventoryLedgerSheetDialog`, `Reconciliation`, `Returns`, `SmartPurchaseImport`, `ProfitEngine`, `useAmazonSettlements`, `BulkSupplierUploadDialog`, `BulkASINUploadDialog` |
| F-04 | `ProfitEngine.tsx` (2 338 lines) has no error UI for any of its ~15 queries | **High** | `ProfitEngine.tsx` |
| F-05 | `AmazonFBA` / `AmazonFBM` are live navigable routes with no content or context | **Medium** | `AmazonFBA.tsx`, `AmazonFBM.tsx` |
| F-06 | `ComingSoon.tsx` body text and button hardcoded English — breaks Arabic mode | **Medium** | `ComingSoon.tsx` (affects FBA, FBM stubs) |
| F-07 | `ReturnAnalytics.tsx` — no `isError` handling; loading only shown in chart sections, not at page level | **Medium** | `ReturnAnalytics.tsx` |
| F-08 | `AddSKUDialog` dialog title, Cancel, Save/Add, Active SKU, SKU Code — hardcoded English in an otherwise Arabic-aware form | **Medium** | `AddSKUDialog.tsx` |
| F-09 | `wasOpenRef` guard in `AddSKUDialog` has no test coverage — silent regression risk | **Medium** | `AddSKUDialog.tsx` |
| F-10 | `BulkSupplierUploadDialog` / `BulkASINUploadDialog` use raw `fetch()` — miss axios interceptors, no CSRF token, no timeout | **Medium** | `BulkSupplierUploadDialog.tsx`, `BulkASINUploadDialog.tsx` |
| F-11 | `ErrorBoundary.tsx` is English-only — Arabic users see English crash screen | **Medium** | `ErrorBoundary.tsx` |
| F-12 | `AmazonImport`, `AmazonOrders`, `AmazonPayments` pages are entirely English-only (no `t()` / `isAr`) | **Medium** | `AmazonImport.tsx`, `AmazonOrders.tsx`, `AmazonPayments.tsx` |
| F-13 | `ProfitEngine.tsx` (2 338 lines) — single file, 6 sub-views, no extractable sub-components | **Low** (debt) | `ProfitEngine.tsx` |
| F-14 | `MasterProducts.tsx` (1 695 lines), `PurchaseInvoices.tsx` (1 486), `CapitalManagement.tsx` (1 472), `Returns.tsx` (1 408), `Orders.tsx` (1 315), `SmartPurchaseImport.tsx` (1 279) — all exceed 1 000 lines | **Low** (debt) | 6 page files |
| F-15 | `LanguageContext.tsx` (2 983 lines) — full bilingual dictionary always loaded regardless of active language | **Low** (debt) | `LanguageContext.tsx` |
| F-16 | Mixed i18n patterns (`t()` vs `isAr ?` ternary vs hardcoded) — no consistent approach | **Low** | Codebase-wide |
| F-17 | Table `<th>` elements lack `scope="col"` | **Low** (a11y) | Orders, Returns, Reports, PurchaseInvoices |
| F-18 | Status/profit badges colour-only (no text equivalent) for financial meaning | **Low** (a11y) | ProfitEngine, Orders |
| F-19 | `GlobalFetchingIndicator` has no `aria-live` region | **Low** (a11y) | `GlobalFetchingIndicator.tsx` |
| F-20 | Raw `<input type="checkbox">` in `AddSKUDialog` instead of design-system `Checkbox` component | **Low** | `AddSKUDialog.tsx` line 206 |

---

## 10. Page Scorecard

Scale: ✅ Good  ⚠️ Partial  ❌ Missing

| Page | Loading | Empty | Error | i18n | a11y | UX Polish |
|---|---|---|---|---|---|---|
| **Orders** | ✅ | ✅ | ✅ | ✅ | ⚠️ | ✅ |
| **CapitalManagement** | ✅ | ✅ | ✅ | ✅ | ⚠️ | ✅ |
| **MasterProducts** | ✅ | ✅ | ✅ | ✅ | ⚠️ | ✅ |
| **Returns** | ✅ | ✅ | ⚠️ | ✅ | ⚠️ | ✅ |
| **PurchaseInvoices** | ✅ | ✅ | ⚠️ | ✅ | ⚠️ | ✅ |
| **SmartPurchaseImport** | ✅ | ✅ | ⚠️ | ⚠️ | ⚠️ | ⚠️ |
| **ReturnAnalytics** | ⚠️ | ⚠️ | ❌ | ✅ | ⚠️ | ⚠️ |
| **ProfitEngine** | ✅ | ⚠️ | ❌ | ✅ | ⚠️ | ✅ |
| **Reports** | ❌ | ❌ | ❌ | ✅ | ⚠️ | ⚠️ |
| **AmazonFBA / FBM** | — | — | — | ❌ | ❌ | ❌ |
| **AmazonImport** | ✅ | ✅ | ⚠️ | ❌ | ⚠️ | ⚠️ |
| **AmazonOrders** | ✅ | ⚠️ | ❌ | ❌ | ⚠️ | ⚠️ |
| **AmazonPayments** | ✅ | ✅ | ❌ | ❌ | ⚠️ | ⚠️ |

---

## 11. Recommended UX Fixes (No Code)

Ordered by user impact.

### Priority 1 — Session & Authentication

**R-01: Global 401/419 redirect**  
In the axios response interceptor in `api.ts`, on 401 or 419, dispatch a custom event (or call a registered callback from `AuthContext`) that clears the user state and navigates to the login page. Include a user-facing toast before redirect: "Your session has expired — please log in again." Translate both into Arabic.

**R-02: Session timeout warning banner**  
Add an optional proactive warning (configurable in settings) that fires 5 minutes before session expiry with a "Stay signed in" button that pings `GET /api/inventory/auth/me` to extend the session.

### Priority 2 — Upload Timeouts

**R-03: Consistent upload timeout**  
Define a shared constant (e.g., `UPLOAD_TIMEOUT_MS = 300_000`) and pass it to every `api.upload()` call that currently omits `timeoutMs`. For the two raw `fetch()` callers (`BulkSupplierUploadDialog`, `BulkASINUploadDialog`), migrate to `api.upload()` so they benefit from the axios interceptors, CSRF handling, and timeout.

**R-04: Upload progress feedback**  
Upload dialogs that hang with only a spinner should show a textual hint after 10 seconds: "Still processing — large files may take up to a few minutes." This is UX-only; no progress bar is needed.

### Priority 3 — Reports Page Loading/Error States

**R-05: Add `isLoading` + `isError` capture to all `Reports.tsx` hooks**  
Destructure `isLoading` from each hook and aggregate them (e.g., `const isLoading = warehousesLoading || suppliersLoading || ...`). Show a single page-level loading spinner (matching the ProfitEngine pattern). On `isError`, show a retry button. This is the highest-priority UX fix for the Reports page.

**R-06: `ReturnAnalytics` page-level loading + error state**  
Promote the existing per-chart `loading` check to a full-page guard at the top of the render tree. Add `isError` destructuring and a retry UI.

### Priority 4 — ComingSoon / Stubs

**R-07: Translate `ComingSoon.tsx`**  
Pass body text and button label through `t()` with proper Arabic/English keys. Add a meaningful description of what each stub feature will do (e.g., "Amazon FBA Inventory — view real-time stock levels in Amazon's fulfilment centres").

**R-08: Anchor stubs to a roadmap**  
Link or reference a release milestone in the ComingSoon UI so users know whether to expect the feature "next sprint" or "next quarter". Even a static "Q3 2026" label removes ambiguity.

### Priority 5 — `AddSKUDialog` i18n & Test Guard

**R-09: Translate hardcoded strings in `AddSKUDialog`**  
Route `'Add New SKU'`, `'Edit SKU'`, `'Cancel'`, `'Save Changes'`, `'Active SKU'`, `'SKU Code *'`, and `'Marketplace ID (ASIN/Product ID)'` through `t()` or `isAr` ternaries using existing keys in `LanguageContext`.

**R-10: Add a regression test for `wasOpenRef` guard**  
Write a React Testing Library test that: (1) opens the dialog with `initialData`, (2) simulates user typing in a field, (3) triggers a parent re-render that changes `initialData` reference, (4) asserts the typed value was NOT overwritten.

### Priority 6 — LanguageContext Architecture

**R-11: Lazy-load language dictionaries**  
Split `LanguageContext.tsx` into `translations/en.ts` and `translations/ar.ts`. Load only the active language at runtime (dynamic import) and switch on language change. This halves the initial bundle translation weight.

**R-12: Standardise on `t()` — eliminate inline ternaries**  
Choose one pattern: `t('key')` is the canonical approach. Convert all `isAr ? '...' : '...'` inline ternaries to `t()` calls over time. This makes translation completeness auditable and removes duplication.

### Priority 7 — Accessibility

**R-13: Add `scope="col"` to all `<th>` elements**  
This is a one-line fix per table header and is required for WCAG 2.1 AA conformance.

**R-14: `GlobalFetchingIndicator` — add `aria-live="polite"`**  
Screen reader users should be informed when background data is being fetched.

**R-15: `ErrorBoundary.tsx` — translate text**  
Add `useLanguage()` is not available in a class component — pass a `lang` prop from the wrapping provider or use a static Arabic string for the body text as a fallback.

**R-16: Replace raw `<input type="checkbox">` in `AddSKUDialog`**  
Use the design-system `Checkbox` component (already used elsewhere in the codebase) for consistency and correct ARIA semantics.

---

*Report generated from static source inspection only. No runtime profiling, no browser automation. All findings are based on file reads of `resources/frontend/src/` at commit-date 2026-07-30.*
