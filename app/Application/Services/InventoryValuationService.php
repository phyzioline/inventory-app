<?php

namespace App\Application\Services;

use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use App\Domain\Models\Wms\InventoryLocation;
use App\Domain\Models\Wms\Sku;
use App\Domain\Models\Wms\SkuInventory;

/**
 * Single source for warehouse inventory value (qty × effective purchase cost).
 * Channel-linked locations use {@see ChannelStockResolver}; others roll up sku_inventory rows.
 */
class InventoryValuationService
{
    public function __construct(
        private readonly ProfitEngineService $profitEngine
    ) {}

    /**
     * @return list<array{id: mixed, name: mixed, type: mixed, channel_id: mixed, total_items: int, total_quantity: float, total_cost: float}>
     */
    public function warehouseSummaryRows(): array
    {
        $locations = InventoryLocation::query()
            ->where(function ($q) {
                $q->where('is_active', true)->orWhereNull('is_active');
            })
            ->select(['id', 'name', 'type', 'channel_id'])
            ->orderBy('name')
            ->get();

        $mainStoreChannelId = ChannelStockResolver::resolveMainStoreChannelId();
        $mainStoreLocationId = $mainStoreChannelId > 0
            ? (int) (ChannelStockResolver::resolveFirstLocationIdForChannel($mainStoreChannelId) ?? 0)
            : 0;

        /** @var array<int, int> $locationIdToChannelId */
        $locationIdToChannelId = [];
        /** @var list<int> $physicalBucketLocationIds */
        $physicalBucketLocationIds = [];

        foreach ($locations as $loc) {
            $locId = (int) $loc->id;

            // المحل / physical bucket: stock sits on the location for many channel SKUs — not only store-channel listings.
            if ($this->isPhysicalBucketLocation($loc, $mainStoreLocationId)) {
                $physicalBucketLocationIds[] = $locId;

                continue;
            }

            $channelId = (int) ($loc->channel_id ?? 0);
            if ($channelId > 0) {
                $locationIdToChannelId[$locId] = $channelId;
            } else {
                $physicalBucketLocationIds[] = $locId;
            }
        }

        $channelStats = $this->summarizeChannelLinkedLocations($locationIdToChannelId);
        $tableStats = $this->summarizeFromInventoryTable($physicalBucketLocationIds);

        return $locations->map(function ($loc) use ($channelStats, $tableStats) {
            $key = (string) $loc->id;
            $stats = $channelStats[$key] ?? $tableStats[$key] ?? null;

            return [
                'id' => $loc->id,
                'name' => $loc->name,
                'type' => $loc->type,
                'channel_id' => $loc->channel_id,
                'total_items' => (int) ($stats['total_items'] ?? 0),
                'total_quantity' => round((float) ($stats['total_quantity'] ?? 0), 4),
                'total_cost' => round((float) ($stats['total_cost'] ?? 0), 2),
            ];
        })->values()->all();
    }

    /**
     * @return array{total_cost: float, total_quantity: float, total_items: int}
     */
    public function warehouseTotals(): array
    {
        $rows = $this->warehouseSummaryRows();

        return [
            'total_cost' => round(array_sum(array_column($rows, 'total_cost')), 2),
            'total_quantity' => round(array_sum(array_column($rows, 'total_quantity')), 4),
            'total_items' => (int) array_sum(array_column($rows, 'total_items')),
        ];
    }

    /**
     * @param  array<int, int>  $locationIdToChannelId
     * @return array<string, array{total_items: int, total_quantity: float, total_cost: float}>
     */
    private function summarizeChannelLinkedLocations(array $locationIdToChannelId): array
    {
        if ($locationIdToChannelId === []) {
            return [];
        }

        /** @var array<int, list<int>> $channelToLocationIds */
        $channelToLocationIds = [];
        foreach ($locationIdToChannelId as $locationId => $channelId) {
            $channelToLocationIds[$channelId][] = (int) $locationId;
        }

        $out = [];

        foreach ($channelToLocationIds as $channelId => $locationIds) {
            $skuQuery = Sku::query()
                ->with(['offer.masterProduct'])
                ->where('channel_id', $channelId);

            $this->scopeSkusToUser($skuQuery);

            $skus = $skuQuery->get();
            $masterIds = $skus
                ->map(fn (Sku $sku) => (int) ($sku->offer?->master_product_id ?? 0))
                ->filter(fn (int $id) => $id > 0)
                ->unique()
                ->values()
                ->all();

            $batchCosts = $this->profitEngine->averagePurchaseUnitCostByMasterProductIds($masterIds);

            $totalItems = 0;
            $totalQuantity = 0.0;
            $totalCost = 0.0;

            foreach ($skus as $sku) {
                $qty = ChannelStockResolver::availableQuantityForChannelSku((int) $sku->id, $channelId);
                $master = $sku->offer?->masterProduct;
                $unit = $this->profitEngine->resolveEffectiveUnitCost($master, $sku, $batchCosts);

                $totalItems += 1;
                $totalQuantity += max(0.0, $qty);
                if ($qty > 0 && $unit > 0) {
                    $totalCost += $qty * $unit;
                }
            }

            $stats = [
                'total_items' => $totalItems,
                'total_quantity' => $totalQuantity,
                'total_cost' => $totalCost,
            ];

            foreach ($locationIds as $locationId) {
                $out[(string) $locationId] = $stats;
            }
        }

        return $out;
    }

