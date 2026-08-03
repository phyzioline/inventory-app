<?php

namespace App\Presentation\Console\Commands;

use App\Support\InventoryQueueGuard;
use Illuminate\Console\Command;

/**
 * Ops heartbeat: detect a missing inventory queue worker and fail stale
 * marketplace async import jobs so the SPA never polls forever.
 */
class EnsureInventoryQueueHealthyCommand extends Command
{
    protected $signature = 'inventory:ensure-queue-healthy';

    protected $description = 'Verify inventory queue worker is alive and fail stale marketplace import jobs';

    public function handle(): int
    {
        $report = InventoryQueueGuard::sweepStaleJobs();

        $this->info(sprintf(
            'worker_alive=%s pending=%d stale_failed=%d',
            $report['worker_alive'] ? 'yes' : 'no',
            $report['pending'],
            $report['failed']
        ));

        if (! $report['worker_alive'] && $report['pending'] > 0) {
            $this->error('Queue worker is DOWN with pending jobs. Start: systemctl start inventory-queue');

            return self::FAILURE;
        }

        if (! $report['worker_alive']) {
            $this->warn('Queue worker process not found. Ensure: systemctl enable --now inventory-queue');

            return self::FAILURE;
        }

        return self::SUCCESS;
    }
}
