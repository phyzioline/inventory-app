<?php

namespace App\Presentation\Console\Commands;

use Illuminate\Console\Command;
use App\Application\Services\SettlementService;
use App\Domain\Models\Wms\SettlementItem;

class RecomputeOrderFinancialStatusesCommand extends Command
{
    /**
     * Re-runs the same financial_status / settlement_status rules as settlement reconcile,
     * without re-uploading XML/CSV. Safe default: only orders that have at least one
     * matched settlement line (orders with no settlement data are skipped).
     */
    protected $signature = 'inventory:recompute-order-financial-status
                            {--order= : Single inventory order id (inventory_orders.id)}
                            {--user-id= : Limit to orders owned by this user (inventory_orders.user_id)}
                            {--dry-run : Print order ids that would be updated, without writing}';

    protected $description = 'Recompute financial_status and settlement_status from stored settlement_items (no file re-import).';

    public function handle(SettlementService $settlementService): int
    {
        $dryRun = (bool) $this->option('dry-run');
        $orderOpt = $this->option('order');
        $userIdOpt = $this->option('user-id');

        if ($orderOpt !== null && $orderOpt !== '' && (int) $orderOpt > 0) {
            $ids = collect([(int) $orderOpt]);
        } else {
            $q = SettlementItem::query()
                ->where('reconciliation_status', 'matched')
                ->whereNotNull('inventory_order_id');

            if ($userIdOpt !== null && $userIdOpt !== '' && (int) $userIdOpt > 0) {
                $userId = (int) $userIdOpt;
                $q->whereHas('inventoryOrder', function ($rel) use ($userId) {
                    $rel->where('user_id', $userId);
                });
            }

            $ids = $q->distinct()->pluck('inventory_order_id')->filter()->unique()->values();
        }

        $total = $ids->count();
        if ($total === 0) {
            $this->warn('No matching inventory orders found.');

            return self::SUCCESS;
        }

        $this->info("Orders to recompute: {$total}".($dryRun ? ' (dry run)' : ''));

        $n = 0;
        foreach ($ids as $orderId) {
            $orderId = (int) $orderId;
            if ($orderId <= 0) {
                continue;
            }
            if ($dryRun) {
                $this->line("  [dry-run] would recompute order_id={$orderId}");
                $n++;

                continue;
            }
            $settlementService->recomputeOrderFinancialStatuses($orderId);
            $n++;
        }

        if (! $dryRun) {
            $this->info("Done. Recomputed {$n} order(s).");
        } else {
            $this->info("Dry run finished. {$n} order(s) would be updated.");
        }

        return self::SUCCESS;
    }
}
