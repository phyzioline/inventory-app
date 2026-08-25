<?php

namespace App\Application\Services;

use App\Application\Support\TenantContext;
use App\Domain\Models\Wms\InventoryRemovalItem;
use App\Domain\Models\Wms\InventoryTransaction;
use App\Domain\Models\Wms\Sku;
use App\Domain\Models\Wms\SkuInventory;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Deducts FBA warehouse stock when Amazon removal units have physically left the FC.
 * Idempotent on inventory_transactions (reference_type=Removal, type=OUT, same item id).
 * Never lets the FBA balance go negative.
 */
class RemovalFbaBalanceService
{
    public function resolveFbaLocationIdForSku(Sku $listingSku, int $channelId): ?int
    {
        if ((int) $listingSku->id <= 0 || $channelId <= 0) {
            return null;
        }

        $locationIds = ChannelStockResolver::resolveChannelStockLocationIdsForSku($listingSku, $channelId);
        if ($locationIds === []) {
            return null;
        }

        $best = (int) (SkuInventory::query()
            ->where('sku_id', $listingSku->id)
            ->whereIn('location_id', $locationIds)
            ->orderByDesc('quantity')
            ->value('location_id') ?? 0);

        return $best > 0 ? $best : (int) $locationIds[0];
    }

    /**
     * @return array{deducted: int, location_id: int|null, skipped: string|null}
     */
    public function deductForReceivedItem(
        InventoryRemovalItem $item,
        Sku $listingSku,
        int $qty,
        ?Carbon $movementAt = null,
        bool $dryRun = false,
    ): array {
        $empty = ['deducted' => 0, 'location_id' => null, 'skipped' => null];

        if ($qty <= 0) {
            $empty['skipped'] = 'qty';

            return $empty;
        }

        $channelId = (int) ($listingSku->channel_id ?? 0);
        if ($channelId <= 0 || ! ChannelStockResolver::isFbaChannel($channelId)) {
            $empty['skipped'] = 'not_fba';

            return $empty;
        }

        $alreadyOut = InventoryTransaction::query()
            ->where('reference_type', 'Removal')
            ->where('reference_id', (string) $item->id)
            ->where('type', 'OUT')
            ->exists();
        if ($alreadyOut) {
            $empty['skipped'] = 'already_deducted';

            return $empty;
        }

        $fbaLocationId = $this->resolveFbaLocationIdForSku($listingSku, $channelId);
        if (! $fbaLocationId) {
            $empty['skipped'] = 'no_fba_location';

            return $empty;
        }

        $ownerId = (int) ($item->user_id ?? $listingSku->user_id ?? 0);
        $movementAt = $movementAt ?: ($item->received_at instanceof Carbon ? $item->received_at : null);

        $apply = function () use ($item, $listingSku, $qty, $fbaLocationId, $ownerId, $movementAt, $dryRun): array {
            $fbaInvQuery = SkuInventory::query()
                ->where('sku_id', $listingSku->id)
                ->where('location_id', $fbaLocationId);
            if (! $dryRun) {
                $fbaInvQuery->lockForUpdate();
            }
            $fbaInv = $fbaInvQuery->first();

            $deducted = $fbaInv ? min($qty, max(0, (int) $fbaInv->quantity)) : 0;
            if ($deducted <= 0) {
                return [
                    'deducted' => 0,
                    'location_id' => $fbaLocationId,
                    'skipped' => $fbaInv ? 'zero_fba_balance' : 'no_fba_row',
                ];
            }

            if ($dryRun) {
                return [
                    'deducted' => $deducted,
                    'location_id' => $fbaLocationId,
                    'skipped' => null,
                ];
            }

            $fbaInv->decrement('quantity', $deducted);

            $tx = new InventoryTransaction([
                'sku_id' => $listingSku->id,
                'location_id' => $fbaLocationId,
                'type' => 'OUT',
                'quantity' => $deducted,
                'reference_type' => 'Removal',
                'reference_id' => (string) $item->id,
                'notes' => 'Amazon removal received: FBA balance reduced ('.($item->removalOrder?->removal_order_id ?? '-').')',
                'user_id' => $ownerId > 0 ? $ownerId : null,
            ]);
            if ($movementAt) {
                $tx->created_at = $movementAt;
                $tx->updated_at = $movementAt;
            }
            $tx->save();

            return [
                'deducted' => $deducted,
                'location_id' => $fbaLocationId,
                'skipped' => null,
            ];
        };

        if ($dryRun) {
            return $apply();
        }

        if ($ownerId > 0) {
            TenantContext::setOverride($ownerId);
        }
        try {
            return DB::transaction($apply);
        } finally {
            if ($ownerId > 0) {
                TenantContext::clearOverride();
            }
        }
    }
}
