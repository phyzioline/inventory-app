<?php

namespace App\Presentation\Console\Commands;

use App\Application\Services\SettlementService;
use App\Domain\Models\Wms\SettlementItem;
use App\Presentation\Console\Commands\Concerns\RequiresTenantUser;
use Illuminate\Console\Command;

class ReconcileSettlementReturnsCommand extends Command
{
    use RequiresTenantUser;

    protected $signature = 'inventory:reconcile-settlement-returns
                            {--user= : Inventory user_id (tenant) — required}
                            {--user-id= : Alias for --user (deprecated)}
                            {--order= : Single inventory order id (inventory_orders.id)}
                            {--dry-run : Print counts without voiding phantom settlement returns}';

    protected $description = 'Void settlement-generated inventory returns that are not backed by a qualifying product-refund line.';

    public function handle(SettlementService $settlementService): int
    {
        $userId = $this->requireTenantUser();
        if ($userId <= 0) {
            return self::FAILURE;
        }

        $dryRun = (bool) $this->option('dry-run');
        $orderOpt = $this->option('order');

        if ($orderOpt !== null && $orderOpt !== '' && (int) $orderOpt > 0) {
            $ids = collect([(int) $orderOpt]);
        } else {
            // SettlementItem has no user scope — filter via tenant-owned orders only.
            $q = SettlementItem::query()
                ->where('reconciliation_status', 'matched')
                ->whereNotNull('inventory_order_id')
                ->whereHas('inventoryOrder', function ($rel) use ($userId) {
                    $rel->where('user_id', $userId);
                });

            $ids = $q->distinct()->pluck('inventory_order_id')->filter()->unique()->values();
        }

        $total = $ids->count();
        if ($total === 0) {
            $this->warn('No matching inventory orders found.');

            return self::SUCCESS;
        }

        $this->info("Orders to reconcile returns (user={$userId}): {$total}".($dryRun ? ' (dry run)' : ''));

        $totals = ['kept' => 0, 'voided' => 0, 'skipped_fba_sheet' => 0, 'skipped_completed' => 0];

        foreach ($ids as $orderId) {
            $orderId = (int) $orderId;
            if ($orderId <= 0) {
                continue;
            }

            $stats = $settlementService->reconcileSettlementReturnsForOrder($orderId, $dryRun);
            foreach ($totals as $key => $value) {
                $totals[$key] += (int) ($stats[$key] ?? 0);
            }

            if ($dryRun && (($stats['voided'] ?? 0) > 0 || ($stats['kept'] ?? 0) > 0)) {
                $this->line(sprintf(
                    '  order_id=%d kept=%d void=%d skipped_fba=%d skipped_completed=%d',
                    $orderId,
                    $stats['kept'] ?? 0,
                    $stats['voided'] ?? 0,
                    $stats['skipped_fba_sheet'] ?? 0,
                    $stats['skipped_completed'] ?? 0
                ));
            }
        }

        $this->info(sprintf(
            'Totals — kept: %d, voided: %d, skipped_fba_sheet: %d, skipped_completed: %d%s',
            $totals['kept'],
            $totals['voided'],
            $totals['skipped_fba_sheet'],
            $totals['skipped_completed'],
            $dryRun ? ' (dry run — no rows updated)' : ''
        ));

        return self::SUCCESS;
    }
}
