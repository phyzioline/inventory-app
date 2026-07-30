# 09 — Database Schema & Integrity Audit

**Project:** `phyzioline/inventory-app`  
**Path:** `/home/phyzioline-inventory/htdocs/inventory.phyzioline.com`  
**Date:** 2026-07-30  
**Scope:** Read-only analysis — no migrations run, no schema changes applied.

---

## 1. Migration Census

| Metric | Value |
|--------|-------|
| Total migration files | **83** |
| Earliest | `0001_01_01_000000_create_users_table.php` (Laravel scaffold) |
| Latest | `2026_07_27_160000_add_company_name_to_users_table.php` |
| Database engine | PostgreSQL (enforced by `DB::getDriverName() === 'pgsql'` guards throughout) |

---

## 2. SoftDeletes: Absent Across All Domain Models

A grep for `SoftDeletes` in `app/Domain/Models/` returns **zero matches**.

**Implication:**
- `DELETE` operations (e.g., `SkuController::destroy()` cascade-deletes adjustments + quotation items + inventory) are permanent.
- Marketplace order rollback (`MarketplaceImportService::rollbackLast`) uses hard deletes of `InventoryOrder`, `InventoryOrderItem`, and `InventoryTransaction` rows.
- No audit trail for destroyed records exists at the DB level.

**Risk:** Accidental or intentional deletion of financial/stock records is unrecoverable except from nightly pg_dump backups (30-day retention).

---

## 3. `inventory_transactions` Schema

### 3.1 Current Columns (assembled from migrations)

| Column | Source Migration |
|--------|-----------------|
| `id`, `sku_id`, `location_id`, `type`, `quantity`, `reference_type`, `reference_id`, `timestamps` | `2026_02_14_113636_create_inventory_system_tables.php` |
| `notes` (text, nullable) | `2026_03_01_094239_add_notes_and_user_to_inventory_transactions_table.php` |
| `user_id` (unsigned bigint, nullable) | Same migration above |

### 3.2 Missing: `balance_after`

No migration adds a `balance_after` column. The running balance must be **recalculated** by summing all prior transactions per (sku_id, location_id) — an O(n) operation that `skuTracker` performs per-SKU via:

```php
$totalQty = SkuInventory::query()->where('sku_id', $sid)->sum('quantity');
```

This relies on the separate `sku_inventory` aggregate table rather than storing a snapshot per transaction. Consequences:
- Cannot produce a point-in-time ledger without replaying history.
- Reconciliation between `sku_inventory.quantity` and SUM(transactions) is not automated.

---

## 4. FK & Index Quality Samples

### 4.1 Good Examples

| Migration | What it does |
|-----------|-------------|
| `2026_06_21_000001_harden_marketplace_import_integrity.php` | Adds `uq_inventory_orders_user_platform` unique index; composite index `idx_txn_import_deduction_lookup` on `(reference_type, reference_id, sku_id, type)` |
| `2026_06_21_000002_unique_deduction_per_order_sku.php` | Partial unique index `uq_txn_one_out_per_order_sku` — PostgreSQL WHERE clause for `reference_type='ImportedOrder' AND type='OUT'` |
| `2026_04_22_100000_fix_sku_inventory_duplicates_add_unique_index.php` | Resolves duplicates then adds unique on `(sku_id, location_id)` |

### 4.2 Concerning Examples

| Migration | Issue |
|-----------|-------|
| `2026_06_17_000002_add_fk_indexes_high_traffic_tables.php` | References **monolith** tables (`sessions`, `home_visits`, `clinic_appointments`, `crm_leads`, etc.) that do not exist in `inventory-app`. These silently no-op due to `Schema::hasTable()` guards, but indicate copy-paste from the wrong project. Also references `inventory_transactions.transaction_type` column — which does not exist (column is named `type`). |
| `2026_02_14_113636_create_inventory_system_tables.php` | Uses `Schema::dropIfExists()` on all tables in `up()` — destructive if run on a DB with data. Only safe because it was the initial bootstrap. |
| `2026_02_15_180000_create_capital_management_tables.php` | Creates `profit_distributions` with `distribution_date` column, but the initial scaffold migration (`2026_02_14_...`) already created `profit_distributions` with `period_start`/`period_end` columns. Schema depends on which ran last. |

---

## 5. Marketplace Import Uniqueness Constraints

Two dedicated hardening migrations address the historical double-deduction bug:

### 5.1 `2026_06_21_000001_harden_marketplace_import_integrity.php`

- **`inventory_orders`:** Replaces global `platform_order_id` unique with tenant-scoped `UNIQUE(user_id, platform_order_id)` (`uq_inventory_orders_user_platform`).
- **`inventory_order_items`:** Partial unique index `uq_order_items_order_sku_code` on `(inventory_order_id, sku_code) WHERE sku_code <> ''` (PostgreSQL).
- **`inventory_transactions`:** Composite index `idx_txn_import_deduction_lookup` for O(log n) deduction lookups.

