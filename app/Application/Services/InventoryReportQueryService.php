<?php

namespace App\Application\Services;

use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;
use App\Domain\Models\Wms\Sku;

class InventoryReportQueryService
{
    /**
     * @return Collection<int, Sku>
     */
    public function marginAlerts(int $userId, float $thresholdPercent = 20.0): Collection
    {
        if ($userId <= 0) {
            return collect();
        }

        return Sku::query()
            ->leftJoin('inventory_offers', 'inventory_offers.id', '=', 'skus.offer_id')
            ->where('skus.user_id', $userId)
            ->whereNotNull('skus.selling_price')
            ->whereNotNull('skus.cost_price')
            ->where('skus.selling_price', '>', 0)
            ->whereRaw(
                '((skus.selling_price - skus.cost_price) / skus.selling_price) * 100 < ?',
                [$thresholdPercent]
            )
            ->select(
                'skus.id',
                'skus.sku as code',
                DB::raw('COALESCE(inventory_offers.name, skus.sku) as name'),
                'skus.selling_price',
                'skus.cost_price',
                DB::raw('((skus.selling_price - skus.cost_price) / skus.selling_price) * 100 as margin_percent')
            )
            ->orderByRaw('((skus.selling_price - skus.cost_price) / skus.selling_price) * 100 asc')
            ->get();
    }

    /**
     * @return Collection<int, object>
     */
    public function returnRates(int $userId): Collection
    {
        if ($userId <= 0) {
            return collect();
        }

        $sold = DB::table('inventory_order_items')
            ->join('inventory_orders', 'inventory_orders.id', '=', 'inventory_order_items.inventory_order_id')
            ->where('inventory_orders.user_id', $userId)
            ->select('sku_id', DB::raw('SUM(quantity) as total_sold'))
            ->groupBy('sku_id');

        $returned = DB::table('inventory_returns')
            ->join('inventory_orders', 'inventory_returns.inventory_order_id', '=', 'inventory_orders.id')
            ->join('inventory_order_items', 'inventory_orders.id', '=', 'inventory_order_items.inventory_order_id')
            ->where('inventory_returns.user_id', $userId)
            ->where('inventory_orders.user_id', $userId)
            ->where('inventory_returns.status', '!=', 'rejected')
            ->select('inventory_order_items.sku_id', DB::raw('SUM(inventory_order_items.quantity) as total_returned'))
            ->groupBy('inventory_order_items.sku_id');

        return Sku::query()
            ->joinSub($sold, 'sold', function ($join) {
                $join->on('skus.id', '=', 'sold.sku_id');
            })
            ->leftJoin('inventory_offers', 'inventory_offers.id', '=', 'skus.offer_id')
            ->leftJoinSub($returned, 'returned', function ($join) {
                $join->on('skus.id', '=', 'returned.sku_id');
            })
            ->where('skus.user_id', $userId)
            ->select(
                'skus.id',
                'skus.sku as code',
                DB::raw('COALESCE(inventory_offers.name, skus.sku) as name'),
                'sold.total_sold',
                DB::raw('COALESCE(returned.total_returned, 0) as total_returned'),
                DB::raw('CASE WHEN sold.total_sold > 0 THEN (COALESCE(returned.total_returned, 0)::numeric / sold.total_sold) * 100 ELSE 0 END as return_rate')
            )
            ->orderByDesc('return_rate')
            ->get();
    }
}
