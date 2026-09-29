<?php

namespace App\Presentation\Console\Commands;

use App\Application\Services\PurchaseImportService;
use App\Application\Services\PurchaseReceiveLedgerBaseline;
use App\Application\Support\TenantContext;
use App\Domain\Models\Wms\PurchaseBatch;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\File;

/**
 * Classify received-purchase ledger drift (dry-run — never auto-fills shortfalls).
 *
 * Historical shortfalls can be frozen once; nightly audit then only fails on
 * NEW / WORSE shortfalls or any orphan/excess.
 *
 * php artisan inventory:audit-purchase-receive-ledger
 * php artisan inventory:audit-purchase-receive-ledger --freeze-baseline
 * php artisan inventory:audit-purchase-receive-ledger --fail-on-regression
 */
class AuditPurchaseReceiveLedgerCommand extends Command
{
    protected $signature = 'inventory:audit-purchase-receive-ledger
                            {--user= : Limit to batches owned by this user_id}
                            {--batch= : Limit to one purchase_batches.id}
                            {--limit=0 : Max batches to scan (0 = all)}
                            {--csv= : Optional CSV output path}
                            {--top=30 : Print top N rows per category in the console}
                            {--freeze-baseline : Freeze current baselinable shortfalls as accepted historical debt}
                            {--fail-on-regression : Exit 1 when new/worse shortfalls or any orphan appear vs baseline}';

    protected $description = 'Classify received PO line qty vs PurchaseBatch ledger; optional baseline freeze / regression gate';

