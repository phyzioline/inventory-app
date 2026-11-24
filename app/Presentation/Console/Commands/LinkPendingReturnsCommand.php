<?php

namespace App\Presentation\Console\Commands;

use App\Application\Services\PendingReturnReceiptService;
use App\Presentation\Console\Commands\Concerns\RequiresTenantUser;
use Illuminate\Console\Command;

class LinkPendingReturnsCommand extends Command
{
    use RequiresTenantUser;

    protected $signature = 'inventory:link-pending-returns
                            {--user= : Inventory user_id (tenant) — required}
                            {--apply : Close the linked claim markers (default is a dry run)}';

    protected $description = 'Close refunded-but-pending returns whose unit is already received on another return of the same order.';

    public function handle(PendingReturnReceiptService $service): int
    {
        $userId = $this->requireTenantUser();
        if ($userId <= 0) {
            return self::FAILURE;
        }

        $before = $service->summary($userId);
        $links = $service->findLinkable($userId);

        $this->info(sprintf('Awaiting receipt now: %d returns, %s EGP refunded, %d older than %d days.',
            $before['count'], number_format($before['refund_total'], 2), $before['overdue'], $before['overdue_days']));
        $this->info(sprintf('Linkable to a received return of the same order: %d', $links->count()));

        $this->table(['Month', 'Linkable'], $links
            ->groupBy(fn ($l) => optional($l['pending']->return_date ?? $l['pending']->created_at)->format('Y-m'))
            ->map(fn ($rows, $m) => [$m, $rows->count()])
            ->sortKeys()->values()->all());

        if (! $this->option('apply')) {
            $this->warn('Dry run — nothing changed. Take a backup (backup_inventory_pgsql.sh), then re-run with --apply.');

            return self::SUCCESS;
        }

        $done = $service->applyLinks($links);
        $after = $service->summary($userId);
        $this->info("Linked {$done} (audit: return.claim_marker_linked_to_received). Still awaiting receipt: {$after['count']}.");

        return self::SUCCESS;
    }
}
