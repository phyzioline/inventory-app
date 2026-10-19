<?php

namespace App\Presentation\Console\Commands;

use App\Application\Services\ReturnExcessRestockCorrectionService;
use App\Presentation\Console\Commands\Concerns\RequiresTenantUser;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

class ReverseExcessReturnStockCommand extends Command
{
    use RequiresTenantUser;

    protected $signature = 'inventory:reverse-excess-return-stock
                            {--user= : Inventory user_id (tenant) — required}
                            {--apply : Post the reversing OUT movements (default is a dry run)}';

    protected $description = 'Reverse stock that returns put back beyond the quantity the order sold.';

    public function handle(ReturnExcessRestockCorrectionService $service): int
    {
        $userId = $this->requireTenantUser();
        if ($userId <= 0) {
            return self::FAILURE;
        }

        $rows = $service->findExcess($userId);
        if ($rows->isEmpty()) {
            $this->info('No returns restocked beyond the sold quantity.');

            return self::SUCCESS;
        }

        $locations = DB::table('inventory_locations')->pluck('name', 'id');
        $this->table(
            ['Location', 'Orders', 'SKUs', 'Excess units', 'Reversible now', 'Already consumed'],
            $rows->groupBy('location_id')->map(fn ($g, $loc) => [
                $locations[$loc] ?? "#{$loc}",
                $g->pluck('order_id')->unique()->count(),
                $g->pluck('sku_id')->unique()->count(),
                $g->sum('excess'),
                $g->sum('reversible'),
                $g->sum('excess') - $g->sum('reversible'),
            ])->values()->all()
        );

        if (! $this->option('apply')) {
            $this->warn('Dry run — re-run with --apply to post the reversals.');

            return self::SUCCESS;
        }

        $result = $service->apply($userId, $rows);
        $this->info(sprintf(
            'Reversed %d units, voided %d returns, %d units already consumed (audit: returns.excess_restock_reversed).',
            $result['reversed_units'],
            $result['voided_returns'],
            $result['unreversible_units']
        ));

        return self::SUCCESS;
    }
}
