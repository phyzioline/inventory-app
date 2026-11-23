<?php

namespace App\Presentation\Console\Commands;

use App\Application\Services\SettlementTotalsRepairService;
use App\Presentation\Console\Commands\Concerns\RequiresTenantUser;
use Illuminate\Console\Command;

class RepairSettlementTotalsCommand extends Command
{
    use RequiresTenantUser;

    protected $signature = 'inventory:repair-settlement-totals
                            {--user= : Inventory user_id (tenant) — required}
                            {--apply : Write the corrections (default is a dry run)}';

    protected $description = 'Fix payment-sheet totals doubled by stored summary rows, and auto receipts booked twice.';

    public function handle(SettlementTotalsRepairService $service): int
    {
        $userId = $this->requireTenantUser();
        if ($userId <= 0) {
            return self::FAILURE;
        }

        $summaryRows = $service->findSummaryRows($userId);
        $duplicates = $service->findDuplicateReceipts($userId);

        $this->info('1) Summary rows stored as lines');
        if ($summaryRows->isEmpty()) {
            $this->line('   none');
        } else {
            $this->table(
                ['Sheet', 'Report', 'Stored total', 'Transfer total', 'Lines', 'Lines gap', 'Receipt', 'Receipt change'],
                $summaryRows->map(fn ($e) => [
                    $e['settlement']->id,
                    $e['settlement']->report_id,
                    number_format($e['stored_total'], 2),
                    number_format($e['header_total'], 2),
                    number_format($e['lines_total'], 2),
                    number_format($e['header_total'] - $e['lines_total'], 2),
                    $e['receipt'] ? '#'.$e['receipt']->id.' '.number_format((float) $e['receipt']->amount, 2) : '—',
                    $e['receipt'] ? number_format($e['header_total'] - (float) $e['receipt']->amount, 2) : '—',
                ])->all()
            );
            $gaps = $summaryRows->filter(fn ($e) => abs($e['header_total'] - $e['lines_total']) >= 1);
            if ($gaps->isNotEmpty()) {
                $this->warn('   Lines do not add up to the transfer total for: '.$gaps->map(fn ($e) => $e['settlement']->report_id)->implode(', ')
                    .'. The old importer lost lines — re-upload these sheets after --apply.');
            }
        }

        $this->info('2) Auto receipts booked twice');
        if ($duplicates->isEmpty()) {
            $this->line('   none');
        } else {
            $this->table(
                ['Sheet', 'Kept receipt', 'Removed receipts', 'Amount removed'],
                $duplicates->map(fn ($d) => [
                    $d['settlement_id'],
                    '#'.$d['keep']->id.' '.number_format((float) $d['keep']->amount, 2),
                    $d['remove']->map(fn ($r) => '#'.$r->id)->implode(', '),
                    number_format((float) $d['remove']->sum('amount'), 2),
                ])->all()
            );
            $this->line('   Treasury overstated by '.number_format((float) $duplicates->sum(fn ($d) => $d['remove']->sum('amount')), 2).' EGP');
        }

        if ($summaryRows->isEmpty() && $duplicates->isEmpty()) {
            return self::SUCCESS;
        }

        if (! $this->option('apply')) {
            $this->warn('Dry run — nothing changed. Take a backup (backup_inventory_pgsql.sh), then re-run with --apply.');

            return self::SUCCESS;
        }

        $sheets = $service->applySummaryRows($summaryRows);
        $receipts = $service->applyDuplicateReceipts($duplicates);
        $this->info("Corrected {$sheets} sheet totals and removed {$receipts} duplicate receipts (audit: settlement.summary_row_removed, settlement.duplicate_auto_receipts_removed).");

        return self::SUCCESS;
    }
}
