<?php

namespace App\Presentation\Console\Commands;

use App\Application\Services\ChannelStockResolver;
use App\Application\Services\RemovalFbaBalanceService;
use App\Domain\Models\Wms\InventoryRemovalItem;
use App\Domain\Models\Wms\Sku;
use Illuminate\Console\Command;

/**
 * Historical Amazon removal receipts credited the shop (or the listing SKU at the shop
 * location) but never reduced the FBA warehouse balance. Going-forward receive() now
 * deducts FBA; this command applies the same deduction to already-received lines.
 *
 * Idempotent: skips items that already have a Removal OUT transaction.
 * Never drives FBA quantity negative (clamps to available).
 *
 * Run: php artisan inventory:backfill-removal-fba-deductions --dry-run
 *      php artisan inventory:backfill-removal-fba-deductions
 */
class BackfillRemovalFbaDeductionsCommand extends Command
{
    protected $signature = 'inventory:backfill-removal-fba-deductions
        {--user= : Limit to a specific user_id}
        {--dry-run : Preview without writing}';

    protected $description = 'Deduct FBA warehouse stock for historically received Amazon removal items';

    public function handle(RemovalFbaBalanceService $fbaBalance): int
    {
        ChannelStockResolver::clearCache();

        $userId = $this->option('user');
        $dryRun = (bool) $this->option('dry-run');

        $query = InventoryRemovalItem::query()
            ->with('removalOrder')
            ->where('receive_status', 'received')
            ->where('received_quantity', '>', 0)
            ->orderBy('id');

        if ($userId !== null && $userId !== '') {
            $query->where('user_id', (int) $userId);
        }

        $items = $query->get();
        if ($items->isEmpty()) {
            $this->info('No received removal items to backfill.');

            return self::SUCCESS;
        }

        $this->info(($dryRun ? '[dry-run] ' : '').'Received items: '.$items->count());

        $fixed = 0;
        $units = 0;
        $skipped = 0;

        foreach ($items as $item) {
            $qty = (int) $item->received_quantity;
            $listingSku = $this->resolveListingSku($item);
            if (! $listingSku) {
                $skipped++;
                $this->warn("  item#{$item->id} sku {$item->sku_code}: listing SKU not found");

                continue;
            }

            $result = $fbaBalance->deductForReceivedItem(
                $item,
                $listingSku,
                $qty,
                $item->received_at,
                $dryRun,
            );

            if (($result['skipped'] ?? null) !== null || (int) $result['deducted'] <= 0) {
                $skipped++;
                $reason = $result['skipped'] ?? 'zero';
                $this->line(sprintf(
                    '  skip item#%d [%s / %s] qty=%d (%s)',
                    $item->id,
                    $item->removalOrder?->removal_order_id ?? '-',
                    $item->sku_code,
                    $qty,
                    $reason,
                ));

                continue;
            }

            $fixed++;
            $units += (int) $result['deducted'];
            $this->line(sprintf(
                '  %s item#%d [%s / %s]  FBA -%d (loc %s)',
                $dryRun ? 'would fix' : 'fixed',
                $item->id,
                $item->removalOrder?->removal_order_id ?? '-',
                $item->sku_code,
                (int) $result['deducted'],
                $result['location_id'] ?? '-',
            ));
        }

        $this->info(($dryRun ? 'Would fix' : 'Fixed').": {$fixed} items / {$units} units  (skipped: {$skipped})");

        return self::SUCCESS;
    }

    private function resolveListingSku(InventoryRemovalItem $item): ?Sku
    {
        $code = trim((string) ($item->sku_code ?? ''));
        if ($code === '') {
            return null;
        }

        $query = Sku::query()->with(['offer', 'channel'])->where('sku', $code);
        $ownerId = (int) ($item->user_id ?? 0);
        if ($ownerId > 0) {
            $query->where('user_id', $ownerId);
        }

        return $query->orderBy('id')->first();
    }
}
