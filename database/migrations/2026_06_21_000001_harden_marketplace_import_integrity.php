<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Hardens the marketplace order import subsystem against the historical-import
 * double-deduction and SKU-drift bugs identified in June 2026.
 *
 * Changes:
 *  1. inventory_orders: scoped unique index (user_id + platform_order_id) replaces
 *     the global unique constraint that breaks multi-tenant deployments.
 *  2. inventory_order_items: composite unique (inventory_order_id + sku_code) prevents
 *     duplicate line entries when a SKU is re-imported under a different sku_id.
 *  3. inventory_transactions: composite index on (reference_type, reference_id, sku_id, type)
 *     to make hasPriorImportedOrderDeduction O(log n) instead of O(n).
 *
 * Root cause of original failure:
 *  The dropIndexIfExists helper used Schema::table(Blueprint::dropIndex()) which in
 *  PostgreSQL generates `DROP INDEX "name"` WITHOUT IF EXISTS. When that index is actually
 *  a constraint (created via Blueprint::unique()), PostgreSQL rejects the bare DROP INDEX
 *  and the connection enters "transaction aborted" state. The try/catch stops the PHP
 *  exception but the connection remains aborted — every subsequent query fails with
 *  "current transaction is aborted, commands ignored until end of transaction block".
 *  Fix: use ALTER TABLE ... DROP CONSTRAINT IF EXISTS + DROP INDEX IF EXISTS directly,
 *  which are always safe and never abort the outer transaction.
 */
return new class extends Migration
{
    public function up(): void
    {
        // 1. Drop the global unique on platform_order_id and replace with a
        //    per-user unique so multi-tenant accounts can share marketplace order IDs.
        if (Schema::hasTable('inventory_orders')) {
            $this->dropConstraintAndIndex('inventory_orders', 'inventory_orders_platform_order_id_unique');
            // Also drop the new index in case a previous failed run partially applied it.
            $this->dropConstraintAndIndex('inventory_orders', 'uq_inventory_orders_user_platform');

            // Remove duplicate (user_id, platform_order_id) pairs before adding the unique constraint.
            // These can exist if the old global unique was already missing and the same order was
            // imported twice. Keep the row with the lowest id (oldest import).
            if (DB::getDriverName() === 'pgsql') {
                DB::statement('
                    DELETE FROM inventory_orders
                    WHERE id NOT IN (
                        SELECT MIN(id)
                        FROM inventory_orders
                        WHERE platform_order_id IS NOT NULL
                        GROUP BY user_id, platform_order_id
                    )
                    AND platform_order_id IS NOT NULL
                ');
            }

            Schema::table('inventory_orders', function (Blueprint $table) {
                $table->unique(['user_id', 'platform_order_id'], 'uq_inventory_orders_user_platform');
            });
        }

        // 2. inventory_order_items: unique per order + external SKU code so re-imports
        //    with a changed sku_id never create a duplicate line for the same marketplace item.
        if (Schema::hasTable('inventory_order_items') && Schema::hasColumn('inventory_order_items', 'sku_code')) {
            // Guard against NULLs – PostgreSQL treats NULL != NULL so nulls bypass unique constraints.
            DB::statement("UPDATE inventory_order_items SET sku_code = '' WHERE sku_code IS NULL");

            // Drop old copy in case this migration partially succeeded on a prior attempt.
            $this->dropConstraintAndIndex('inventory_order_items', 'uq_order_items_order_sku_code');

            if (DB::getDriverName() === 'pgsql') {
                DB::statement(
                    'CREATE UNIQUE INDEX uq_order_items_order_sku_code '
                    .'ON inventory_order_items (inventory_order_id, sku_code) '
                    ."WHERE sku_code <> ''"
                );
            } else {
                Schema::table('inventory_order_items', function (Blueprint $table) {
                    $table->unique(['inventory_order_id', 'sku_code'], 'uq_order_items_order_sku_code');
                });
            }
        }

        // 3. Speed up hasPriorImportedOrderDeduction — called once per row per import.
        if (Schema::hasTable('inventory_transactions')) {
            $this->dropConstraintAndIndex('inventory_transactions', 'idx_txn_import_deduction_lookup');

            Schema::table('inventory_transactions', function (Blueprint $table) {
                $table->index(
                    ['reference_type', 'reference_id', 'sku_id', 'type'],
                    'idx_txn_import_deduction_lookup'
                );
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('inventory_orders')) {
            $this->dropConstraintAndIndex('inventory_orders', 'uq_inventory_orders_user_platform');
            // Restore original global unique (best-effort; may fail if duplicates now exist).
            try {
                Schema::table('inventory_orders', function (Blueprint $table) {
                    $table->unique('platform_order_id', 'inventory_orders_platform_order_id_unique');
                });
            } catch (\Throwable) {
            }
        }

        if (Schema::hasTable('inventory_order_items')) {
            if (DB::getDriverName() === 'pgsql') {
                DB::statement('DROP INDEX IF EXISTS uq_order_items_order_sku_code');
            } else {
                $this->dropConstraintAndIndex('inventory_order_items', 'uq_order_items_order_sku_code');
            }
        }

        if (Schema::hasTable('inventory_transactions')) {
            $this->dropConstraintAndIndex('inventory_transactions', 'idx_txn_import_deduction_lookup');
        }
    }

    /**
     * Safely drop a named constraint OR index in any driver without aborting the outer transaction.
     *
     * PostgreSQL problem: Schema::table(fn($t) => $t->dropIndex($name)) generates
     * `DROP INDEX "name"` (no IF EXISTS). If the object is a constraint-backed index
     * (created via Blueprint::unique()), PostgreSQL rejects it and the connection enters
     * "aborted" state. The subsequent try/catch stops PHP propagation but the next SQL
     * still fails. Fix: use `ALTER TABLE DROP CONSTRAINT IF EXISTS` + `DROP INDEX IF EXISTS`
     * which are both no-ops when the object is absent and never abort the transaction.
     */
    private function dropConstraintAndIndex(string $table, string $name): void
    {
        if (DB::getDriverName() === 'pgsql') {
            DB::statement("ALTER TABLE \"{$table}\" DROP CONSTRAINT IF EXISTS \"{$name}\"");
            DB::statement("DROP INDEX IF EXISTS \"{$name}\"");
        } else {
            try {
                Schema::table($table, function (Blueprint $t) use ($name) {
                    $t->dropIndex($name);
                });
            } catch (\Throwable) {
            }
        }
    }
};