### 5.2 `2026_06_21_000002_unique_deduction_per_order_sku.php`

- **Partial unique index:** `uq_txn_one_out_per_order_sku` on `(reference_id, sku_id) WHERE reference_type='ImportedOrder' AND type='OUT'`.
- **Data cleanup in migration:** Detects duplicate OUT rows, checks for repair compensating INs, restores stock for uncompensated extras, then deletes duplicates.

**Assessment:** These are well-engineered, PostgreSQL-native solutions. The partial unique index effectively prevents race-condition duplicates at the DB level.

---

## 6. ProfitDistribution — Tenant Column / Scope Gap

### Schema

```php
// 2026_02_14_113636 (initial)
Schema::create('profit_distributions', function (Blueprint $table) {
    $table->id();
    $table->foreignId('capital_source_id')->constrained(...);
    $table->decimal('amount', 15, 2);
    $table->date('period_start');
    $table->date('period_end');
    $table->string('status')->default('pending');
    $table->timestamps();
});
```

`user_id` was bulk-added later by `2026_02_19_082830_add_user_id_to_inventory_tables.php` (nullable FK).

### Controller

`ProfitDistributionController` (`app/Presentation/Http/Controllers/Api/ProfitDistributionController.php`):

```php
public function index()
{
    $distributions = ProfitDistribution::with(['capitalSource'])
        ->orderBy('period_end', 'desc')
        ->paginate(50);
    return response()->json($distributions);
}
```

**No `where('user_id', auth()->id())` scope.** Any authenticated user sees ALL profit distributions across all tenants.

`store()` also calls `CapitalSource::all()` without tenant filtering — distributing profit across every tenant's capital sources.

**Cross-reference:** This was flagged in the Security audit (report 07). The DB schema has the column; the application code does not apply the scope.

---

## 7. PostgreSQL & Idempotent Migration Patterns

### Positive patterns observed:

| Pattern | Example Migration |
|---------|-------------------|
| `Schema::hasTable()` / `hasColumn()` guards | Used in ~60% of migrations |
| `IF EXISTS` / `IF NOT EXISTS` in raw SQL | `2026_06_21_000001` — `DROP INDEX IF EXISTS`, `ALTER TABLE DROP CONSTRAINT IF EXISTS` |
| Driver-aware branching | `DB::getDriverName() === 'pgsql'` before partial indexes |
| `dropConstraintAndIndex()` helper | Safely handles constraint vs index naming differences |

### Anti-patterns observed:

| Anti-pattern | Example |
|--------------|---------|
| `Schema::dropIfExists()` in `up()` (destructive) | `2026_02_14_113636` — drops and recreates all core tables |
| `enum()` usage in some migrations | PostgreSQL handles enums differently from MySQL; `2026_02_15_180000` uses `enum()` for `capital_sources.type` — works in PG but creates a custom type that is harder to modify later |
| Duplicate table definitions across migrations | `profit_distributions` defined in both `2026_02_14_113636` and `2026_02_15_180000` with different column sets |
| Monolith table references | `2026_06_17_000002` references clinic/CRM tables not in this schema |

---

## 8. Prioritized Schema Hardening List

> **No changes applied.** This is a recommendation-only list.

| # | Priority | Issue | Recommendation |
|---|----------|-------|----------------|
| 1 | **P0** | `ProfitDistribution` / `CapitalSource` missing tenant scope in queries | Add `where('user_id', auth()->id())` to all queries; consider a global scope on the model |
| 2 | **P0** | No `SoftDeletes` on financial models (`InventoryOrder`, `InventoryTransaction`, `Receipt`, `Payment`) | Add `deleted_at` column + `SoftDeletes` trait to protect audit trails |
| 3 | **P1** | `inventory_transactions` missing `balance_after` | Add nullable `decimal balance_after` column; populate on new inserts; backfill via artisan command |
| 4 | **P1** | Stock reconciliation not automated | Add scheduled command comparing `SUM(transactions)` vs `sku_inventory.quantity` per (sku_id, location_id); alert on drift |
| 5 | **P2** | Duplicate schema definition for `profit_distributions` | Remove the dead definition in the initial scaffold (or ensure it is never re-run via `Schema::hasTable()` guard — already partially guarded) |
| 6 | **P2** | Monolith table references in `2026_06_17_000002` | Remove non-inventory table entries; they no-op but pollute migration intent |
| 7 | **P2** | `enum()` columns in PostgreSQL | Replace with `string()` + CHECK constraint or application-level validation for easier future modifications |
| 8 | **P3** | Missing composite index on `sku_inventory(sku_id, location_id, quantity)` for fast stock lookups | Evaluate covering index if query patterns warrant it |
