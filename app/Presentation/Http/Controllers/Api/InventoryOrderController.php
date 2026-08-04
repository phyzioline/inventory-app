<?php

namespace App\Presentation\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;
use App\Application\Services\InventoryOrderMutationService;
use App\Application\Services\MarketplaceImportService;
use App\Application\Services\ProfitEngineService;
use App\Application\Support\ChannelQuery;
use App\Domain\Models\Wms\InventoryOrder;

class InventoryOrderController extends Controller
{
    public function __construct(
        private readonly InventoryOrderMutationService $mutations
    ) {}

    public function index(Request $request)
    {
        $forProfit = $request->boolean('for_profit');

        $with = [
            'channel:id,name,slug',
            'items.sku.offer.masterProduct',
        ];
        if (! $forProfit) {
            $with['user'] = fn ($q) => $q->select('id', 'name', 'email');
            $with['costs'] = fn ($q) => $q->select(
                'id',
                'inventory_order_id',
                'type',
                'amount',
                'source_channel',
                'account_email',
                'external_order_id',
                'sku_code'
            );
        }

        $query = InventoryOrder::with($with)->orderBy('order_date', 'desc');

        if ($forProfit) {
            $query->whereIn('status', ['completed', 'processing', 'shipped', 'sold', 'delivered'])
                ->where(function ($q) {
                    $q->whereNull('financial_status')
                        ->orWhere('financial_status', '<>', 'cancelled');
                });
        }

        $startDate = trim((string) $request->query('start_date', ''));
        $endDate = trim((string) $request->query('end_date', ''));
        if ($startDate !== '') {
            $query->where('order_date', '>=', \Carbon\Carbon::parse($startDate)->startOfDay());
        }
        if ($endDate !== '') {
            $query->where('order_date', '<=', \Carbon\Carbon::parse($endDate)->endOfDay());
        }

        $channelFilter = trim((string) $request->query('channel', ''));
        if ($channelFilter !== '') {
            $channelIds = ChannelQuery::idsMatchingFilter($channelFilter);
            if ($channelIds === []) {
                $query->whereRaw('1 = 0');
            } else {
                $query->whereIn('channel_id', $channelIds);
            }
        }

        $orderIdNeedle = trim((string) $request->query('order_id', ''));
        if ($orderIdNeedle !== '') {
            $escaped = '%'.addcslashes($orderIdNeedle, '%_\\').'%';
            $query->where(function ($q) use ($escaped, $orderIdNeedle) {
                $q->where('platform_order_id', 'like', $escaped);
                $digits = preg_replace('/\D+/', '', $orderIdNeedle);
                if ($digits !== '' && strlen($digits) <= 15 && ctype_digit($digits)) {
                    $q->orWhere('id', (int) $digits);
                }
            });
        }

        $page = max(0, (int) $request->query('page', 0));
        $paginate = $request->boolean('paginate', false) || $page > 0;
        $perPage = max(1, min((int) $request->query('per_page', 50), 200));

        if ($paginate && $startDate === '' && $endDate === '') {
            $query->where('order_date', '>=', now()->subDays(90)->startOfDay());
        }

        if ($paginate) {
            $paginator = $query->paginate($perPage, ['*'], 'page', max(1, $page ?: 1));
            $orders = $paginator->getCollection();
            app(ProfitEngineService::class)->hydrateOrderCollectionWithEffectivePurchaseCosts($orders);

            return response()->json([
                'data' => $orders->values()->all(),
                'current_page' => $paginator->currentPage(),
                'last_page' => $paginator->lastPage(),
                'per_page' => $paginator->perPage(),
                'total' => $paginator->total(),
            ]);
        }

        $orders = $query->get();

        app(ProfitEngineService::class)->hydrateOrderCollectionWithEffectivePurchaseCosts($orders);

        return response()->json($orders);
    }

    public function store(Request $request)
    {
        return $this->mutations->store($request);
    }

    public function show($id)
    {
        $order = InventoryOrder::with(['items.sku.offer.masterProduct', 'costs', 'user', 'channel'])->findOrFail($id);
        app(ProfitEngineService::class)->hydrateOrderCollectionWithEffectivePurchaseCosts([$order]);

        return response()->json($order);
    }

    public function update(Request $request, $id)
    {
        return $this->mutations->update($request, $id);
    }

    public function cancel(\App\Presentation\Http\Requests\CancelInventoryOrderRequest $request, $id)
    {
        $order = InventoryOrder::findOrFail($id);
        $this->authorize('cancel-inventory-order', $order);

        $result = $this->mutations->cancel($request, $id);
        app(\App\Application\Services\InventoryAuditLogService::class)->record(
            'inventory_order.cancel',
            InventoryOrder::class,
            (int) $order->id,
            ['platform_order_id' => $order->platform_order_id],
        );

        return $result;
    }

    public function import(Request $request)
    {
        if (function_exists('set_time_limit')) {
            @set_time_limit(600);
        }

        $lockChannel = $request->boolean('lock_channel', $request->filled('channel_id'));
        $request->validate([
            'channel_id' => ($lockChannel ? 'required' : 'nullable').'|exists:channels,id',
            'file' => 'required|file|mimes:csv,txt,xlsx,xls',
        ]);

        try {
            $results = app(MarketplaceImportService::class)->import(
                $request->file('file'),
                (int) $request->input('channel_id', 0),
                $lockChannel
            );

            return response()->json([
                'message' => 'Orders imported successfully',
                'details' => $results,
            ]);
        } catch (ValidationException $e) {
            $first = collect($e->errors())->flatten()->first() ?? $e->getMessage();

            return response()->json([
                'message' => 'Import blocked',
                'error' => $first,
                'details' => $e->errors(),
            ], 422);
        } catch (\Throwable $e) {
            report($e);

            return response()->json([
                'message' => 'Import failed',
                'error' => $e->getMessage(),
            ], 500);
        }
    }

    public function profitability($id)
    {
        $order = InventoryOrder::with(['items.sku', 'costs'])->findOrFail($id);

        $revenue = $order->total_amount;
        $cogs = 0;
        $shippingCost = 0;
        $platformFees = 0;

        foreach ($order->items as $item) {
            $cogs += $item->quantity * ($item->sku->cost_price ?? 0);
        }

        foreach ($order->costs as $cost) {
            if ($cost->type === 'shipping') {
                $shippingCost += $cost->amount;
            }
            if ($cost->type === 'platform_fee') {
                $platformFees += $cost->amount;
            }
        }

        $totalCost = $cogs + $shippingCost + $platformFees + $order->tax_amount;
        $profit = $revenue - $totalCost;
        $margin = $revenue > 0 ? ($profit / $revenue) * 100 : 0;

        return response()->json([
            'order_id' => $order->id,
            'revenue' => $revenue,
            'costs' => [
                'cogs' => $cogs,
                'shipping' => $shippingCost,
                'platform_fees' => $platformFees,
                'tax' => $order->tax_amount,
                'total' => $totalCost,
            ],
            'profit' => $profit,
            'margin_percentage' => round($margin, 2),
        ]);
    }
}
