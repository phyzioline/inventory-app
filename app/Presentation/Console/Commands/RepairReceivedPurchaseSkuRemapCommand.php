<?php

namespace App\Presentation\Console\Commands;

use App\Application\Services\PurchaseImportService;
use App\Application\Support\TenantContext;
use App\Domain\Models\Wms\PurchaseBatch;
use App\Domain\Models\Wms\Sku;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Audit / repair received purchase batches where editing remapped a line to a new SKU
 * without reversing stock on the old SKU (double-count until the 2026-09 edit fix).
 *
 * Dry-run (default): php artisan inventory:repair-received-purchase-sku-remap
 * Apply:              php artisan inventory:repair-received-purchase-sku-remap --apply
 */
class RepairReceivedPurchaseSkuRemapCommand extends Command
{
    protected $signature = 'inventory:repair-received-purchase-sku-remap
                            {--apply : Write stock corrections (default is dry-run audit only)}
                            {--also-fill-shortfalls : Also ADD stock where lines claim more than the batch ledger (dangerous on legacy receives — off by default)}
                            {--batch= : Limit to one purchase_batches.id}
                            {--user= : Limit to batches owned by this user_id}
                            {--limit=0 : Max batches to process (0 = all)}';

    protected $description = 'Audit/repair orphan stock left on old SKUs after received-purchase line remaps (default: remove excess only)';

    public function handle(PurchaseImportService $importService): int
    {
        $apply = (bool) $this->option('apply');
        $dryRun = ! $apply;
        $fillShortfalls = (bool) $this->option('also-fill-shortfalls');
        $batchFilter = (int) ($this->option('batch') ?: 0);
        $userFilter = (int) ($this->option('user') ?: 0);
        $limit = (int) ($this->option('limit') ?: 0);

        $query = PurchaseBatch::query()
            ->with(['items.sku', 'location'])
            ->where('status', 'received')
            ->whereNotNull('location_id')
            ->when($batchFilter > 0, fn ($q) => $q->where('id', $batchFilter))
            ->when($userFilter > 0, fn ($q) => $q->where('user_id', $userFilter))
            ->orderBy('id');

        if ($limit > 0) {
            $query->limit($limit);
        }

        $batches = $query->get();
        if ($batches->isEmpty()) {
            $this->warn('No received purchase batches matched.');

            return self::SUCCESS;
        }

        $mode = $fillShortfalls ? 'orphans + shortfalls' : 'orphans/excess only';
        $this->info(($dryRun ? 'DRY-RUN audit' : 'APPLYING repair')." ({$mode}) across {$batches->count()} received batch(es).");
        if (! $fillShortfalls) {
            $this->comment('Positive deltas (lines claim stock never posted on this batch) are listed as skipped — use --also-fill-shortfalls only if intentional.');
        }

        $tableRows = [];
        $batchHits = 0;
        $changeCount = 0;
        $skippedShortfalls = 0;
        $errorCount = 0;
        $orphanUnits = 0.0;
        $missingUnits = 0.0;

        foreach ($batches as $batch) {
            $ownerId = (int) ($batch->user_id ?? 0);
            if ($ownerId > 0) {
                TenantContext::setOverride($ownerId);
            }

            try {
                $diffs = $importService->diffReceivedBatchStockVsLines($batch);
                if ($diffs === []) {
                    continue;
                }

                $actionable = [];
                foreach ($diffs as $diff) {
                    $delta = (float) ($diff['delta'] ?? 0);
                    // Default safe mode: only remove excess/orphan ledger stock (posted > expected).
                    if ($delta < -0.0000001) {
                        $actionable[] = $diff;
                        continue;
                    }
                    if ($fillShortfalls && $delta > 0.0000001) {
                        $actionable[] = $diff;
                        continue;
                    }
                    if ($delta > 0.0000001) {
                        $skippedShortfalls++;
                    }
                }

                if ($actionable === []) {
                    continue;
                }

                $result = $dryRun
                    ? [
                        'batch_id' => (int) $batch->id,
                        'batch_number' => (string) ($batch->batch_number ?? $batch->id),
                        'dry_run' => true,
                        'changes' => array_map(
                            fn (array $d) => array_merge($d, ['status' => 'would_fix']),
                            $actionable
                        ),
                    ]
                    : DB::transaction(function () use ($importService, $batch, $actionable) {
                        return $importService->repairReceivedBatchStockToMatchLines(
                            $batch,
                            false,
                            $actionable
                        );
                    });
            } catch (\Throwable $e) {
                $errorCount++;
                $this->error("Batch {$batch->batch_number} (#{$batch->id}): ".$e->getMessage());

                continue;
            } finally {
                if ($ownerId > 0) {
                    TenantContext::clearOverride();
                }
            }

            $changes = $result['changes'] ?? [];
            if ($changes === []) {
                continue;
            }

            $batchHits++;
            $locationName = (string) ($batch->location?->name ?? $batch->location_id);

            foreach ($changes as $change) {
                $changeCount++;
                $delta = (float) ($change['delta'] ?? 0);
                if ($delta < 0) {
                    $orphanUnits += abs($delta);
                } else {
                    $missingUnits += $delta;
                }
                if (($change['status'] ?? '') === 'error') {
                    $errorCount++;
                }

                $masterName = $this->masterNameForSku((int) ($change['sku_id'] ?? 0));

                $tableRows[] = [
                    $batch->batch_number,
                    $locationName,
                    $change['sku_code'] ?? '',
                    $masterName,
                    number_format((float) ($change['expected'] ?? 0), 2, '.', ''),
                    number_format((float) ($change['posted'] ?? 0), 2, '.', ''),
                    number_format($delta, 2, '.', ''),
                    $change['status'] ?? '',
                    $change['error'] ?? '',
                ];
            }
        }

        if ($tableRows === []) {
            $this->info('No orphan/excess SKU remap stock found to repair.');
            if ($skippedShortfalls > 0) {
                $this->comment("Skipped shortfall rows (not orphans): {$skippedShortfalls}");
            }

            return self::SUCCESS;
        }

        $this->table(
            ['Batch', 'Location', 'SKU', 'Product', 'Expected', 'Posted', 'Delta', 'Status', 'Error'],
            $tableRows
        );

        $this->newLine();
        $this->info("Batches with orphan/excess drift: {$batchHits}");
        $this->info("SKU adjustments: {$changeCount}");
        $this->info('Orphan/excess units to remove: '.number_format($orphanUnits, 2));
        if ($fillShortfalls) {
            $this->info('Missing units to add: '.number_format($missingUnits, 2));
        }
        if ($skippedShortfalls > 0) {
            $this->comment("Skipped shortfall rows (lines claim stock not on this batch ledger): {$skippedShortfalls}");
        }
        if ($errorCount > 0) {
            $this->warn("Errors: {$errorCount} (often sold/transferred stock no longer on hand for reverse)");
        }

        if ($dryRun) {
            $this->comment('Re-run with --apply to write corrections.');
        }

        return $errorCount > 0 && $apply ? self::FAILURE : self::SUCCESS;
    }

    private function masterNameForSku(int $skuId): string
    {
        if ($skuId <= 0) {
            return '';
        }

        $sku = Sku::query()->with('offer.masterProduct')->find($skuId);

        return (string) (
            $sku?->offer?->masterProduct?->internal_name
            ?? $sku?->offer?->name
            ?? ''
        );
    }
}
