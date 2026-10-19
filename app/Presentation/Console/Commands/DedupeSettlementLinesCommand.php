<?php

namespace App\Presentation\Console\Commands;

use App\Application\Services\SettlementCrossSheetDuplicateService;
use App\Presentation\Console\Commands\Concerns\RequiresTenantUser;
use Illuminate\Console\Command;

class DedupeSettlementLinesCommand extends Command
{
    use RequiresTenantUser;

    protected $signature = 'inventory:dedupe-settlement-lines
                            {--user= : Inventory user_id (tenant) — required}
                            {--apply : Delete the duplicate copies (default is a dry run)}';

    protected $description = 'Remove settlement lines posted twice through overlapping statements of the same channel.';

    public function handle(SettlementCrossSheetDuplicateService $service): int
    {
        $userId = $this->requireTenantUser();
        if ($userId <= 0) {
            return self::FAILURE;
        }

        $duplicates = $service->findDuplicates($userId);
        if ($duplicates->isEmpty()) {
            $this->info('No cross-sheet duplicate lines.');

            return self::SUCCESS;
        }

        $this->table(
            ['Sheet', 'Report', 'Channel', 'Duplicate lines', 'Amount'],
            $duplicates->groupBy('settlement_id')->map(fn ($rows, $sid) => [
                $sid,
                $rows->first()->report_id,
                $rows->first()->channel_id,
                $rows->count(),
                number_format((float) $rows->sum('amount'), 2),
            ])->values()->all()
        );
        $this->line(sprintf('Total: %d lines, %s EGP', $duplicates->count(), number_format((float) $duplicates->sum('amount'), 2)));

        if (! $this->option('apply')) {
            $this->warn('Dry run — re-run with --apply to delete. Sheet totals and treasury receipts are not changed.');

            return self::SUCCESS;
        }

        $removed = $service->remove($duplicates);
        $this->info("Removed {$removed} duplicate lines (audit log: settlement.cross_sheet_duplicates_removed).");

        return self::SUCCESS;
    }
}
