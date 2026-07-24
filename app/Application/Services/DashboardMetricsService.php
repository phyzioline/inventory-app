<?php

declare(strict_types=1);

namespace App\Application\Services;

use Carbon\Carbon;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use App\Domain\Models\Wms\Channel;
use App\Domain\Models\Wms\InventoryOrder;
use App\Domain\Models\Wms\InventoryReturn;
use App\Domain\Models\Wms\MasterProduct;

final class DashboardMetricsService
{
    /**
     * @return array{
     *   product_count: int,
     *   low_stock_count: int,
     *   low_stock_alerts: list<array{id: int, product: string, sku: string, current: float, minimum: float, warehouse: string}>,
     *   orders: array{
     *     count: int,
     *     total_sales: float,
     *     pending_count: int,
     *     sales_by_date: list<array{date: string, sales: float}>,
     *     recent: list<array<string, mixed>>,
     *     by_channel: list<array{name: string, orders: int, sales: float, returns: int}>
     *   },
     *   returns_by_channel: array<string, int>
     * }
     */
    public function forPeriod(string $startDate, string $endDate, int $lowStockLimit = 20): array
    {
        $start = Carbon::parse($startDate)->startOfDay();
        $end = Carbon::parse($endDate)->endOfDay();

        $productCount = (int) MasterProduct::query()->count();

        $ordersQuery = InventoryOrder::query()
            ->with(['channel:id,name'])
            ->whereBetween('order_date', [$start, $end]);

        $orders = (clone $ordersQuery)
            ->orderByDesc('order_date')
            ->limit(500)
            ->get(['id', 'platform_order_id', 'channel_id', 'status', 'order_date', 'customer_name', 'total_amount']);

        $totalSales = (float) (clone $ordersQuery)->sum('total_amount');
        $orderCount = (int) (clone $ordersQuery)->count();
        $pendingCount = (int) (clone $ordersQuery)->where('status', 'pending')->count();

        $salesByDate = (clone $ordersQuery)
            ->selectRaw('DATE(order_date) as sale_date, SUM(total_amount) as sales')
            ->groupBy(DB::raw('DATE(order_date)'))
            ->orderBy('sale_date')
            ->get()
            ->map(fn ($row) => [
                'date' => (string) $row->sale_date,
                'sales' => round((float) $row->sales, 2),
            ])
            ->values()
            ->all();

        $channelAgg = (clone $ordersQuery)
            ->selectRaw('channel_id, COUNT(*) as orders, COALESCE(SUM(total_amount), 0) as sales')
            ->groupBy('channel_id')
            ->get();

        $channelNames = Channel::query()
            ->whereIn('id', $channelAgg->pluck('channel_id')->filter())
            ->pluck('name', 'id');

        $returnsByChannel = $this->returnsCountByChannel($start, $end);

        $byChannel = $channelAgg->map(function ($row) use ($channelNames, $returnsByChannel) {
            $name = $channelNames[(int) $row->channel_id] ?? 'Unknown Channel';

            return [
                'name' => $name,
                'orders' => (int) $row->orders,
                'sales' => round((float) $row->sales, 2),
                'returns' => (int) ($returnsByChannel[$name] ?? 0),
            ];
        })->sortByDesc('sales')->values()->all();

        $recent = $orders->take(5)->map(fn ($o) => [
            'id' => $o->id,
            'platform_order_id' => $o->platform_order_id,
            'customer_name' => $o->customer_name,
            'total_amount' => (float) $o->total_amount,
            'status' => $o->status,
            'order_date' => $o->order_date?->toIso8601String(),
            'channel' => $o->channel?->name,
        ])->values()->all();

        $lowStock = $this->lowStockAlerts($lowStockLimit);

        return [
            'product_count' => $productCount,
            'low_stock_count' => count($lowStock),
            'low_stock_alerts' => $lowStock,
            'orders' => [
                'count' => $orderCount,
                'total_sales' => round($totalSales, 2),
                'pending_count' => $pendingCount,
                'sales_by_date' => $salesByDate,
                'recent' => $recent,
                'by_channel' => $byChannel,
            ],
            'returns_by_channel' => $returnsByChannel,
        ];
    }

