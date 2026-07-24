<?php

namespace App\Presentation\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use App\Domain\Models\Wms\InventoryOrderItem;
use App\Domain\Models\Wms\Sku;
use App\Domain\Models\Wms\SkuInventory;

/**
 * Repairs three categories of data corruption left by the historical-import / SKU-drift bug:
 *
 *  Phase 1 — Remove duplicate order-item rows
 *             When a re-import created a second InventoryOrderItem for the same (order, sku_code),
 *             keep the FIRST (original) row and delete the duplicate.
 *
 *  Phase 2 — Reverse double deductions
 *             When there are two OUT transactions for the same (order_id, sku_id) pair,
 *             create an IN transaction to cancel the second one and restore stock.
 *
 *  Phase 3 — Update drifted sku_id pointers
 *             For items where sku_code now resolves to a different sku_id, update the stored
 *             sku_id so that future hasPriorImportedOrderDeduction lookups match correctly.
 *             This does NOT move stock — it only corrects the FK pointer on the item row.
 *
 * Run: php artisan inventory:repair-sku-drift [--user=<id>] [--dry-run]
 *
 * ALWAYS run with --dry-run first and verify output before live repair.
 */
class RepairImportSkuDrift extends Command
{
    protected $signature = 'inventory:repair-sku-drift
                              {--user= : Limit repair to a single user_id}
                              {--dry-run : Report what would be changed without modifying data}';

    protected $description = 'Repair SKU-drift corruption in inventory_order_items and inventory_transactions.';

    private bool $dry = false;

    public function handle(): int
    {
        $this->dry = (bool) $this->option('dry-run');
        $userId = $this->option('user') ? (int) $this->option('user') : null;

        if ($this->dry) {
            $this->warn('[DRY RUN] No data will be modified.');
        }

        $phase1 = $this->repairDuplicateItems($userId);
        $phase2 = $this->reverseDoubleDeductions($userId);
        $phase3 = $this->updateDriftedSkuIds($userId);

        $this->newLine();
        $this->table(
            ['Phase', 'Action', 'Count'],
            [
                ['1', 'Duplicate item rows removed',         $phase1],
                ['2', 'Double deductions reversed (IN tx)',  $phase2],
                ['3', 'Drifted sku_id pointers corrected',   $phase3],
            ]
        );

        if ($this->dry) {
            $this->warn('Re-run without --dry-run to apply the above changes.');
        } else {
            $this->info('Repair complete. Run `inventory:audit-sku-drift` to verify.');
        }

        return self::SUCCESS;
    }

    // ── Phase 1: Remove duplicate InventoryOrderItem rows ────────────────────

    private function repairDuplicateItems(?int $userId): int
    {
        $this->line('<comment>Phase 1: Scanning for duplicate order items…</comment>');

        $groups = DB::table('inventory_order_items as ioi')
            ->join('inventory_orders as io', 'io.id', '=', 'ioi.inventory_order_id')
            ->whereRaw("ioi.sku_code IS NOT NULL AND ioi.sku_code <> ''")
            ->when($userId, fn ($q) => $q->where('io.user_id', $userId))
            ->select('ioi.inventory_order_id', 'ioi.sku_code')
            ->groupBy('ioi.inventory_order_id', 'ioi.sku_code')
            ->havingRaw('COUNT(*) > 1')
            ->get();

        $removed = 0;

        foreach ($groups as $g) {
            $rows = DB::table('inventory_order_items')
                ->where('inventory_order_id', $g->inventory_order_id)
                ->where('sku_code', $g->sku_code)
                ->orderBy('id')
                ->get(['id', 'sku_id', 'quantity']);

            $keepId = (int) $rows->first()->id;
            $delIds = $rows->pluck('id')->filter(fn ($id) => (int) $id !== $keepId)->values()->all();

            $this->line("  Order {$g->inventory_order_id} / sku_code '{$g->sku_code}': keeping item #{$keepId}, removing ".implode(',', $delIds));

            if (! $this->dry && $delIds !== []) {
                DB::table('inventory_order_items')->whereIn('id', $delIds)->delete();
                $removed += count($delIds);
            } elseif ($this->dry) {
                $removed += count($delIds);
            }
        }

        $this->line("  → {$removed} duplicate item rows ".($this->dry ? 'would be' : 'were').' removed.');

        return $removed;
    }