    public function handle(
        PurchaseImportService $importService,
        PurchaseReceiveLedgerBaseline $baseline
    ): int {
        $userFilter = (int) ($this->option('user') ?: 0);
        $batchFilter = (int) ($this->option('batch') ?: 0);
        $limit = (int) ($this->option('limit') ?: 0);
        $top = max(5, (int) ($this->option('top') ?: 30));
        $csvPath = $this->option('csv') ? (string) $this->option('csv') : null;
        $freeze = (bool) $this->option('freeze-baseline');
        $failOnRegression = (bool) $this->option('fail-on-regression');

        $query = PurchaseBatch::query()
            ->with(['items.sku', 'location'])
            ->where('status', 'received')
            ->when($batchFilter > 0, fn ($q) => $q->where('id', $batchFilter))
            ->when($userFilter > 0, fn ($q) => $q->where('user_id', $userFilter))
            ->orderBy('id');

        if ($limit > 0) {
            $query->limit($limit);
        }

        $batches = $query->get();
        $this->info("Scanning {$batches->count()} received batch(es)…");

        $counts = [
            'orphan_excess' => 0,
            'over_posted' => 0,
            'multi_sku_batch' => 0,
            'shortfall_zero_posted' => 0,
            'shortfall_partial' => 0,
            'legacy_morph_candidate' => 0,
        ];
        $units = [
            'orphan_excess' => 0.0,
            'over_posted' => 0.0,
            'multi_sku_batch' => 0.0,
            'shortfall_zero_posted' => 0.0,
            'shortfall_partial' => 0.0,
            'legacy_morph_candidate' => 0.0,
        ];
        $rows = [];
        $batchHits = 0;

        foreach ($batches as $batch) {
            $ownerId = (int) ($batch->user_id ?? 0);
            if ($ownerId > 0) {
                TenantContext::setOverride($ownerId);
            }

            try {
                $classified = $importService->classifyReceivedBatchLedgerDiffs($batch);
            } finally {
                if ($ownerId > 0) {
                    TenantContext::clearOverride();
                }
            }

            if ($classified === []) {
                continue;
            }

            $batchHits++;
            $locationName = (string) ($batch->location?->name ?? $batch->location_id);

            foreach ($classified as $row) {
                $cat = (string) ($row['category'] ?? 'unknown');
                if (! isset($counts[$cat])) {
                    $counts[$cat] = 0;
                    $units[$cat] = 0.0;
                }
                $counts[$cat]++;
                $units[$cat] += abs((float) ($row['delta'] ?? 0));

                $rows[] = [
                    'batch_id' => $batch->id,
                    'batch_number' => $batch->batch_number,
                    'location' => $locationName,
                    'sku_id' => $row['sku_id'] ?? '',
                    'sku_code' => $row['sku_code'] ?? '',
                    'expected' => $row['expected'] ?? 0,
                    'posted' => $row['posted'] ?? 0,
                    'delta' => $row['delta'] ?? 0,
                    'category' => $cat,
                ];
            }
        }

        $this->newLine();
        $this->info("Batches with drift: {$batchHits}");
        $this->table(
            ['Category', 'Rows', 'Abs units'],
            collect($counts)->map(fn ($n, $cat) => [
                $cat,
                $n,
                number_format($units[$cat] ?? 0, 2),
            ])->values()->all()
        );

        $this->comment('Policy: never auto-fill shortfall_* / legacy_morph_candidate (would invent stock). Use repair-received-purchase-sku-remap for orphan_excess only.');

        foreach (array_keys($counts) as $cat) {
            $sample = collect($rows)->where('category', $cat)->take($top);
            if ($sample->isEmpty()) {
                continue;
            }
            $this->newLine();
            $this->line("Top {$top} — {$cat}");
            $this->table(
                ['Batch', 'Location', 'SKU', 'Expected', 'Posted', 'Delta'],
                $sample->map(fn ($r) => [
                    $r['batch_number'],
                    $r['location'],
                    $r['sku_code'],
                    $r['expected'],
                    $r['posted'],
                    $r['delta'],
                ])->all()
            );
        }

        if ($csvPath) {
            $dir = dirname($csvPath);
            if ($dir !== '' && $dir !== '.' && ! File::isDirectory($dir)) {
                File::makeDirectory($dir, 0755, true);
            }
            $fh = fopen($csvPath, 'w');
            fputcsv($fh, ['batch_id', 'batch_number', 'location', 'sku_id', 'sku_code', 'expected', 'posted', 'delta', 'category']);
            foreach ($rows as $r) {
                fputcsv($fh, [
                    $r['batch_id'],
                    $r['batch_number'],
                    $r['location'],
                    $r['sku_id'],
                    $r['sku_code'],
                    $r['expected'],
                    $r['posted'],
                    $r['delta'],
                    $r['category'],
                ]);
            }
            fclose($fh);
            $this->info("CSV written: {$csvPath} (".count($rows).' rows)');
        }

        $baselinePath = null;
        if ($freeze) {
            $baselinePath = $baseline->freeze($rows, [
                'batches_scanned' => $batches->count(),
                'batches_with_drift' => $batchHits,
                'counts' => $counts,
                'row_count' => count($rows),
            ]);
            $this->info("Baseline frozen: {$baselinePath}");
        }

        $compare = $baseline->compare($rows);
        $this->newLine();
        if (! $compare['has_baseline']) {
            $this->warn('No baseline file yet. Run with --freeze-baseline once to cap historical shortfalls.');
        } else {
            $this->info('Baseline gate');
            $this->table(
                ['Metric', 'Value'],
                [
                    ['baseline_count', $compare['baseline_count']],
                    ['still_present', $compare['still_present']],
                    ['resolved', $compare['resolved']],
                    ['new_shortfalls', count($compare['new_shortfalls'])],
                    ['worse_shortfalls', count($compare['worse_shortfalls'])],
                    ['open_orphans', count($compare['open_orphans'])],
                    ['regression_count', $compare['regression_count']],
                ]
            );

            if ($compare['new_shortfalls'] !== []) {
                $this->warn('NEW shortfalls vs baseline (open debt growth):');
                $this->printRegressionSample($compare['new_shortfalls'], $top);
            }
            if ($compare['worse_shortfalls'] !== []) {
                $this->warn('WORSE shortfalls vs baseline:');
                $this->printRegressionSample($compare['worse_shortfalls'], $top);
            }
            if ($compare['open_orphans'] !== []) {
                $this->error('OPEN orphans / over-posted (never baselined):');
                $this->printRegressionSample($compare['open_orphans'], $top);
            }
            if ($compare['regression_count'] === 0) {
                $this->info('No regressions vs baseline — historical shortfalls capped.');
            }
        }

        $summaryPath = storage_path('logs/purchase-receive-ledger-audit-latest.json');
        File::put($summaryPath, json_encode([
            'scanned_at' => now()->toIso8601String(),
            'batches_scanned' => $batches->count(),
            'batches_with_drift' => $batchHits,
            'counts' => $counts,
            'units' => $units,
            'row_count' => count($rows),
            'baseline_path' => $baselinePath ?? $baseline->path(),
            'baseline' => [
                'has_baseline' => $compare['has_baseline'],
                'baseline_count' => $compare['baseline_count'],
                'still_present' => $compare['still_present'],
                'resolved' => $compare['resolved'],
                'new_shortfalls' => count($compare['new_shortfalls']),
                'worse_shortfalls' => count($compare['worse_shortfalls']),
                'open_orphans' => count($compare['open_orphans']),
                'regression_count' => $compare['regression_count'],
            ],
        ], JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE));
        $this->line("Summary JSON: {$summaryPath}");

        if ($failOnRegression && $compare['has_baseline'] && $compare['regression_count'] > 0) {
            $this->error("Failing: {$compare['regression_count']} regression(s) vs baseline.");

            return self::FAILURE;
        }

        // Without a baseline, fail-on-regression still blocks any orphan growth (zero-tolerance).
        if ($failOnRegression && ! $compare['has_baseline'] && count($compare['open_orphans']) > 0) {
            $this->error('Failing: orphan/excess present and no baseline to compare shortfalls.');

            return self::FAILURE;
        }

        return self::SUCCESS;
    }

    /**
     * @param  list<array<string, mixed>>  $rows
     */
    private function printRegressionSample(array $rows, int $top): void
    {
        $sample = array_slice($rows, 0, $top);
        $this->table(
            ['Batch', 'SKU', 'Category', 'Expected', 'Posted', 'Delta'],
            collect($sample)->map(fn ($r) => [
                $r['batch_number'] ?? $r['batch_id'] ?? '',
                $r['sku_code'] ?? $r['sku_id'] ?? '',
                $r['category'] ?? '',
                $r['expected'] ?? 0,
                $r['posted'] ?? 0,
                $r['delta'] ?? 0,
            ])->all()
        );
    }
}
