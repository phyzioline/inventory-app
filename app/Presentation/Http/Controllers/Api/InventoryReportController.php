<?php

namespace App\Presentation\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use App\Application\Services\InventoryReportQueryService;
use App\Domain\Models\Wms\Sku;

class InventoryReportController extends Controller
{
    public function __construct(
        private readonly InventoryReportQueryService $reports
    ) {}

    /**
     * Get dead stock report (items with stock > 0 but no sales in X days).
     */
    public function deadStock(Request $request)
    {
        $userId = (int) ($request->user()?->id ?? 0);
        if ($userId <= 0) {
            return response()->json([]);
        }

        $days = $request->input('days', 90);
        $thresholdDate = \Carbon\Carbon::now()->subDays($days);

        $recentSales = \Illuminate\Support\Facades\DB::table('inventory_order_items')
            ->join('inventory_orders', 'inventory_orders.id', '=', 'inventory_order_items.inventory_order_id')
            ->where('inventory_orders.user_id', $userId)
            ->where('inventory_orders.order_date', '>=', $thresholdDate)
            ->select('sku_id', \Illuminate\Support\Facades\DB::raw('SUM(quantity) as sold_qty'))
            ->groupBy('sku_id');

        $deadStock = Sku::join('sku_inventory', 'skus.id', '=', 'sku_inventory.sku_id')
            ->leftJoin('inventory_offers', 'inventory_offers.id', '=', 'skus.offer_id')
            ->leftJoinSub($recentSales, 'sales', function ($join) {
                $join->on('skus.id', '=', 'sales.sku_id');
            })
            ->where('sku_inventory.quantity', '>', 0)
            ->whereNull('sales.sold_qty')
            ->select(
                'skus.id',
                'skus.sku as code',
                \Illuminate\Support\Facades\DB::raw('COALESCE(inventory_offers.name, skus.sku) as name'),
                'sku_inventory.quantity as current_stock',
                'skus.cost_price'
            )
            ->with(['offer'])
            ->get();

        $deadStock->transform(function ($item) {
            $item->value_tied_up = $item->current_stock * $item->cost_price;

            return $item;
        });

        return response()->json($deadStock);
    }

    /**
     * Get margin alerts (products with low margin).
     */
    public function marginAlerts(Request $request)
    {
        $userId = (int) ($request->user()?->id ?? 0);
        $threshold = (float) $request->input('threshold', 0.20);

        return response()->json(
            $this->reports->marginAlerts($userId, $threshold * 100)
        );
    }

    /**
     * Get return rates by SKU.
     */
    public function returnRates(Request $request)
    {
        $userId = (int) ($request->user()?->id ?? 0);

        return response()->json(
            $this->reports->returnRates($userId)
        );
    }
}
