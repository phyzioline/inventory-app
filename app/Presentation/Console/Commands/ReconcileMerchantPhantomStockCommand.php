<?php

namespace App\Presentation\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use App\Application\Services\ChannelStockResolver;
use App\Application\Services\StockRehomeTransferService;
use App\Domain\Models\Wms\Channel;
use App\Domain\Models\Wms\Sku;

/**
 * Moves stock that was mistakenly restocked on merchant listing SKUs (merchant warehouse)
 * into the matching main-store SKU — merchant channels are virtual listings only.
 * Writes TRANSFER ledger rows so الترحيلات / تتبع الحركة show the move.
 */
class ReconcileMerchantPhantomStockCommand extends Command
{
    protected $signature = 'inventory:reconcile-merchant-phantom-stock
                            {--channel= : Merchant channel id (optional; all merchant channels if omitted)}
                            {--user= : Only SKUs owned by this user id}
                            {--dry-run : Report quantities without moving stock}';

    protected $description = 'Move phantom merchant-channel stock into the main store SKU/location (with transfer ledger)';

    public function handle(StockRehomeTransferService $rehome): int
    {
        $dryRun = (bool) $this->option('dry-run');
        $channelFilter = (int) ($this->option('channel') ?: 0);
        $userFilter = (int) ($this->option('user') ?: 0);

        $channels = Channel::query()
            ->when($channelFilter > 0, fn ($q) => $q->where('id', $channelFilter))
            ->get(['id', 'name', 'slug', 'type']);

        $merchantChannels = $channels->filter(
            fn (Channel $c) => ChannelStockResolver::isMerchantChannelModel($c)
        );

        if ($merchantChannels->isEmpty()) {
            $this->warn('No merchant channels matched.');

            return 0;
        }

        $totalMoved = 0.0;
        $skuCount = 0;

        foreach ($merchantChannels as $channel) {
            $channelId = (int) $channel->id;
            $this->line("Channel #{$channelId} — {$channel->name}");

            $skus = Sku::query()
                ->where('channel_id', $channelId)
                ->when($userFilter > 0, fn ($q) => $q->where('user_id', $userFilter))
                ->with('offer')
                ->get();

            foreach ($skus as $sku) {
                if ($dryRun) {
                    $phantom = ChannelStockResolver::availableQuantityForChannelSku((int) $sku->id, $channelId);
                    if ($phantom > 0) {
                        $storeId = ChannelStockResolver::resolveStoreSkuIdForListingSku($sku);
                        $storeCode = $storeId ? (string) (Sku::query()->where('id', $storeId)->value('sku') ?? '') : 'NONE';
                        $this->line("  SKU {$sku->sku} (id {$sku->id}): would move {$phantom} → store {$storeCode}");
                        $totalMoved += $phantom;
                        $skuCount++;
                    }

                    continue;
                }

                $moved = 0.0;
                $ownerId = (int) ($sku->user_id ?? 0);
                DB::transaction(function () use ($rehome, $sku, $channelId, $ownerId, &$moved) {
                    if ($ownerId > 0) {
                        \App\Application\Support\TenantContext::setOverride($ownerId);
                    }
                    try {
                        $result = $rehome->reconcilePhantomMerchantStockWithLedger($sku, $channelId);
                        $moved = (float) ($result['moved'] ?? 0);
                    } finally {
                        if ($ownerId > 0) {
                            \App\Application\Support\TenantContext::clearOverride();
                        }
                    }
                });

                if ($moved > 0) {
                    $storeCode = ChannelStockResolver::resolveStoreSkuIdForListingSku($sku);
                    $code = $storeCode ? (string) (Sku::query()->where('id', $storeCode)->value('sku') ?? '') : '';
                    $this->line("  SKU {$sku->sku} (id {$sku->id}): moved {$moved} → store {$code}");
                    $totalMoved += $moved;
                    $skuCount++;
                }
            }
        }

        $this->info(($dryRun ? 'Would reconcile' : 'Reconciled')." {$totalMoved} units across {$skuCount} listing SKU(s).");

        return 0;
    }
}
