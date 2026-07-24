<?php

namespace App\Presentation\Console\Commands;

use Illuminate\Console\Command;
use App\Application\Services\ChannelStockResolver;
use App\Domain\Models\Wms\Channel;
use App\Domain\Models\Wms\Sku;

/**
 * Moves stock that was mistakenly restocked on merchant listing SKUs (merchant warehouse)
 * into the matching main-store SKU — merchant channels are virtual listings only.
 */
class ReconcileMerchantPhantomStockCommand extends Command
{
    protected $signature = 'inventory:reconcile-merchant-phantom-stock
                            {--channel= : Merchant channel id (optional; all merchant channels if omitted)}
                            {--dry-run : Report quantities without moving stock}';

    protected $description = 'Move phantom merchant-channel stock into the main store SKU/location';

    public function handle(): int
    {
        $dryRun = (bool) $this->option('dry-run');
        $channelFilter = (int) ($this->option('channel') ?: 0);

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

            $skus = Sku::query()->where('channel_id', $channelId)->with('offer')->get();
            foreach ($skus as $sku) {
                if ($dryRun) {
                    $phantom = ChannelStockResolver::availableQuantityForChannelSku((int) $sku->id, $channelId);
                    if ($phantom > 0) {
                        $this->line("  SKU {$sku->sku} (id {$sku->id}): would move {$phantom}");
                        $totalMoved += $phantom;
                        $skuCount++;
                    }

                    continue;
                }

                $moved = ChannelStockResolver::reconcilePhantomMerchantStockForListingSku($sku, $channelId);
                if ($moved > 0) {
                    $this->line("  SKU {$sku->sku} (id {$sku->id}): moved {$moved}");
                    $totalMoved += $moved;
                    $skuCount++;
                }
            }
        }

        $this->info(($dryRun ? 'Would reconcile' : 'Reconciled')." {$totalMoved} units across {$skuCount} listing SKU(s).");

        return 0;
    }
}