    /**
     * @param  list<int>  $locationIds
     * @return array<string, array{total_items: int, total_quantity: float, total_cost: float}>
     */
    private function summarizeFromInventoryTable(array $locationIds): array
    {
        if ($locationIds === []) {
            return [];
        }

        $inventoryTable = (new SkuInventory)->getTable();
        $hasReservedQty = Schema::hasColumn($inventoryTable, 'reserved_quantity');
        $hasReserved = Schema::hasColumn($inventoryTable, 'reserved');
        $qtyExpr = $hasReservedQty
            ? '(COALESCE(si.quantity, 0) + COALESCE(si.reserved_quantity, 0))'
            : ($hasReserved
                ? '(COALESCE(si.quantity, 0) + COALESCE(si.reserved, 0))'
                : 'COALESCE(si.quantity, 0)');

        $query = DB::table("{$inventoryTable} as si")
            ->join('skus as s', 's.id', '=', 'si.sku_id')
            ->leftJoin('inventory_offers as o', 'o.id', '=', 's.offer_id')
            ->leftJoin('master_products as mp', 'mp.id', '=', 'o.master_product_id')
            ->whereIn('si.location_id', $locationIds);

        $userId = Auth::id();
        if ($userId && Schema::hasColumn($inventoryTable, 'user_id')) {
            $query->where('si.user_id', $userId);
        }

        // Per SKU per location — matches how المحل actually holds stock (many channel listings, one physical bucket).
        $avgPurchaseSelect = Schema::hasColumn('master_products', 'avg_purchase_price')
            ? 'MAX(mp.avg_purchase_price) as mp_avg_purchase_price'
            : 'NULL as mp_avg_purchase_price';

        // Use information_schema directly to bypass Laravel's schema cache
        $skuHasLastPurchasePrice = (bool) DB::selectOne(
            "SELECT 1 FROM information_schema.columns WHERE table_name = 'skus' AND column_name = 'last_purchase_price' AND table_schema = current_schema()"
        );
        $skuLastPurchaseSelect = $skuHasLastPurchasePrice
            ? 'MAX(s.last_purchase_price) as sku_last_purchase_price'
            : 'NULL as sku_last_purchase_price';

        $mpHasLastPurchasePrice = (bool) DB::selectOne(
            "SELECT 1 FROM information_schema.columns WHERE table_name = 'master_products' AND column_name = 'last_purchase_price' AND table_schema = current_schema()"
        );
        $mpLastPurchaseSelect = $mpHasLastPurchasePrice
            ? 'MAX(mp.last_purchase_price) as mp_last_purchase_price'
            : 'NULL as mp_last_purchase_price';

        $groupByCols = ['si.location_id', 'si.sku_id', 'mp.id', 's.cost_price'];
        if ($skuHasLastPurchasePrice) {
            $groupByCols[] = 's.last_purchase_price';
        }

        $rows = $query
            ->groupBy(...$groupByCols)
            ->selectRaw("
                si.location_id,
                si.sku_id,
                mp.id as master_product_id,
                {$mpLastPurchaseSelect},
                MAX(mp.cost_price) as mp_cost_price,
                {$avgPurchaseSelect},
                MAX(s.cost_price) as sku_cost_price,
                {$skuLastPurchaseSelect},
                SUM({$qtyExpr}) as qty
            ")
            ->havingRaw("SUM({$qtyExpr}) > 0")
            ->get();

        $masterIds = $rows
            ->pluck('master_product_id')
            ->map(fn ($id) => (int) $id)
            ->filter(fn (int $id) => $id > 0)
            ->unique()
            ->values()
            ->all();

        $batchCosts = $this->profitEngine->averagePurchaseUnitCostByMasterProductIds($masterIds);

        $byLocation = [];

        foreach ($rows as $row) {
            $lid = (string) $row->location_id;
            $qty = max(0.0, (float) ($row->qty ?? 0));
            if ($qty <= 0) {
                continue;
            }

            $masterId = (int) ($row->master_product_id ?? 0);
            $master = $masterId > 0
                ? (object) [
                    'id' => $masterId,
                    'last_purchase_price' => $row->mp_last_purchase_price,
                    'cost_price' => $row->mp_cost_price,
                    'avg_purchase_price' => $row->mp_avg_purchase_price,
                ]
                : null;
            $sku = (object) [
                'cost_price' => $row->sku_cost_price,
                'last_purchase_price' => $row->sku_last_purchase_price,
            ];

            $unit = $this->profitEngine->resolveEffectiveUnitCost($master, $sku, $batchCosts);

            if (! isset($byLocation[$lid])) {
                $byLocation[$lid] = [
                    'total_items' => 0,
                    'total_quantity' => 0.0,
                    'total_cost' => 0.0,
                ];
            }

            $byLocation[$lid]['total_items'] += 1;
            $byLocation[$lid]['total_quantity'] += $qty;
            if ($unit > 0) {
                $byLocation[$lid]['total_cost'] += $qty * $unit;
            }
        }

        return $byLocation;
    }

    private function isPhysicalBucketLocation(InventoryLocation $loc, int $mainStoreLocationId): bool
    {
        $locId = (int) $loc->id;
        if ($mainStoreLocationId > 0 && $locId === $mainStoreLocationId) {
            return true;
        }

        $type = strtolower(trim((string) ($loc->type ?? '')));
        if (in_array($type, ['physical', 'shop', 'store'], true)) {
            return true;
        }

        $name = mb_strtolower(trim((string) ($loc->name ?? '')));

        return str_contains($name, 'محل')
            || str_contains($name, 'المخزن')
            || str_contains($name, 'store')
            || str_contains($name, 'shop');
    }

    private function scopeSkusToUser($query): void
    {
        $userId = Auth::id();
        if (! $userId) {
            return;
        }
        $table = (new Sku)->getTable();
        if (Schema::hasColumn($table, 'user_id')) {
            $query->where("{$table}.user_id", $userId);
        }
    }
}
