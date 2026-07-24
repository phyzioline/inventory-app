<?php

namespace App\Presentation\Console\Commands;

use Illuminate\Console\Command;
use App\Application\Services\SettlementService;
use App\Domain\Models\Wms\Settlement;
use App\Domain\Models\Wms\SettlementItem;

class ReconcileSettlementsCommand extends Command
{
    protected $signature = 'inventory:reconcile-settlements
                            {--settlement= : Single settlement id (settlements.id)}
                            {--channel-id= : Limit to a channel id}
                            {--from= : Start date (Y-m-d) filter on settlements.start_date}
                            {--to= : End date (Y-m-d) filter on settlements.end_date}
                            {--only-unmatched : Reconcile only settlements that still have unreconciled lines}
                            {--dry-run : Print settlement ids that would be reconciled, without writing}';

    protected $description = 'Re-run settlement reconcile using stored settlement_items (no file re-import).';

    public function handle(SettlementService $settlementService): int
    {
        $dryRun = (bool) $this->option('dry-run');
        $onlyUnmatched = (bool) $this->option('only-unmatched');

        $settlementOpt = $this->option('settlement');
        $channelIdOpt = $this->option('channel-id');
        $fromOpt = $this->option('from');
        $toOpt = $this->option('to');

        $q = Settlement::query()->orderBy('id');

        if ($settlementOpt !== null && $settlementOpt !== '' && (int) $settlementOpt > 0) {
            $q->where('id', (int) $settlementOpt);
        }

        if ($channelIdOpt !== null && $channelIdOpt !== '' && (int) $channelIdOpt > 0) {
            $q->where('channel_id', (int) $channelIdOpt);
        }

        if ($fromOpt !== null && trim((string) $fromOpt) !== '') {
            $q->whereDate('start_date', '>=', trim((string) $fromOpt));
        }
        if ($toOpt !== null && trim((string) $toOpt) !== '') {
            $q->whereDate('end_date', '<=', trim((string) $toOpt));
        }

        if ($onlyUnmatched) {
            $q->whereIn('id', function ($sub) {
                $sub->select('settlement_id')
                    ->from((new SettlementItem)->getTable())
                    ->where('reconciliation_status', 'unreconciled');
            });
        }

        $ids = $q->pluck('id')->values();
        $total = $ids->count();

        if ($total === 0) {
            $this->warn('No settlements found for given filters.');

            return self::SUCCESS;
        }

        $this->info("Settlements to reconcile: {$total}".($dryRun ? ' (dry run)' : ''));

        $n = 0;
        $totalMatched = 0;
        foreach ($ids as $id) {
            $id = (int) $id;
            if ($id <= 0) {
                continue;
            }
            if ($dryRun) {
                $this->line("  [dry-run] would reconcile settlement_id={$id}");
                $n++;

                continue;
            }

            $settlement = Settlement::query()->find($id);
            if (! $settlement) {
                continue;
            }
            $matched = $settlementService->reconcile($settlement);
            $totalMatched += (int) $matched;
            $n++;
        }

        if (! $dryRun) {
            $this->info("Done. Reconciled {$n} settlement(s). Newly matched lines: {$totalMatched}.");
        } else {
            $this->info("Dry run finished. {$n} settlement(s) would be reconciled.");
        }

        return self::SUCCESS;
    }
}