    // ── Phase 2: Reverse double OUT deductions ────────────────────────────────

    private function reverseDoubleDeductions(?int $userId): int
    {
        $this->line('<comment>Phase 2: Scanning for double deductions…</comment>');

        $doubles = DB::table('inventory_transactions as t')
            ->where('t.reference_type', 'ImportedOrder')
            ->where('t.type', 'OUT')
            ->when($userId, fn ($q) => $q->where('t.user_id', $userId))
            ->select('t.reference_id', 't.sku_id', 't.location_id', 't.user_id as tx_user_id')
            ->groupBy('t.reference_id', 't.sku_id', 't.location_id', 't.user_id')
            ->havingRaw('COUNT(*) > 1')
            ->get();

        $reversed = 0;

        foreach ($doubles as $d) {
            // Collect all OUT transactions for this (order, sku, location).
            $outs = DB::table('inventory_transactions')
                ->where('reference_type', 'ImportedOrder')
                ->where('reference_id', $d->reference_id)
                ->where('sku_id', $d->sku_id)
                ->where('location_id', $d->location_id)
                ->where('type', 'OUT')
                ->orderBy('id')
                ->get(['id', 'quantity', 'user_id']);

            // Keep the first OUT; reverse all subsequent ones.
            $toReverse = $outs->slice(1);

            foreach ($toReverse as $tx) {
                $qty = (int) $tx->quantity;
                if ($qty <= 0) {
                    continue;
                }

                $this->line("  Reversing extra OUT tx #{$tx->id}: order={$d->reference_id}, sku_id={$d->sku_id}, qty={$qty}");

                if (! $this->dry) {
                    DB::transaction(function () use ($tx, $qty, $d) {
                        // Restore stock.
                        SkuInventory::query()
                            ->where('sku_id', $d->sku_id)
                            ->where('location_id', $d->location_id)
                            ->increment('quantity', $qty);

                        // Audit IN transaction.
                        DB::table('inventory_transactions')->insert([
                            'sku_id' => $d->sku_id,
                            'location_id' => $d->location_id,
                            'type' => 'IN',
                            'quantity' => $qty,
                            'reference_type' => 'ImportedOrder',
                            'reference_id' => $d->reference_id,
                            'user_id' => $tx->user_id,
                            'notes' => 'Repair: reversed duplicate OUT deduction (tx #'.$tx->id.')',
                            'created_at' => now(),
                            'updated_at' => now(),
                        ]);
                    });
                }

                $reversed++;
            }
        }

        $this->line("  → {$reversed} double deductions ".($this->dry ? 'would be' : 'were').' reversed.');

        return $reversed;
    }

    // ── Phase 3: Correct drifted sku_id pointers on order items ──────────────

    private function updateDriftedSkuIds(?int $userId): int
    {
        $this->line('<comment>Phase 3: Correcting drifted sku_id pointers…</comment>');

        $drifted = DB::table('inventory_order_items as ioi')
            ->join('inventory_orders as io', 'io.id', '=', 'ioi.inventory_order_id')
            ->join('skus as s_current', function ($j) {
                $j->on('s_current.user_id', '=', 'io.user_id')
                    ->whereRaw('(s_current.sku = ioi.sku_code OR s_current.marketplace_id = ioi.sku_code)');
            })
            ->whereRaw("ioi.sku_code IS NOT NULL AND ioi.sku_code <> ''")
            ->whereRaw('s_current.id <> ioi.sku_id')
            ->when($userId, fn ($q) => $q->where('io.user_id', $userId))
            ->select('ioi.id as item_id', 'ioi.sku_id as old_sku_id', 's_current.id as new_sku_id', 'ioi.sku_code')
            ->orderBy('ioi.id')
            ->get();

        $corrected = 0;

        foreach ($drifted as $row) {
            $this->line(
                "  Item #{$row->item_id} '{$row->sku_code}': sku_id {$row->old_sku_id} → {$row->new_sku_id}"
            );

            if (! $this->dry) {
                DB::table('inventory_order_items')
                    ->where('id', $row->item_id)
                    ->update(['sku_id' => $row->new_sku_id]);
            }

            $corrected++;
        }

        $this->line("  → {$corrected} sku_id pointers ".($this->dry ? 'would be' : 'were').' corrected.');

        return $corrected;
    }
}
