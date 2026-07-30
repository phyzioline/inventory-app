# 08 — Performance & Scalability Audit

**Project:** `phyzioline/inventory-app`  
**Path:** `/home/phyzioline-inventory/htdocs/inventory.phyzioline.com`  
**Date:** 2026-07-30  
**Scope:** Read-only analysis — no changes applied.

---

## 1. Queue Infrastructure: Configured but Unused

| Evidence | Detail |
|----------|--------|
| `.env.example` line | `QUEUE_CONNECTION=redis` |
| Job classes found | **0** — `app/Infrastructure/Jobs/` does not exist; glob `**/Jobs/**/*.php` returns nothing |
| `database/migrations/0001_01_01_000002_create_jobs_table.php` | Jobs table migration exists (standard Laravel scaffold) |

**Impact:** Every heavy operation runs synchronously inside the HTTP request cycle. Redis is provisioned and configured but never dispatched to.

---

## 2. Synchronous HTTP Imports (Critical Bottleneck)

| Import Service | File | Lines | Sync Evidence |
|---|---|---|---|
| **MarketplaceImportService** | `app/Application/Services/MarketplaceImportService.php` | ~3,680 | Controller calls `$this->importService->import()` inline; `set_time_limit(600)` in `MarketplaceOrderController::import()` |
| **PurchaseImportService + Gemini** | `app/Application/Services/PurchaseImportService.php` | ~2,180 | Calls `$this->gemini->...` (external HTTP to Google Gemini API) inside the request |
| **SettlementService** | `app/Application/Services/SettlementService.php` | ~2,380 | `importAmazonSettlement()` parses full XML/CSV file and upserts thousands of `SettlementItem` rows synchronously |

**Risk:**
- PHP-FPM worker starvation on large sheets (>5k rows).
- Gemini API latency (seconds) blocks the HTTP response; client timeouts likely.
- `set_time_limit(600)` is a symptom, not a solution — the web server / reverse proxy may still cut the connection.

---

## 3. N+1 Query Evidence

### 3.1 SkuController (`app/Presentation/Http/Controllers/Api/SkuController.php`)

```
Line 49: $query = Sku::with(['offer.masterProduct', 'channel.locations', 'inventory.location']);
```

Eager loading is present on the **index** path, but the `enrichSkuRows()` helper (line 116) executes **per-row** queries when `relationLoaded('inventory')` is false (line 35–42). The `resolveMainStoreChannelId()` private method (line 451) runs `Channel::query()->get(['id','name','slug'])` **per enrichSkuRows() call**, fetching all channels every index request.

**Lines 487–495:** `generateStoreSkuCode()` issues up to **4 sequential** `Sku::where('sku', $candidate)->exists()` queries per row during the `update` path that triggers `ensureMainStoreSkuForOfferAndRehomeStoreInventory()`.

### 3.2 InventoryTransactionController (`app/Presentation/Http/Controllers/Api/InventoryTransactionController.php`)

```
Line 399–401 (skuTracker): foreach ($balanceSkuIds as $sid) {
    $totalQty = SkuInventory::query()->where('sku_id', $sid)->sum('quantity');
    $sku = Sku::query()->select(...)->with('channel:id,name')->find($sid);
```

This loops over every resolved SKU ID and fires **2 queries per ID** (sum + find). For a master product with 10 channel listings → 20 extra queries.

### 3.3 QuotationController (`app/Presentation/Http/Controllers/Api/QuotationController.php`)

```
Line 21: Quotation::with('customer', 'items.sku')->orderBy('created_at', 'desc')->get();
```

**No pagination.** All quotations are loaded into memory and sent as a single JSON array. Each item eager-loads SKU, but `items.sku.offer.masterProduct` is only loaded in `show()` — the index response ships incomplete data unless the frontend makes follow-up calls.

---

## 4. SPA Bundle & React Query Configuration