    /**
     * Cross-tenant snapshot for Phyzioline admin oversight of the internal
     * Inventory & Accounting (WMS) system. Unlike forPeriod(), which scopes
     * to the logged-in tenant via IsIsolatedByUser, this aggregates across
     * every business using the WMS — admins have no tenant data of their own.
     *
     * @return array{
     *   total_products: int,
     *   low_stock_count: int,
     *   out_of_stock_count: int,
     *   pending_returns: int,
     *   total_orders: int,
     *   total_revenue: float,
     *   tenant_count: int,
     *   low_stock_by_tenant: list<array{user_id: int, low_stock_count: int}>,
     *   recent_pending_returns: \Illuminate\Support\Collection
     * }
     */
    public function adminCrossTenantOverview(int $lowStockThreshold = 10): array
    {
        $stockByProduct = $this->crossTenantProductStock();

        $lowStock = $stockByProduct->filter(fn ($row) => $row->total_qty > 0 && $row->total_qty <= $lowStockThreshold);
        $outOfStock = $stockByProduct->filter(fn ($row) => $row->total_qty <= 0);

        $pendingReturnsQuery = fn () => InventoryReturn::withoutGlobalScope('user_isolation')
            ->where(function ($q) {
                $q->whereIn('return_status', ['return_requested', 'pending', 'in_transit'])
                    ->orWhereIn('inventory_status', ['on_hold', 'pending', 'in_transit']);
            });

        return [
            'total_products' => (int) MasterProduct::withoutGlobalScope('user_isolation')->count(),
            'low_stock_count' => $lowStock->count(),
            'out_of_stock_count' => $outOfStock->count(),
            'pending_returns' => (int) $pendingReturnsQuery()->count(),
            'total_orders' => (int) InventoryOrder::withoutGlobalScope('user_isolation')->count(),
            'total_revenue' => round((float) InventoryOrder::withoutGlobalScope('user_isolation')->sum('paid_amount'), 2),
            'tenant_count' => (int) MasterProduct::withoutGlobalScope('user_isolation')->whereNotNull('user_id')->distinct('user_id')->count('user_id'),
            'low_stock_by_tenant' => $lowStock->groupBy('user_id')
                ->map(fn ($rows, $userId) => ['user_id' => (int) $userId, 'low_stock_count' => $rows->count()])
                ->sortByDesc('low_stock_count')
                ->take(10)
                ->values()
                ->all(),
            'recent_pending_returns' => $pendingReturnsQuery()
                ->with(['inventoryOrder:id,platform_order_id,customer_name,user_id'])
                ->latest('id')
                ->take(10)
                ->get(),
        ];
    }

    /**
     * Per-product stock summed across every tenant's SKUs, for admin-level
     * low-stock/out-of-stock classification (no per-tenant min_stock threshold).
     *
     * @return \Illuminate\Support\Collection<int, object{id: int, user_id: ?int, total_qty: float}>
     */
    private function crossTenantProductStock(): \Illuminate\Support\Collection
    {
        if (! Schema::hasTable('sku_inventory') || ! Schema::hasTable('master_products')) {
            return collect();
        }

        return DB::table('master_products as mp')
            ->leftJoin('inventory_offers as o', 'o.master_product_id', '=', 'mp.id')
            ->leftJoin('skus as s', 's.offer_id', '=', 'o.id')
            ->leftJoin('sku_inventory as si', 'si.sku_id', '=', 's.id')
            ->groupBy('mp.id', 'mp.user_id')
            ->selectRaw('mp.id, mp.user_id, COALESCE(SUM(si.quantity), 0) as total_qty')
            ->get();
    }

    /**
     * @return array<string, int>
     */
    private function returnsCountByChannel(Carbon $start, Carbon $end): array
    {
        $dateCol = Schema::hasColumn('inventory_returns', 'last_update_date')
            ? 'COALESCE(inventory_returns.last_update_date, inventory_returns.return_date, inventory_returns.created_at)'
            : 'COALESCE(inventory_returns.return_date, inventory_returns.created_at)';

        $rows = InventoryReturn::query()
            ->leftJoin('inventory_orders', 'inventory_orders.id', '=', 'inventory_returns.inventory_order_id')
            ->leftJoin('channels', 'channels.id', '=', 'inventory_orders.channel_id')
            ->whereRaw("{$dateCol} BETWEEN ? AND ?", [$start, $end])
            ->selectRaw("COALESCE(channels.name, inventory_returns.channel, inventory_returns.source_channel, 'Unknown Channel') as channel_name, COUNT(*) as cnt")
            ->groupBy(DB::raw("COALESCE(channels.name, inventory_returns.channel, inventory_returns.source_channel, 'Unknown Channel')"))
            ->get();

        $out = [];
        foreach ($rows as $row) {
            $out[(string) $row->channel_name] = (int) $row->cnt;
        }

        return $out;
    }

    /**
     * @return list<array{id: int, product: string, sku: string, current: float, minimum: float, warehouse: string}>
     */
    private function lowStockAlerts(int $limit): array
    {
        if (! Schema::hasTable('sku_inventory') || ! Schema::hasTable('master_products')) {
            return [];
        }

        $userId = (int) auth()->id();

        $rows = DB::table('master_products as mp')
            ->leftJoin('inventory_offers as o', 'o.master_product_id', '=', 'mp.id')
            ->leftJoin('skus as s', 's.offer_id', '=', 'o.id')
            ->leftJoin('sku_inventory as si', 'si.sku_id', '=', 's.id')
            ->where('mp.user_id', $userId)
            ->groupBy('mp.id', 'mp.internal_name', 'mp.specifications')
            ->selectRaw('mp.id, mp.internal_name, mp.specifications, COALESCE(SUM(si.quantity), 0) as total_qty, MIN(s.sku) as sku')
            ->havingRaw("(COALESCE(mp.specifications->>'min_stock', '0'))::numeric > 0")
            ->havingRaw("COALESCE(SUM(si.quantity), 0) < (COALESCE(mp.specifications->>'min_stock', '0'))::numeric")
            ->orderBy('total_qty')
            ->limit($limit)
            ->get();

        return $rows->map(function ($row) {
            $specs = is_string($row->specifications)
                ? json_decode($row->specifications, true)
                : (array) json_decode(json_encode($row->specifications), true);
            $min = (float) ($specs['min_stock'] ?? 0);

            return [
                'id' => (int) $row->id,
                'product' => (string) ($row->internal_name ?? '—'),
                'sku' => (string) ($row->sku ?? '—'),
                'current' => round((float) $row->total_qty, 2),
                'minimum' => $min,
                'warehouse' => 'N/A',
            ];
        })->values()->all();
    }
}
