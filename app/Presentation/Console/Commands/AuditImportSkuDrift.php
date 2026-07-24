<?php

namespace App\Presentation\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Counts and reports SKU-drift items: order items where the external sku_code
 * now resolves to a different sku_id than the one stored on the item.
 *
 * Run: php artisan inventory:audit-sku-drift [--user=<id>] [--detail]
 */
class AuditImportSkuDrift extends Command
{
    protected $signature = 'inventory:audit-sku-drift
                              {--user= : Limit audit to a single user_id}
                              {--detail : Print individual drifted rows instead of just counts}';

    protected $description = 'Detect inventory_order_items whose sku_code now maps to a different sku_id (SKU drift).';

    public function handle(): int
    {
        $userFilter = $this->option('user') ? [(int) $this->option('user')] : null;

        // ── 1. Drifted items ────────────────────────────────────────────────
        $driftQuery = DB::table('inventory_order_items as ioi')
            ->join('inventory_orders as io', 'io.id', '=', 'ioi.inventory_order_id')
            ->join('skus as s_stored', 's_stored.id', '=', 'ioi.sku_id')
            ->join('skus as s_current', function ($j) {
                $j->on('s_current.user_id', '=', 'io.user_id')
                    ->whereRaw('(s_current.sku = ioi.sku_code OR s_current.marketplace_id = ioi.sku_code)');
            })
            ->whereRaw("ioi.sku_code IS NOT NULL AND ioi.sku_code <> ''")
            ->whereRaw('s_current.id <> ioi.sku_id');

        if ($userFilter) {
            $driftQuery->whereIn('io.user_id', $userFilter);
        }

        $driftCount = (clone $driftQuery)->count();

        // ── 2. Double deductions ────────────────────────────────────────────
        $doubleDeductCount = DB::table('inventory_transactions as t')
            ->where('t.reference_type', 'ImportedOrder')
            ->where('t.type', 'OUT')
            ->when($userFilter, fn ($q) => $q->whereIn('t.user_id', $userFilter))
            ->select('t.reference_id', 't.sku_id')
            ->groupBy('t.reference_id', 't.sku_id')
            ->havingRaw('COUNT(*) > 1')
            ->get()
            ->count();

        // ── 3. Duplicate order items (same order + sku_code) ────────────────
        $dupItemQuery = DB::table('inventory_order_items as ioi')
            ->join('inventory_orders as io', 'io.id', '=', 'ioi.inventory_order_id')
            ->whereRaw("ioi.sku_code IS NOT NULL AND ioi.sku_code <> ''")
            ->when($userFilter, fn ($q) => $q->whereIn('io.user_id', $userFilter))
            ->select('ioi.inventory_order_id', 'ioi.sku_code')
            ->groupBy('ioi.inventory_order_id', 'ioi.sku_code')
            ->havingRaw('COUNT(*) > 1');

        $dupItemCount = DB::table(DB::raw("({$dupItemQuery->toSql()}) as sub"))
            ->mergeBindings($dupItemQuery)
            ->count();

        // ── 4. Orders with no OUT transaction (merchant channels) ───────────
        $noOutCount = DB::table('inventory_order_items as ioi')
            ->join('inventory_orders as io', 'io.id', '=', 'ioi.inventory_order_id')
            ->join('channels as c', 'c.id', '=', 'io.channel_id')
            ->whereRaw("(c.name ILIKE '%merchant%' OR c.name ILIKE '%تاجر%' OR c.slug ILIKE '%merchant%')")
            ->whereRaw("NOT EXISTS (
                SELECT 1 FROM inventory_transactions t
                WHERE t.reference_type = 'ImportedOrder'
                  AND t.reference_id   = io.id::text
                  AND t.sku_id         = ioi.sku_id
                  AND t.type           = 'OUT'
            )")
            ->when($userFilter, fn ($q) => $q->whereIn('io.user_id', $userFilter))
            ->count();

        $this->table(
            ['Metric', 'Count', 'Severity'],
            [
                ['Drifted order items (sku_id mismatch)',           $driftCount,       $driftCount > 0 ? '<error>CRITICAL</error>' : '<info>OK</info>'],
                ['Double-deducted SKUs (multiple OUT per order+sku)', $doubleDeductCount, $doubleDeductCount > 0 ? '<error>CRITICAL</error>' : '<info>OK</info>'],
                ['Duplicate order item rows (same order+sku_code)', $dupItemCount,     $dupItemCount > 0 ? '<error>HIGH</error>' : '<info>OK</info>'],
                ['Merchant orders missing OUT transaction',         $noOutCount,       $noOutCount > 0 ? '<comment>WARNING</comment>' : '<info>OK</info>'],
            ]
        );

        if ($this->option('detail') && $driftCount > 0) {
            $rows = (clone $driftQuery)
                ->select([
                    'io.platform_order_id',
                    'ioi.id as item_id',
                    'ioi.sku_id as stored_sku_id',
                    'ioi.sku_code as external_code',
                    's_current.id as current_sku_id',
                    DB::raw('io.created_at::date as imported_on'),
                ])
                ->limit(100)
                ->get();

            $this->table(
                ['Order ID', 'Item', 'Stored sku_id', 'External Code', 'Current sku_id', 'Imported'],
                $rows->map(fn ($r) => [
                    $r->platform_order_id,
                    $r->item_id,
                    $r->stored_sku_id,
                    $r->external_code,
                    $r->current_sku_id,
                    $r->imported_on,
                ])->all()
            );

            if ($driftCount > 100) {
                $this->warn("Showing first 100 of {$driftCount} drifted rows.");
            }
        }

        return $driftCount > 0 || $doubleDeductCount > 0 ? self::FAILURE : self::SUCCESS;
    }
}
