<?php

namespace App\Application\Services;

/**
 * Freeze historical purchase-receive shortfalls so nightly audit only
 * alerts on NEW / WORSE drift — never invents stock to "fix" the past.
 *
 * Orphans / over-posted are never baselined (always open).
 */
class PurchaseReceiveLedgerBaseline
{
    public const BASELINABLE = [
        'shortfall_zero_posted',
        'shortfall_partial',
        'legacy_morph_candidate',
    ];

    public const ALWAYS_OPEN = [
        'orphan_excess',
        'over_posted',
        'multi_sku_batch',
    ];

    public function __construct(
        private readonly ?string $pathOverride = null
    ) {}

    public function path(): string
    {
        return $this->pathOverride
            ?? storage_path('app/purchase-receive-ledger-baseline.json');
    }

    /**
     * @param  list<array<string, mixed>>  $rows
     */
    public function freeze(array $rows, array $meta = []): string
    {
        $entries = [];
        foreach ($rows as $row) {
            $cat = (string) ($row['category'] ?? '');
            if (! in_array($cat, self::BASELINABLE, true)) {
                continue;
            }
            $key = $this->fingerprint($row);
            $entries[$key] = [
                'batch_id' => (int) ($row['batch_id'] ?? 0),
                'sku_id' => (int) ($row['sku_id'] ?? 0),
                'sku_code' => (string) ($row['sku_code'] ?? ''),
                'category' => $cat,
                'expected' => (float) ($row['expected'] ?? 0),
                'posted' => (float) ($row['posted'] ?? 0),
                'delta' => (float) ($row['delta'] ?? 0),
            ];
        }

        ksort($entries);

        $payload = [
            'frozen_at' => date('c'),
            'policy' => 'Historical shortfalls frozen; do not auto-fill. Alert only on new/worse drift or any orphan.',
            'entry_count' => count($entries),
            'meta' => $meta,
            'entries' => $entries,
        ];

        $path = $this->path();
        $dir = dirname($path);
        if ($dir !== '' && $dir !== '.' && ! is_dir($dir)) {
            mkdir($dir, 0755, true);
        }
        file_put_contents(
            $path,
            json_encode($payload, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE)
        );

        return $path;
    }

    /**
     * @return array{frozen_at?: string, entry_count?: int, entries: array<string, array>}|null
     */
    public function load(): ?array
    {
        $path = $this->path();
        if (! is_file($path)) {
            return null;
        }

        $decoded = json_decode((string) file_get_contents($path), true);
        if (! is_array($decoded) || ! isset($decoded['entries']) || ! is_array($decoded['entries'])) {
            return null;
        }

        return $decoded;
    }

    /**
     * @param  array<string, mixed>  $row
     */
    public function fingerprint(array $row): string
    {
        return sprintf(
            '%d:%d:%s',
            (int) ($row['batch_id'] ?? 0),
            (int) ($row['sku_id'] ?? 0),
            (string) ($row['category'] ?? '')
        );
    }

    /**
     * Compare live classified rows against a frozen baseline.
     *
     * @param  list<array<string, mixed>>  $currentRows
     * @return array{
     *   has_baseline: bool,
     *   baseline_count: int,
     *   still_present: int,
     *   resolved: int,
     *   new_shortfalls: list<array<string, mixed>>,
     *   worse_shortfalls: list<array<string, mixed>>,
     *   open_orphans: list<array<string, mixed>>,
     *   regression_count: int
     * }
     */
    public function compare(array $currentRows): array
    {
        $baseline = $this->load();
        $entries = is_array($baseline) ? ($baseline['entries'] ?? []) : [];
        $hasBaseline = $baseline !== null;

        $openOrphans = [];
        $currentBaselined = [];

        foreach ($currentRows as $row) {
            $cat = (string) ($row['category'] ?? '');
            if (in_array($cat, self::ALWAYS_OPEN, true)) {
                $openOrphans[] = $row;
                continue;
            }
            if (! in_array($cat, self::BASELINABLE, true)) {
                continue;
            }
            $currentBaselined[$this->fingerprint($row)] = $row;
        }

        $new = [];
        $worse = [];
        $stillPresent = 0;

        foreach ($currentBaselined as $key => $row) {
            if (! $hasBaseline || ! isset($entries[$key])) {
                $new[] = $row;
                continue;
            }
            $stillPresent++;
            $baseDelta = abs((float) ($entries[$key]['delta'] ?? 0));
            $liveDelta = abs((float) ($row['delta'] ?? 0));
            if ($liveDelta > $baseDelta + 0.0001) {
                $worse[] = array_merge($row, [
                    'baseline_delta' => (float) ($entries[$key]['delta'] ?? 0),
                ]);
            }
        }

        $resolved = 0;
        if ($hasBaseline) {
            foreach (array_keys($entries) as $key) {
                if (! isset($currentBaselined[$key])) {
                    $resolved++;
                }
            }
        }

        $regressionCount = count($openOrphans) + count($new) + count($worse);

        return [
            'has_baseline' => $hasBaseline,
            'baseline_count' => count($entries),
            'still_present' => $stillPresent,
            'resolved' => $resolved,
            'new_shortfalls' => $new,
            'worse_shortfalls' => $worse,
            'open_orphans' => $openOrphans,
            'regression_count' => $regressionCount,
        ];
    }
}
