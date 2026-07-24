<?php

namespace App\Presentation\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use App\Infrastructure\Support\DatabaseSql;
use App\Domain\Models\Wms\Channel;
use App\Domain\Models\Wms\InventoryLocation;
use App\Domain\Models\Wms\InventoryOrder;
use App\Domain\Models\Wms\MasterProduct;
use App\Domain\Models\Wms\SkuInventory;

class InventoryController extends Controller
{
    /**
     * Display a listing of the resource.
     */
    public function index()
    {
        return response()->json(['status' => 'success']);
    }

    /**
     * Dashboard statistics for the Inventory system.
     */
    public function dashboard()
    {
        $totalProducts = MasterProduct::count();
        $totalChannels = Channel::where('is_active', true)->count();
        $totalInventory = SkuInventory::sum('quantity');
        $totalLocations = InventoryLocation::count();

        // Sum of all orders in the last 30 days
        $recentRevenue = InventoryOrder::where('order_date', '>=', now()->subDays(30))
            ->sum('total_amount');

        // Sales trend (last 7 days)
        $salesTrend = InventoryOrder::select(
            DB::raw(DatabaseSql::dateCastSelect('order_date', 'date')),
            DB::raw('SUM(total_amount) as total')
        )
            ->groupBy(DB::raw(DatabaseSql::dateCastGroupBy('order_date')))
            ->orderBy('date', 'desc')
            ->limit(7)
            ->get();

        return response()->json([
            'stats' => [
                'total_products' => $totalProducts,
                'active_channels' => $totalChannels,
                'total_stock' => $totalInventory,
                'total_locations' => $totalLocations,
                'monthly_revenue' => $recentRevenue,
            ],
            'sales_trend' => $salesTrend,
            'top_products' => MasterProduct::withCount('offers')->orderBy('offers_count', 'desc')->limit(5)->get(),
        ]);
    }

    /**
     * Get vendors (suppliers) list.
     * Returns structured vendor objects for the React app.
     */
    public function vendors()
    {
        $vendors = MasterProduct::select('original_supplier')
            ->whereNotNull('original_supplier')
            ->where('original_supplier', '!=', '')
            ->distinct()
            ->get()
            ->map(function ($item, $index) {
                return [
                    'id' => (string) ($index + 1),
                    'name' => $item->original_supplier,
                    'email' => null,
                    'phone' => null,
                    'address' => null,
                    'current_balance' => 0,
                    'is_active' => true,
                ];
            });

        return response()->json($vendors);
    }

    /**
     * Store a new vendor (placeholder - vendors are derived from master products for now).
     */
    public function storeVendor(Request $request)
    {
        // For now, vendors are not a separate table - return the submitted data with a fake ID
        return response()->json(array_merge(
            ['id' => (string) time()],
            $request->only(['name', 'email', 'phone', 'address'])
        ), 201);
    }

    /**
     * Update a vendor (placeholder).
     */
    public function updateVendor(Request $request, string $id)
    {
        return response()->json(array_merge(['id' => $id], $request->all()));
    }

    /**
     * Delete a vendor (placeholder).
     */
    public function destroyVendor(string $id)
    {
        return response()->json(null, 204);
    }

    /**
     * Update vendor balance (placeholder).
     */
    public function updateVendorBalance(Request $request, string $id)
    {
        return response()->json(['id' => $id, 'balance' => $request->amount]);
    }

    /**
     * Get products list (flat view of all products).
     */
    public function products()
    {
        return response()->json(MasterProduct::with(['offers.skus'])->get());
    }

    /**
     * Get customers list (placeholder - can be extended when customers table exists).
     */
    public function customers()
    {
        return response()->json([]);
    }

    /**
     * Get purchase invoices list.
     * Based on orders with type = purchase or incoming transactions.
     */
    public function purchases()
    {
        $orders = InventoryOrder::with(['channel', 'items.sku'])
            ->where('channel_id', '!=', null)
            ->orderBy('order_date', 'desc')
            ->get();

        return response()->json($orders);
    }

    /**
     * Show a single purchase.
     */
    public function showPurchase(string $id)
    {
        $order = InventoryOrder::with(['channel', 'items.sku', 'costs'])
            ->findOrFail($id);

        return response()->json($order);
    }

    /**
     * Store a new purchase.
     */
    public function storePurchase(Request $request)
    {
        $validated = $request->validate([
            'channel_id' => 'required|exists:channels,id',
            'order_date' => 'required|date',
            'platform_order_id' => 'nullable|string',
            'total_amount' => 'required|numeric',
            'status' => 'nullable|string',
        ]);

        $total = (float) $validated['total_amount'];
        $payload = array_intersect_key([
            'channel_id' => (int) $validated['channel_id'],
            'order_date' => $validated['order_date'],
            'platform_order_id' => $validated['platform_order_id']
                ?? ('PUR-'.strtoupper(Str::random(10))),
            'total_amount' => $total,
            'currency' => 'EGP',
            'shipping_amount' => 0,
            'tax_amount' => 0,
            'discount_amount' => 0,
            'payment_type' => 'credit',
            'paid_amount' => 0,
            'remaining_amount' => $total,
            'status' => $validated['status'] ?? 'pending',
            'financial_status' => 'pending',
            'settlement_status' => 'pending',
            'user_id' => auth()->id(),
        ], array_flip(Schema::getColumnListing('inventory_orders')));

        $order = InventoryOrder::create($payload);

        return response()->json($order, 201);
    }

    /**
     * Check stock for a specific SKU.
     */
    public function checkStock(string $sku)
    {
        $stock = SkuInventory::whereHas('sku', function ($q) use ($sku) {
            $q->where('sku', $sku);
        })->with(['sku', 'location'])->get();

        return response()->json([
            'sku' => $sku,
            'total' => $stock->sum('quantity'),
            'locations' => $stock,
        ]);
    }
}
