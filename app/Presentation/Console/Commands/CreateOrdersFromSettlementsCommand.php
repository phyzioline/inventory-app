<?php

namespace App\Presentation\Console\Commands;

use App\Application\Services\SettlementOrderBackfillService;
use App\Presentation\Console\Commands\Concerns\RequiresTenantUser;
use Illuminate\Console\Command;

class CreateOrdersFromSettlementsCommand extends Command
{
    use RequiresTenantUser;

    protected $signature = 'inventory:create-orders-from-settlements
                            {--user= : Inventory user_id (tenant) — required}
                            {--since= : Start date (Y-m-d) for channels that have no stock tracking start set}
                            {--apply : Create the orders and reconcile their sheets (default is a dry run)}';

    protected $description = 'Create orders Amazon paid for on a payment sheet but whose order report was never uploaded (from the channel start date). No stock is deducted.';

    public function handle(SettlementOrderBackfillService $service): int
    {
        $userId = $this->requireTenantUser();
        if ($userId <= 0) {
            return self::FAILURE;
        }

        $plan = $service->plan($userId, $this->option('since') ?: null);
        if ($plan['channels_without_start'] !== []) {
            $this->warn('Skipped — no start date set (Channels → stock tracking start): '.implode(', ', $plan['channels_without_start']));
        }

        $orders = collect($plan['orders']);
        $items = $orders->flatMap(fn ($o) => $o['items']);
        $this->info(sprintf('Orders to create: %d | sales %s EGP | units %d | lines without a known SKU: %d | orders with fees/refunds only (skipped): %d',
            $orders->count(), number_format((float) $orders->sum('total'), 2), $items->sum('quantity'),
            $items->whereNull('sku_id')->count(), $plan['skipped_no_sale_line']));

        $this->table(['Month', 'Orders', 'Sales EGP'], $orders->groupBy(fn ($o) => substr($o['order_date'], 0, 7))->sortKeys()
            ->map(fn ($g, $m) => [$m, $g->count(), number_format((float) $g->sum('total'), 0)])->values()->all());

        $this->line('Units per SKU (NOT deducted from stock — for your stock review):');
        $this->table(['SKU', 'Units'], $items->groupBy('sku_code')->map(fn ($g, $k) => [$k ?: '(none)', $g->sum('quantity')])
            ->sortByDesc(fn ($r) => $r[1])->take(25)->values()->all());

        if (! $this->option('apply')) {
            $this->warn('Dry run — nothing changed. Take a backup (backup_inventory_pgsql.sh), then re-run with --apply.');

            return self::SUCCESS;
        }

        $res = $service->apply($plan, $userId);
        $this->info("Created {$res['created']} orders, reconciled {$res['reconciled_sheets']} sheets (audit: order.created_from_payment_sheet).");

        return self::SUCCESS;
    }
}
