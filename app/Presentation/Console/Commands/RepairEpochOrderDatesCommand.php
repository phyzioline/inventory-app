<?php

namespace App\Presentation\Console\Commands;

use App\Application\Services\OrderEpochDateRepairService;
use App\Presentation\Console\Commands\Concerns\RequiresTenantUser;
use Illuminate\Console\Command;

class RepairEpochOrderDatesCommand extends Command
{
    use RequiresTenantUser;

    protected $signature = 'inventory:repair-epoch-order-dates
                            {--user= : Inventory user_id (tenant) — required}
                            {--apply : Write the dates (default is a dry run)}';

    protected $description = 'Rebuild order dates stored as 1970 (unreadable at import) from payment-sheet lines, the same import, or the upload day.';

    public function handle(OrderEpochDateRepairService $service): int
    {
        $userId = $this->requireTenantUser();
        if ($userId <= 0) {
            return self::FAILURE;
        }

        $plan = $service->plan($userId);
        $this->info("Orders dated before 2000: {$plan->count()}");
        $this->table(['Source of the new date', 'Orders'], $plan->groupBy('source')->map(fn ($g, $k) => [$k, $g->count()])->values()->all());
        $this->table(['Order', 'New date', 'Source'], $plan->take(15)->map(fn ($p) => [
            $p['order']->platform_order_id, substr($p['new_date'], 0, 10), $p['source'],
        ])->all());

        if (! $this->option('apply')) {
            $this->warn('Dry run — nothing changed. Take a backup (backup_inventory_pgsql.sh), then re-run with --apply.');

            return self::SUCCESS;
        }

        $done = $service->apply($plan);
        $this->info("Updated {$done} order dates (audit: order.epoch_date_repaired).");

        return self::SUCCESS;
    }
}
