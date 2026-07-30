<?php

declare(strict_types=1);

namespace App\Infrastructure\Support;

use App\Domain\Events\StockUpdated;
use App\Domain\Models\Wms\InventoryLocation;
use App\Domain\Models\Wms\Sku;
use App\Domain\Models\Wms\SkuInventory;
use Illuminate\Support\Facades\Log;

final class StockUpdateBroadcaster
{
    public static function dispatch(int $skuId, int $warehouseId, string $type): void
    {
        if (config('broadcasting.default') === 'log' || config('broadcasting.default') === 'null') {
            return;
        }

        $sku = Sku::query()->with('offer:id,master_product_id')->find($skuId);
        $productId = (int) ($sku?->offer?->master_product_id ?? $skuId);

        $quantity = (int) round((float) SkuInventory::query()
            ->where('sku_id', $skuId)
            ->where('location_id', $warehouseId)
            ->value('quantity'));

        $userId = (int) (InventoryLocation::withoutGlobalScope('user_isolation')
            ->where('id', $warehouseId)
            ->value('user_id') ?? auth()->id() ?? 0);

        if ($userId <= 0) {
            return;
        }

        self::safeBroadcast(new StockUpdated($productId, $warehouseId, $quantity, $type, $userId));
    }

    /**
     * One lightweight ping so open channel/KPI pages refetch (batch imports, catalog edits).
     */
    public static function notifyUser(int $userId, string $type = 'adjust'): void
    {
        if ($userId <= 0) {
            return;
        }
        if (config('broadcasting.default') === 'log' || config('broadcasting.default') === 'null') {
            return;
        }

        self::safeBroadcast(new StockUpdated(0, 0, 0, $type, $userId));
    }

    /**
     * Real-time stock pings must never roll back purchases, transfers, or imports when
     * Reverb/Pusher is misconfigured or down (production incident 2026-07-29).
     */
    private static function safeBroadcast(StockUpdated $event): void
    {
        try {
            event($event);
        } catch (\Throwable $e) {
            Log::warning('Stock broadcast failed (non-fatal)', [
                'error' => $e->getMessage(),
                'user_id' => $event->userId,
                'warehouse_id' => $event->warehouseId,
                'type' => $event->type,
            ]);
        }
    }

    /**
     * @param  array<int, array{sku_id: int, location_id: int}>  $pairs
     */
    public static function broadcastTransferPairs(array $pairs): void
    {
        $seen = [];
        foreach ($pairs as $pair) {
            $skuId = (int) ($pair['sku_id'] ?? 0);
            $locationId = (int) ($pair['location_id'] ?? 0);
            if ($skuId <= 0 || $locationId <= 0) {
                continue;
            }
            $key = $skuId.':'.$locationId;
            if (isset($seen[$key])) {
                continue;
            }
            $seen[$key] = true;
            self::dispatch($skuId, $locationId, 'transfer');
        }
    }

    public static function mapReferenceType(string $referenceType): string
    {
        return match (strtoupper($referenceType)) {
            'ORDER', 'SALE' => 'sale',
            'TRANSFER' => 'transfer',
            'PURCHASE', 'RECEIVE', 'PURCHASE_BATCH' => 'receive',
            default => 'adjust',
        };
    }
}
