<?php

namespace App\Presentation\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Schema;
use App\Application\Services\InventoryValuationService;
use App\Domain\Models\Wms\InventoryLocation;
use App\Domain\Models\Wms\SkuInventory;

class InventoryLocationController extends Controller
{
    private function normalizeLocationType(?string $type): string
    {
        $value = strtolower(trim((string) $type));
        if (in_array($value, ['shop', 'store', 'physical'], true)) {
            return 'physical';
        }

        return $value !== '' ? $value : 'warehouse';
    }

    private function sameLogicalTypeGroupQuery($query, string $type)
    {
        if ($type === 'physical') {
            return $query->whereIn('type', ['physical', 'shop', 'store']);
        }

        return $query->where('type', $type);
    }

    private function paginateInventoryQuery($query, Request $request)
    {
        $search = trim((string) $request->query('search', ''));
        $perPage = (int) $request->query('per_page', 50);
        $perPage = max(10, min($perPage, 200));

        if ($search !== '') {
            $query->where(function ($q) use ($search) {
                $q->whereHas('sku', function ($skuQ) use ($search) {
                    $skuQ->where('sku', 'like', "%{$search}%")
                        ->orWhere('name', 'like', "%{$search}%");
                })->orWhereHas('sku.offer', function ($offerQ) use ($search) {
                    $offerQ->where('name', 'like', "%{$search}%");
                })->orWhereHas('sku.offer.masterProduct', function ($mpQ) use ($search) {
                    $mpQ->where('internal_name', 'like', "%{$search}%");
                });
            });
        }

        return $query
            ->orderByDesc('id')
            ->paginate($perPage)
            ->appends($request->query());
    }

    public function index(Request $request)
    {
        $includeInactive = filter_var($request->query('include_inactive', false), FILTER_VALIDATE_BOOL);
        $query = InventoryLocation::query()->orderBy('name');
        if (! $includeInactive) {
            $query->where(function ($q) {
                $q->where('is_active', true)->orWhereNull('is_active');
            });
        }

        return response()->json($query->get());
    }

    public function store(Request $request)
    {
        $validated = $request->validate([
            'name' => 'required|string',
            'type' => 'required|string',
            'is_main' => 'boolean',
            'is_active' => 'boolean',
        ]);

        $validated['type'] = $this->normalizeLocationType($validated['type'] ?? null);
        $normalizedName = mb_strtolower(trim((string) ($validated['name'] ?? '')));
        if ($normalizedName !== '' && ! isset($validated['channel_id'])) {
            $existing = InventoryLocation::query()
                ->whereRaw('LOWER(TRIM(name)) = ?', [$normalizedName]);
            $existing = $this->sameLogicalTypeGroupQuery($existing, $validated['type'])->first();
            if ($existing) {
                $existing->update($validated);

                return response()->json($existing);
            }
        }

        $location = InventoryLocation::create($validated);

        return response()->json($location, 201);
    }

    public function show(string $id)
    {
        return response()->json(InventoryLocation::findOrFail($id));
    }

    public function update(Request $request, string $id)
    {
        $location = InventoryLocation::findOrFail($id);
        $validated = $request->validate([
            'name' => 'sometimes|string|max:255',
            'type' => 'sometimes|string|max:50',
            'is_main' => 'sometimes|boolean',
            'is_active' => 'sometimes|boolean',
        ]);
        if (array_key_exists('type', $validated)) {
            $validated['type'] = $this->normalizeLocationType($validated['type']);
        }
        $location->update($validated);

        return response()->json($location);
    }

    public function destroy(Request $request, string $id)
    {
        $location = InventoryLocation::findOrFail($id);

        $stockRows = SkuInventory::query()
            ->where('location_id', $location->id)
            ->get();

        $hasReservedQuantityColumn = Schema::hasColumn('sku_inventory', 'reserved_quantity');
        $hasReservedColumn = Schema::hasColumn('sku_inventory', 'reserved');

        $activeStockRows = $stockRows->filter(function ($row) use ($hasReservedQuantityColumn, $hasReservedColumn) {
            $available = (float) ($row->quantity ?? 0);
            $reserved = 0.0;
            if ($hasReservedQuantityColumn) {
                $reserved = (float) ($row->reserved_quantity ?? 0);
            } elseif ($hasReservedColumn) {
                $reserved = (float) ($row->reserved ?? 0);
            }

            return ($available + $reserved) > 0;
        });

        $clearStock = filter_var($request->query('clear_stock', false), FILTER_VALIDATE_BOOL);
        if ($activeStockRows->isNotEmpty() && ! $clearStock) {
            return response()->json([
                'message' => 'Cannot delete location with stock balances. Enable clear_stock first.',
                'stock_rows' => $activeStockRows->count(),
            ], 422);
        }

        if ($clearStock && $stockRows->isNotEmpty()) {
            foreach ($stockRows as $row) {
                $payload = ['quantity' => 0];
                if ($hasReservedQuantityColumn) {
                    $payload['reserved_quantity'] = 0;
                }
                if ($hasReservedColumn) {
                    $payload['reserved'] = 0;
                }
                $row->update($payload);
            }
        }

        try {
            $location->delete();

            return response()->json(null, 204);
        } catch (QueryException $e) {
            $sqlState = (string) ($e->errorInfo[0] ?? '');
            if (in_array($sqlState, ['23000', '23503'], true)) {
                // Linked rows exist (orders/invoices/etc). Archive instead of throwing 500.
                $location->update([
                    'is_active' => false,
                    'is_main' => false,
                ]);

                return response()->json([
                    'message' => 'Location is linked to transactions and cannot be hard deleted. It was archived instead.',
                    'archived' => true,
                    'id' => $location->id,
                ]);
            }
            throw $e;
        }
    }

    /**
     * Get all inventory (SKU stock) for a specific location.
     */
    public function inventory(Request $request, string $id)
    {
        $inventory = $this->paginateInventoryQuery(
            SkuInventory::with(['sku.offer.masterProduct', 'sku.channel', 'location'])
                ->where('location_id', $id),
            $request
        );

        return response()->json($inventory);
    }

    /**
     * Get all inventory across all locations (for "All Locations" view).
     */
    public function allInventory(Request $request)
    {
        $inventory = $this->paginateInventoryQuery(
            SkuInventory::with(['sku.offer.masterProduct', 'sku.channel', 'location']),
            $request
        );

        return response()->json($inventory);
    }

    /**
     * Summary cards by location with inventory cost.
     * Total cost = base purchase price * total quantity.
     */
    public function summary(InventoryValuationService $valuation)
    {
        $cacheKey = 'inventory_warehouses_summary_v5_'.(auth()->id() ?? 'guest');

        return response()->json(Cache::remember($cacheKey, now()->addSeconds(15), function () use ($valuation) {
            return $valuation->warehouseSummaryRows();
        }));
    }
}
