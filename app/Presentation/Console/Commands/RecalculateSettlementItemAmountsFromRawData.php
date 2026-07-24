<?php

namespace App\Presentation\Console\Commands;

use Illuminate\Console\Command;
use App\Application\Services\SettlementService;
use App\Domain\Models\Wms\Settlement;
use App\Domain\Models\Wms\SettlementItem;

class RecalculateSettlementItemAmountsFromRawData extends Command
{
    protected $signature = 'inventory:settlements-recalculate-amounts-from-raw
                            {--dry-run : List counts only; do not write to the database}
                            {--chunk=500 : Chunk size when scanning settlement_items}
                            {--user-id= : Limit to settlements owned by this user_id (optional, multi-tenant)}
                            {--reconcile : After updates, run reconcile() on each affected settlement}';

    protected $description = 'Backfill settlement_items.amount and fee_amount from stored CSV/TSV raw_data using current import rules (EG Seller Central net rows).';

    public function handle(SettlementService $settlementService): int
    {
        $dryRun = (bool) $this->option('dry-run');
        $chunk = max(50, (int) $this->option('chunk'));
        $reconcile = (bool) $this->option('reconcile');

        $scanned = 0;
        $updated = 0;
        $skipped = 0;
        $affectedSettlementIds = [];

        $query = SettlementItem::query()->whereNotNull('raw_data');
        $userIdOpt = $this->option('user-id');
        if ($userIdOpt !== null && $userIdOpt !== '' && (int) $userIdOpt > 0) {
            $userId = (int) $userIdOpt;
            $query->whereHas('settlement', function ($q) use ($userId) {
                $q->where('user_id', $userId);
            });
        }

        $query
            ->orderBy('id')
            ->chunkById($chunk, function ($items) use ($settlementService, $dryRun, &$scanned, &$updated, &$skipped, &$affectedSettlementIds) {
                foreach ($items as $item) {
                    $scanned++;
                    $raw = $item->raw_data;
                    if (! is_array($raw)) {
                        $skipped++;

                        continue;
                    }

                    $computed = $settlementService->recomputeMoneyFieldsFromStoredRawRow($raw);
                    if ($computed === null) {
                        $skipped++;

                        continue;
                    }

                    $newAmount = (float) $computed['amount'];
                    $newFee = (float) $computed['fee_amount'];
                    $oldAmount = (float) $item->amount;
                    $oldFee = (float) $item->fee_amount;

                    if (abs($newAmount - $oldAmount) < 0.005 && abs($newFee - $oldFee) < 0.005) {
                        $skipped++;

                        continue;
                    }

                    if (! $dryRun) {
                        $item->update([
                            'amount' => round($newAmount, 2),
                            'fee_amount' => round($newFee, 2),
                        ]);
                        $affectedSettlementIds[(int) $item->settlement_id] = true;
                    }
                    $updated++;
                }
            });

        if (! $dryRun && $updated > 0) {
            $this->refreshSettlementTotals(array_keys($affectedSettlementIds));
        }

        if ($reconcile && ! $dryRun && $updated > 0) {
            foreach (array_keys($affectedSettlementIds) as $settlementId) {
                $settlement = Settlement::query()->find($settlementId);
                if (! $settlement) {
                    continue;
                }
                try {
                    $settlementService->reconcile($settlement);
                } catch (\Throwable $e) {
                    $this->warn("Reconcile failed for settlement #{$settlementId}: {$e->getMessage()}");
                }
            }
        }

        $this->info(sprintf(
            'Scanned: %d | Rows that would change: %d | Skipped (XML / no raw / unchanged): %d%s',
            $scanned,
            $updated,
            $skipped,
            $dryRun ? ' [dry-run, no DB writes]' : ''
        ));

        return self::SUCCESS;
    }

    /**
     * @param  int[]  $settlementIds
     */
    private function refreshSettlementTotals(array $settlementIds): void
    {
        foreach ($settlementIds as $id) {
            $sum = (float) SettlementItem::query()->where('settlement_id', $id)->sum('amount');
            Settlement::query()->where('id', $id)->update(['total_amount' => $sum]);
        }
    }
}
