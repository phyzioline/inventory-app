<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Prevents Race Condition 3: two concurrent imports both deducting stock for the same
 * order+SKU pair when hasPriorImportedOrderDeduction passes for both before either commits.
 *
 * Strategy: partial unique index on inventory_transactions that allows only ONE OUT row
 * per (reference_type='ImportedOrder', reference_id, sku_id). The second concurrent
 * INSERT will get a unique violation and be handled via SAVEPOINT in applyImportStockOutAtLocation.
 *
 * Important — post-repair state (2026-06-21):
 *  RepairImportSkuDrift ran BEFORE this migration and compensated 338 double-deduction groups
 *  by creating IN transactions (notes: 'Repair: reversed duplicate OUT deduction (tx #<id>)')
 *  and incrementing sku_inventory.quantity. The duplicate OUT transactions were NOT deleted
 *  by the repair command — it only created compensating INs.
 *
 *  This migration must therefore:
 *   A) For extra OUTs where a compensating IN exists from the repair:
 *      → Delete the compensating IN (stock already correct, IN is now redundant)
 *      → Delete the extra OUT
 *      → Do NOT touch sku_inventory (stock was already restored by repair)
 *
 *   B) For extra OUTs where NO compensating IN exists (245 remaining, different location_id
 *      grouping caused repair to miss them):
 *      → Restore sku_inventory.quantity (increment by the extra OUT's quantity)
 *      → Delete the extra OUT
 *
 *  The unique index is then created on the now-deduplicated table.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('inventory_transactions')) {
            return;
        }

        // Find all (reference_id, sku_id) pairs that have more than one OUT transaction.
        // Group by (reference_id, sku_id) to match the unique index columns — this catches
        // duplicates regardless of location_id (the repair command grouped by location_id
        // and missed cross-location duplicates, which are handled here).
        $dupes = DB::select("
            SELECT MIN(id) AS keep_id, reference_id, sku_id
            FROM inventory_transactions
            WHERE reference_type = 'ImportedOrder'
              AND type = 'OUT'
            GROUP BY reference_id, sku_id
            HAVING COUNT(*) > 1
        ");

        foreach ($dupes as $d) {
            // Collect extra OUTs (all except the one to keep — the oldest / lowest id).
            $extraOuts = DB::select("
                SELECT id, quantity, location_id, user_id
                FROM inventory_transactions
                WHERE reference_type = 'ImportedOrder'
                  AND type           = 'OUT'
                  AND reference_id   = ?
                  AND sku_id         = ?
                  AND id             > ?
                ORDER BY id ASC
            ", [$d->reference_id, $d->sku_id, $d->keep_id]);

            foreach ($extraOuts as $extra) {
                // Check whether RepairImportSkuDrift already created a compensating IN
                // for this exact OUT transaction (identified by its id in the notes column).
                $compensatingInId = DB::table('inventory_transactions')
                    ->where('type', 'IN')
                    ->where('reference_type', 'ImportedOrder')
                    ->where('reference_id', $d->reference_id)
                    ->where('sku_id', $d->sku_id)
                    ->where('notes', 'like', '%tx #'.$extra->id.'%')
                    ->value('id');

                if ($compensatingInId) {
                    // Case A: Repair already restored stock. The compensating IN is now
                    // redundant (its purpose was to cancel the extra OUT we are about to delete).
                    // Delete the IN so the ledger doesn't show a phantom return-to-stock entry.
                    DB::statement('DELETE FROM inventory_transactions WHERE id = ?', [$compensatingInId]);
                    // sku_inventory is already correct — do NOT increment again.
                } else {
                    // Case B: Repair did NOT compensate this extra OUT (cross-location duplicate
                    // that repair's grouping missed). Restore stock before deleting the OUT.
                    $qty = (float) $extra->quantity;
                    $locId = (int) $extra->location_id;
                    $skuId = (int) $d->sku_id;

                    if ($qty > 0 && $locId > 0 && $skuId > 0) {
                        DB::statement(
                            'UPDATE sku_inventory SET quantity = quantity + ? WHERE sku_id = ? AND location_id = ?',
                            [$qty, $skuId, $locId]
                        );
                    }
                }

                // In both cases: remove the extra OUT transaction.
                DB::statement('DELETE FROM inventory_transactions WHERE id = ?', [$extra->id]);
            }
        }

        // Now the table is free of duplicate OUT rows per (reference_id, sku_id).
        // Create the partial unique index to enforce this going forward.
        if (DB::getDriverName() === 'pgsql') {
            DB::statement('DROP INDEX IF EXISTS uq_txn_one_out_per_order_sku');
            DB::statement("
                CREATE UNIQUE INDEX uq_txn_one_out_per_order_sku
                ON inventory_transactions (reference_id, sku_id)
                WHERE reference_type = 'ImportedOrder'
                  AND type           = 'OUT'
            ");
        } else {
            try {
                Schema::table('inventory_transactions', function (Blueprint $table) {
                    $table->dropUnique('uq_txn_one_out_per_order_sku');
                });
            } catch (\Throwable) {
            }
            Schema::table('inventory_transactions', function (Blueprint $table) {
                $table->unique(
                    ['reference_type', 'reference_id', 'sku_id', 'type'],
                    'uq_txn_one_out_per_order_sku'
                );
            });
        }
    }

    public function down(): void
    {
        if (DB::getDriverName() === 'pgsql') {
            DB::statement('DROP INDEX IF EXISTS uq_txn_one_out_per_order_sku');
        } else {
            try {
                Schema::table('inventory_transactions', function (Blueprint $table) {
                    $table->dropUnique('uq_txn_one_out_per_order_sku');
                });
            } catch (\Throwable) {
            }
        }
    }
};