| Metric | Value |
|--------|-------|
| Total `.ts`/`.tsx` files | 247 |
| Lazy-loaded pages (in `App.tsx`) | ~50+ via `React.lazy()` |
| QueryClient `refetchOnWindowFocus` | **`true`** (global default, line 114 of `resources/frontend/src/lib/App.tsx`) |
| QueryClient `staleTime` | `3 * 60 * 1000` (3 minutes) |
| `useQuery` / `useMutation` call sites | 86 files (counted by grep across hooks/pages/components) |

**Concerns:**
- `refetchOnWindowFocus: true` with 3 min stale time means every Alt-Tab triggers refetch storms across all mounted queries. For pages with 5–10 queries (e.g., Dashboard, ChannelDetail), this multiplies backend load.
- Fat pages like `ProfitEngine.tsx` (24 query-related lines), `SmartPurchaseImport.tsx` (19), `ChannelDetail.tsx` (13), and `CapitalManagement.tsx` (23) mount many concurrent queries on render.

---

## 5. Caching Opportunities (Currently Absent from Controllers)

| Endpoint | File | Why Cache |
|---|---|---|
| `GET /api/inventory/dashboard` | `InventoryController::dashboard()` | Aggregates across orders, stock, channels — heavy read |
| `GET /api/inventory/channels/metrics` | `ChannelController::metrics()` | Per-channel SKU counts + stock summaries |
| `GET /api/inventory/reports/dashboard-metrics` | `DashboardMetricsController::index()` | Period-scoped aggregates; same period returns same result |
| `GET /api/inventory/skus/channel-summary` | `SkuController::channelSummary()` | Valuation aggregation per channel |

Only **2 controllers** (`InventoryLocationController`, `MasterProductController`) use `Cache::` at all. The remaining 30+ controllers hit the database on every request with zero application-layer caching.

---

## 6. Pagination Gaps

| Endpoint | Controller | Issue |
|---|---|---|
| `GET /api/inventory/quotations` | `QuotationController::index()` | **No pagination** — `->get()` returns all quotations |
| `GET /api/inventory/transactions` (no paginate flag) | `InventoryTransactionController::index()` | Falls back to `$query->get()` (unbounded) |
| `GET /api/inventory/skus` (no paginate flag) | `SkuController::index()` | Falls back to `$query->get()` (unbounded) |
| `GET /api/inventory/orders` (no paginate flag + no date range) | `InventoryOrderController::index()` | Falls back to `$query->get()` — potentially all orders ever |
| `GET /api/inventory/channels` | `ChannelController` | `->get()` on channels (low volume, acceptable) |

Endpoints that **do** paginate correctly: `SettlementController::index()`, `ReceiptController::index()`, `ProfitDistributionController::index()`.

---

## 7. Recommendations (Prioritized)

| # | Priority | Recommendation | Effort |
|---|----------|----------------|--------|
| 1 | **P0** | Move MarketplaceImport, PurchaseImport (Gemini), and SettlementImport to queued jobs. Return an import session ID; poll or push status via WebSocket. | High |
| 2 | **P0** | Add mandatory pagination to Quotations index, Transactions index (unpaginated path), SKUs index (unpaginated path), and Orders index (unpaginated path). | Low |
| 3 | **P1** | Replace `refetchOnWindowFocus: true` with `false` globally or use a longer `staleTime` (10–30 min) for non-volatile data (channels, master products, quotations). | Low |
| 4 | **P1** | Cache dashboard / metrics responses with per-user TTL (5 min). Invalidate on order-import completion. | Medium |
| 5 | **P1** | Eliminate N+1 in `skuTracker` — batch the balance query into a single `SUM … GROUP BY sku_id` query and preload SKUs via `whereIn`. | Low |
| 6 | **P2** | Cache `resolveMainStoreChannelId()` per-request (already the same value for the entire enrichment loop). | Trivial |
| 7 | **P2** | Evaluate moving SPA pages with >10 parallel queries to server-side aggregation endpoints (single request) to reduce HTTP overhead. | Medium |
| 8 | **P2** | Add a read-only replica or query-level caching for report endpoints (`ProfitReportController`, `InventoryReportController`) once data volume exceeds current thresholds. | High |

> **Note:** Do NOT run load tests against the production `phyzioline_inventory` database. Provision a staging replica if benchmarking is needed.
