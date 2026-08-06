<?php

namespace App\Presentation\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use App\Application\Services\ChannelStockResolver;
use App\Application\Services\InventoryValuationService;
use App\Application\Services\ProfitEngineService;
use App\Application\Services\SkuUniquenessGuard;
use App\Application\Services\StockRehomeTransferService;
use App\Domain\Models\Wms\Channel;
use App\Domain\Models\Wms\InventoryAdjustment;
use App\Domain\Models\Wms\InventoryLocation;
use App\Domain\Models\Wms\QuotationItem;
use App\Domain\Models\Wms\Sku;
use App\Domain\Models\Wms\SkuInventory;
use Illuminate\Validation\ValidationException;

class SkuController extends Controller
{
    public function __construct(
        private readonly InventoryValuationService $valuation,
        private readonly ProfitEngineService $profitEngine,
        private readonly StockRehomeTransferService $stockRehome,
    ) {}

    /**
     * Quantity for channel SKU listing: this channel's warehouse only.
     *
     * @param  int  $scopeChannelId  Page channel id (listing channel).
     * @param  int  $linkedLocationId  First inventory_locations row for that channel.
     */
    private function quantityForChannelScopedSku(Sku $sku, int $scopeChannelId, int $linkedLocationId): float
    {
        if ($scopeChannelId > 0 && (int) $sku->id > 0) {
            // Prefer preloaded inventory on list endpoints — avoids N+1 re-finds.
            if ($sku->relationLoaded('inventory')) {
                return ChannelStockResolver::availableQuantityFromPreloadedInventory($sku, $scopeChannelId);
            }

            return ChannelStockResolver::availableQuantityForChannelSku((int) $sku->id, $scopeChannelId);
        }

        return ChannelStockResolver::availableQuantityForSkuListing($sku);
    }

    public function index(Request $request)
    {
        $channelId = (int) $request->query('channel_id', 0);

        $query = Sku::with(['offer.masterProduct', 'channel.locations', 'inventory.location']);

        if ($request->has('offer_id')) {
            $query->where('offer_id', $request->offer_id);
        }
        if ($request->has('channel_id')) {
            $query->where('channel_id', $request->channel_id);
        }

        $linked = $request->query('linked');
        if ($linked === '1' || $linked === 1 || $linked === true || $linked === 'true') {
            $query->whereNotNull('offer_id')->where('offer_id', '>', 0);
        } elseif ($linked === '0' || $linked === 0 || $linked === false || $linked === 'false') {
            $query->where(function ($q) {
                $q->whereNull('offer_id')->orWhere('offer_id', 0);
            });
        }

        if ($request->boolean('duplicates_only')) {
            $userId = (int) (auth()->id() ?? 0);
            SkuUniquenessGuard::scopeDuplicateCodesOnly($query, $userId);
        }

        $search = trim((string) $request->query('search', ''));
        if ($search !== '') {
            $like = '%'.$search.'%';
            $query->where(function ($q) use ($like) {
                $q->where('sku', 'like', $like)
                    ->orWhere('name', 'like', $like)
                    ->orWhereHas('offer.masterProduct', function ($mq) use ($like) {
                        $mq->where('internal_name', 'like', $like)
                            ->orWhere('original_supplier_sku', 'like', $like);
                    });
            });
        }

        $sortBy = strtolower(trim((string) $request->query('sort_by', '')));
        $sortDir = strtolower(trim((string) $request->query('sort_dir', 'desc'))) === 'asc' ? 'asc' : 'desc';
        if ($channelId > 0 && in_array($sortBy, ['stock', 'price'], true)) {
            $this->applyChannelListSort($query, $channelId, $sortBy, $sortDir);
        } else {
            $query->orderBy('skus.id');
        }

        $page = max(0, (int) $request->query('page', 0));
        $paginate = $request->boolean('paginate', false) || $page > 0;
        $perPage = max(1, min((int) $request->query('per_page', 50), 200));

        if ($paginate) {
            $paginator = $query->paginate($perPage, ['*'], 'page', max(1, $page ?: 1));
            $skus = $this->enrichSkuRows($paginator->getCollection(), $channelId);

            return response()->json([
                'data' => $skus->values()->all(),
                'current_page' => $paginator->currentPage(),
                'last_page' => $paginator->lastPage(),
                'per_page' => $paginator->perPage(),
                'total' => $paginator->total(),
            ]);
        }

        return response()->json($this->enrichSkuRows($query->get(), $channelId)->values()->all());
    }

    /**
     * Order channel SKU list by stock or price before pagination.
     * Stock must be ordered in SQL — client-side sort only reorders the current page.
     *
     * @param  \Illuminate\Database\Eloquent\Builder<\App\Domain\Models\Wms\Sku>  $query
     */
    private function applyChannelListSort($query, int $channelId, string $sortBy, string $sortDir): void
    {
        $dir = $sortDir === 'asc' ? 'asc' : 'desc';

        if ($sortBy === 'price') {
            // Prefer listing selling_price when set; otherwise cost_price (matches UI fallback loosely).
            $query->orderByRaw(
                'CASE WHEN COALESCE(skus.selling_price, 0) > 0 THEN skus.selling_price ELSE COALESCE(skus.cost_price, 0) END '.$dir
            )->orderBy('skus.sku');

            return;
        }

        // sort_by=stock
        if (ChannelStockResolver::deductsFromMainStoreBucket($channelId)) {
            $this->orderByMerchantStoreStock($query, $dir);

            return;
        }

        $locationIds = ChannelStockResolver::resolveLocationIdsForChannel($channelId);
        if ($locationIds === []) {
            $query->orderByRaw('0 '.$dir)->orderBy('skus.sku');

            return;
        }

        $stockSub = DB::table('sku_inventory')
            ->select('sku_id', DB::raw('COALESCE(SUM(quantity), 0) as sort_stock_qty'))
            ->whereIn('location_id', $locationIds)
            ->groupBy('sku_id');

        $query->leftJoinSub($stockSub, 'channel_stock_sort', function ($join) {
            $join->on('channel_stock_sort.sku_id', '=', 'skus.id');
        })
            ->orderByRaw('COALESCE(channel_stock_sort.sort_stock_qty, 0) '.$dir)
            ->orderBy('skus.sku')
            ->select('skus.*');
    }

    /**
     * Merchant/FBM listings show store sellable qty — order by linked offer's store warehouse stock.
     *
     * @param  \Illuminate\Database\Eloquent\Builder<\App\Domain\Models\Wms\Sku>  $query
     */
    private function orderByMerchantStoreStock($query, string $dir): void
    {
        $storeChannelId = ChannelStockResolver::resolveMainStoreChannelId();
        if ($storeChannelId <= 0) {
            $query->orderByRaw('0 '.$dir)->orderBy('skus.sku');

            return;
        }

        $storeLocationIds = ChannelStockResolver::resolveLocationIdsForChannel($storeChannelId);
        $offerStock = DB::table('skus as store_skus')
            ->join('sku_inventory as si', 'si.sku_id', '=', 'store_skus.id')
            ->where('store_skus.channel_id', $storeChannelId)
            ->whereNotNull('store_skus.offer_id')
            ->where('store_skus.offer_id', '>', 0)
            ->whereNull('store_skus.deleted_at')
            ->when($storeLocationIds !== [], static function ($q) use ($storeLocationIds) {
                $q->whereIn('si.location_id', $storeLocationIds);
            })
            ->groupBy('store_skus.offer_id')
            ->select('store_skus.offer_id', DB::raw('COALESCE(SUM(si.quantity), 0) as sort_stock_qty'));

        $query->leftJoinSub($offerStock, 'merchant_stock_sort', function ($join) {
            $join->on('merchant_stock_sort.offer_id', '=', 'skus.offer_id');
        })
            ->orderByRaw('COALESCE(merchant_stock_sort.sort_stock_qty, 0) '.$dir)
            ->orderBy('skus.sku')
            ->select('skus.*');
    }

    /**
     * Lightweight KPI totals for a channel inventory page (avoids loading all SKUs).
     */
    public function channelSummary(Request $request)
    {
        $channelId = (int) $request->query('channel_id', 0);
        if ($channelId <= 0) {
            return response()->json(['message' => 'channel_id is required'], 422);
        }

        $metrics = $this->valuation->channelCardMetrics($channelId);
        $userId = (int) (auth()->id() ?? 0);
        $metrics['duplicate_sku_count'] = SkuUniquenessGuard::countDuplicateListingsOnChannel($userId, $channelId);

        return response()->json($metrics);
    }

    /**
     * @param  \Illuminate\Support\Collection<int, Sku>|\Illuminate\Database\Eloquent\Collection<int, Sku>  $rows
     */
    private function enrichSkuRows($rows, int $channelId)
    {
        $scopedLocationId = 0;
        if ($channelId > 0) {
            $scopedLocationId = (int) (InventoryLocation::query()
                ->where('channel_id', $channelId)
                ->orderBy('id')
                ->value('id') ?? 0);
        }

        // Resolve once — isMerchantChannel() / planMerchantOrderDeduction() were N+1 on large channels.
        $deductsFromStore = $channelId > 0 && ChannelStockResolver::deductsFromMainStoreBucket($channelId);
        $storeAvailByListingId = $deductsFromStore
            ? ChannelStockResolver::batchStoreAvailableForListingSkus($rows)
            : [];

        $masterIds = $rows
            ->map(fn (Sku $sku) => (int) ($sku->offer?->master_product_id ?? 0))
            ->filter(fn (int $id) => $id > 0)
            ->unique()
            ->values()
            ->all();
        $batchCosts = $this->profitEngine->averagePurchaseUnitCostByMasterProductIds($masterIds);

        $userId = (int) (auth()->id() ?? 0);
        $duplicateMap = SkuUniquenessGuard::duplicateMapForCodes(
            $userId,
            $rows->map(fn (Sku $sku) => (string) ($sku->sku ?? ''))->all()
        );

        $masterTotalsById = [];
        if ($channelId > 0 && $scopedLocationId >= 0 && ! $deductsFromStore) {
            foreach ($rows as $sku) {
                $masterId = (int) ($sku->offer?->masterProduct?->id ?? 0);
                if ($masterId <= 0) {
                    continue;
                }
                if (! isset($masterTotalsById[$masterId])) {
                    $masterTotalsById[$masterId] = 0.0;
                }

                $masterTotalsById[$masterId] += $this->quantityForChannelScopedSku($sku, $channelId, $scopedLocationId);
            }
        }

        $channelIdsForLocations = $rows
            ->pluck('channel_id')
            ->filter(fn ($id) => (int) $id > 0)
            ->unique()
            ->values();

        $linkedLocationByChannelId = $channelIdsForLocations->isEmpty()
            ? collect()
            : InventoryLocation::query()
                ->whereIn('channel_id', $channelIdsForLocations)
                ->orderBy('id')
                ->get()
                ->groupBy('channel_id')
                ->map(fn ($group) => (int) $group->first()->id);

        return $rows->map(function ($sku) use (
            $scopedLocationId,
            $masterTotalsById,
            $channelId,
            $linkedLocationByChannelId,
            $deductsFromStore,
            $storeAvailByListingId,
            $batchCosts,
            $duplicateMap
        ) {
            $data = $sku->toArray();
            $master = $sku->offer?->masterProduct;
            $effectiveUnit = $this->profitEngine->resolveEffectiveUnitCost($master, $sku, $batchCosts);
            if ($effectiveUnit > 0) {
                $data['effective_purchase_unit_cost'] = round($effectiveUnit, 4);
            }
            if ($sku->offer && $sku->offer->master_product_id) {
                if (! isset($data['offer']) || ! is_array($data['offer'])) {
                    $data['offer'] = $sku->offer->toArray();
                }
                $data['offer']['master_product_id'] = $sku->offer->master_product_id;
            }
            // Alias sku → sku_code so frontend code reading sku.sku_code works
            $data['sku_code'] = $sku->sku;
            // Include product name for easy display in dropdowns
            $data['product_name'] = $sku->name
                ?? $sku->offer?->masterProduct?->internal_name
                ?? null;

            $skuCodeKey = (string) ($sku->sku ?? '');
            if ($skuCodeKey !== '' && isset($duplicateMap[$skuCodeKey])) {
                $siblings = $duplicateMap[$skuCodeKey];
                $data['is_duplicate_sku'] = true;
                $data['duplicate_action_required'] = true;
                $data['duplicate_siblings'] = array_values(array_filter(
                    $siblings,
                    static fn (array $row) => (int) ($row['sku_id'] ?? 0) !== (int) $sku->id
                ));
            } else {
                $data['is_duplicate_sku'] = false;
                $data['duplicate_action_required'] = false;
                $data['duplicate_siblings'] = [];
            }

            if (! empty($data['channel']) && $sku->channel) {
                $cid = (int) $sku->channel->id;
                $linked = $linkedLocationByChannelId->get($cid)
                    ?? $linkedLocationByChannelId->get((string) $cid);
                $data['channel']['linked_location_id'] = $linked ? (int) $linked : null;
            }

            // Override embedded master product total_stock when channel scoped.
            // Note: use $channelId here — same value as $scopeChannelId when scoped — because $scopeChannelId
            // is not in the closure `use` list (would be undefined and break /skus?channel_id= with HTTP 500).
            if ($channelId > 0 && $scopedLocationId >= 0) {
                if ($deductsFromStore) {
                    $data['display_quantity'] = 0;
                    $data['sellable_from_store_quantity'] = round(
                        (float) ($storeAvailByListingId[(int) $sku->id] ?? 0),
                        4
                    );
                    // Phantom qty from eager-loaded inventory only — never re-query per row on list.
                    $phantom = 0.0;
                    if ($sku->relationLoaded('inventory') && $sku->inventory->isNotEmpty()) {
                        foreach ($sku->inventory as $invRow) {
                            $loc = $invRow->relationLoaded('location') ? $invRow->location : null;
                            if ($loc && (int) ($loc->channel_id ?? 0) === $channelId) {
                                $phantom += (float) ($invRow->quantity ?? 0);
                            }
                        }
                    }
                    $phantom = round($phantom, 4);
                    if ($phantom > 0) {
                        $data['phantom_merchant_quantity'] = $phantom;
                    }
                } else {
                    $data['display_quantity'] = round(
                        $this->quantityForChannelScopedSku($sku, $channelId, $scopedLocationId),
                        4
                    );
                }

                $masterId = (int) ($sku->offer?->masterProduct?->id ?? 0);
                if ($masterId > 0) {
                    if (! isset($data['offer'])) {
                        $data['offer'] = [];
                    }
                    if (! isset($data['offer']['master_product']) && isset($data['offer']['masterProduct'])) {
                        // normalize key used by frontend
                        $data['offer']['master_product'] = $data['offer']['masterProduct'];
                    }
                    if (isset($data['offer']['master_product']) && is_array($data['offer']['master_product'])) {
                        $data['offer']['master_product']['total_stock'] = (float) ($masterTotalsById[$masterId] ?? 0);
                    }
                    if (isset($data['offer']['masterProduct']) && is_array($data['offer']['masterProduct'])) {
                        $data['offer']['masterProduct']['total_stock'] = (float) ($masterTotalsById[$masterId] ?? 0);
                    }
                }
            }

            return $data;
        });
    }

    public function store(Request $request)
    {
        $validated = $request->validate([
            'offer_id' => 'nullable|exists:inventory_offers,id',
            'channel_id' => 'nullable|exists:channels,id',
            'sku' => 'required|string',
            /** Realized from marketplace order imports; optional when creating the listing. */
            'selling_price' => 'nullable|numeric',
            'cost_price' => 'nullable|numeric',
            'marketplace_id' => 'nullable|string',
            'name' => 'nullable|string',
            'image_url' => 'nullable|string',
            'is_active' => 'nullable|boolean',
        ]);

        if (! array_key_exists('is_active', $validated) || $validated['is_active'] === null) {
            $validated['is_active'] = true;
        }

        if (! array_key_exists('selling_price', $validated) || $validated['selling_price'] === null) {
            $validated['selling_price'] = 0;
        }
        if (! array_key_exists('cost_price', $validated) || $validated['cost_price'] === null) {
            $validated['cost_price'] = 0;
        }

        $userId = (int) auth()->id();
        $validated['sku'] = SkuUniquenessGuard::normalize((string) $validated['sku']);
        SkuUniquenessGuard::assertAvailable($userId, $validated['sku']);

        $sku = Sku::create(array_merge($validated, ['user_id' => $userId]));

        return response()->json($sku->load(['offer', 'channel']), 201);
    }

    public function show(string $id)
    {
        return response()->json(Sku::with(['offer', 'channel', 'inventory'])->findOrFail($id));
    }

    public function update(Request $request, string $id)
    {
        $sku = Sku::findOrFail($id);

        $validated = $request->validate([
            'offer_id' => 'nullable|exists:inventory_offers,id',
            'channel_id' => 'nullable|exists:channels,id',
            'sku' => 'sometimes|string',
            'selling_price' => 'sometimes|nullable|numeric',
            'cost_price' => 'nullable|numeric',
            'marketplace_id' => 'nullable|string',
            'name' => 'nullable|string',
            'image_url' => 'nullable|string',
            'is_active' => 'sometimes|boolean',
        ]);

        if (array_key_exists('cost_price', $validated) && $validated['cost_price'] === null) {
            $validated['cost_price'] = 0;
        }
        if (array_key_exists('selling_price', $validated) && $validated['selling_price'] === null) {
            $validated['selling_price'] = 0;
        }

        $previousOfferId = (int) ($sku->offer_id ?? 0);
        $nextOfferId = array_key_exists('offer_id', $validated) ? (int) ($validated['offer_id'] ?? 0) : $previousOfferId;
        $previousChannelId = (int) ($sku->channel_id ?? 0);
        $nextChannelId = array_key_exists('channel_id', $validated)
            ? (int) ($validated['channel_id'] ?? 0)
            : $previousChannelId;

        if (array_key_exists('sku', $validated)) {
            $newSku = SkuUniquenessGuard::normalize((string) $validated['sku']);
            if ($newSku === '') {
                return response()->json(['message' => 'SKU cannot be empty'], 422);
            }
            $validated['sku'] = $newSku;
            SkuUniquenessGuard::assertAvailable((int) $sku->user_id, $newSku, (int) $sku->id);
        }

        $stockRehomeMeta = null;

        try {
            DB::transaction(function () use (
                $sku,
                $validated,
                $previousOfferId,
                $nextOfferId,
                $previousChannelId,
                $nextChannelId,
                &$stockRehomeMeta
            ) {
                // Link first when needed so FBA→Merchant can resolve the store SKU target.
                if ($previousOfferId === 0 && $nextOfferId > 0) {
                    $sku->fill(['offer_id' => $nextOfferId])->save();
                    $sku->refresh();
                    $this->ensureMainStoreSkuForOfferAndRehomeStoreInventory($sku);
                }

                if (
                    $previousChannelId > 0
                    && $nextChannelId > 0
                    && $previousChannelId !== $nextChannelId
                    && ChannelStockResolver::isFbaChannel($previousChannelId)
                    && ChannelStockResolver::isMerchantChannel($nextChannelId)
                ) {
                    $fbaQty = ChannelStockResolver::availableQuantityForChannelSku((int) $sku->id, $previousChannelId);
                    if ($fbaQty > 0) {
                        $storeSkuId = ChannelStockResolver::resolveStoreSkuIdForListingSku($sku->fresh(['offer']));
                        if ($storeSkuId === null || $storeSkuId <= 0) {
                            throw ValidationException::withMessages([
                                'channel_id' => [
                                    'هذا المنتج به مخزون FBA ('.(int) $fbaQty.' قطعة). اربط العرض بـ SKU المحل أولاً حتى يتم نقل المخزون تلقائياً إلى المحل قبل التحويل إلى التاجر.',
                                ],
                            ]);
                        }

                        $storeSku = Sku::query()->find($storeSkuId);
                        $storeCode = (string) ($storeSku?->sku ?? '');

                        $result = $this->stockRehome->rehomeFbaStockToStoreForMerchantConversion(
                            $sku->fresh(['offer']),
                            $previousChannelId
                        );
                        $moved = (float) ($result['moved'] ?? 0);
                        $storeCode = (string) ($result['store_sku_code'] ?: $storeCode);

                        $stockRehomeMeta = [
                            'moved' => $moved,
                            'from_channel_id' => $previousChannelId,
                            'to_store_sku_id' => $storeSkuId,
                            'to_store_sku' => $storeCode,
                            'message' => 'هذا المنتج به مخزون FBA ('.(int) $moved.' قطعة). تم نقل المخزون تلقائياً إلى المحل على الـ SKU المربوط: '.$storeCode,
                            'message_en' => 'This listing had FBA stock ('.(int) $moved.' pcs). Stock was auto-transferred to the linked store SKU: '.$storeCode,
                        ];
                    }
                }

                $sku->update($validated);

                // When a channel SKU gets linked to an offer (offer_id becomes non-null),
                // ensure the MAIN STORE has a SKU for the same offer so marketplace merchant orders
                // deduct from shop stock instead of creating negative balances on the channel SKU.
                if ($previousOfferId === 0 && $nextOfferId > 0) {
                    $this->ensureMainStoreSkuForOfferAndRehomeStoreInventory($sku->fresh(['offer']));
                }
            });
        } catch (ValidationException $e) {
            throw $e;
        }

        $payload = $sku->fresh()->load(['offer', 'channel'])->toArray();
        if (is_array($stockRehomeMeta)) {
            $payload['stock_rehome'] = $stockRehomeMeta;
            $payload['message'] = $stockRehomeMeta['message'];
        }

        return response()->json($payload);
    }

    private function ensureMainStoreSkuForOfferAndRehomeStoreInventory(Sku $linkedChannelSku): void
    {
        $userId = auth()->id();
        if (! $userId) {
            return;
        }

        $offer = $linkedChannelSku->offer()->with('masterProduct')->first();
        if (! $offer) {
            return;
        }

        $storeChannelId = $this->resolveMainStoreChannelId();
        if ($storeChannelId <= 0) {
            return;
        }

        // Find or create the store SKU for this offer.
        $storeSku = Sku::query()
            ->where('offer_id', $offer->id)
            ->where('channel_id', $storeChannelId)
            ->where(function ($q) use ($userId) {
                $q->where('user_id', $userId)->orWhereNull('user_id');
            })
            ->orderByDesc('id')
            ->first();

        if (! $storeSku) {
            $storeSkuCode = $this->generateStoreSkuCode($linkedChannelSku, $offer->masterProduct?->original_supplier_sku, (int) $offer->id);

            $storeSku = Sku::create([
                'user_id' => $userId,
                'offer_id' => $offer->id,
                'channel_id' => $storeChannelId,
                'sku' => $storeSkuCode,
                'name' => $linkedChannelSku->name ?? $offer->masterProduct?->internal_name ?? $storeSkuCode,
                'image_url' => $linkedChannelSku->image_url ?? $offer->masterProduct?->image_url ?? null,
                'selling_price' => $linkedChannelSku->selling_price ?? 0,
                'cost_price' => $linkedChannelSku->cost_price ?? 0,
                'marketplace_id' => null,
                'is_active' => true,
            ]);
        } elseif ($storeSku->user_id === null) {
            // Adopt legacy store sku rows into current user scope so later lookups succeed.
            $storeSku->update(['user_id' => $userId]);
        }

        // If the channel SKU has any inventory rows under MAIN STORE locations (created by prior incorrect deductions),
        // move them to the store SKU so the shop balance reflects reality and the channel SKU stops showing negatives.
        $storeLocationIds = InventoryLocation::query()
            ->where('channel_id', $storeChannelId)
            ->pluck('id')
            ->map(fn ($v) => (int) $v)
            ->filter()
            ->values()
            ->all();

        if (empty($storeLocationIds)) {
            return;
        }

        $badRows = SkuInventory::query()
            ->where('sku_id', $linkedChannelSku->id)
            ->whereIn('location_id', $storeLocationIds)
            ->lockForUpdate()
            ->get();

        foreach ($badRows as $row) {
            $qty = (int) ($row->quantity ?? 0);
            $dest = SkuInventory::query()->firstOrCreate(
                ['sku_id' => $storeSku->id, 'location_id' => $row->location_id],
                ['quantity' => 0, 'reserved' => 0, 'user_id' => $userId]
            );
            if ($qty !== 0) {
                $dest->update(['quantity' => (int) $dest->quantity + $qty]);
            }
            $row->delete();
        }
    }

    private function resolveMainStoreChannelId(): int
    {
        $candidates = Channel::query()
            ->where(function ($q) {
                $q->where('is_active', true)->orWhereNull('is_active');
            })
            ->get(['id', 'name', 'slug']);

        foreach ($candidates as $c) {
            $name = strtolower((string) ($c->name ?? ''));
            $slug = strtolower((string) ($c->slug ?? ''));
            if (
                str_contains($name, 'store')
                || str_contains($name, 'shop')
                || str_contains($name, 'main')
                || str_contains($name, 'المحل')
                || str_contains($slug, 'store')
                || str_contains($slug, 'shop')
                || str_contains($slug, 'main')
            ) {
                return (int) $c->id;
            }
        }

        return 1;
    }

    private function generateStoreSkuCode(Sku $linkedChannelSku, ?string $preferred, int $offerId): string
    {
        $preferred = trim((string) $preferred);
        $base = $preferred !== '' ? $preferred : trim((string) $linkedChannelSku->sku);
        if ($base === '') {
            $base = 'STORE';
        }

        $candidate = $base;
        $userId = (int) (auth()->id() ?? $linkedChannelSku->user_id ?? 0);
        $isTaken = static fn (string $code) => $userId > 0
            ? SkuUniquenessGuard::existsForUser($userId, $code)
            : Sku::query()->where('sku', $code)->exists();

        if ($isTaken($candidate)) {
            $candidate = $base.'-STORE';
        }
        if ($isTaken($candidate)) {
            $candidate = $base.'-STORE-'.$offerId;
        }
        if ($isTaken($candidate)) {
            $candidate = 'STORE-'.$offerId;
        }
        $suffix = 2;
        while ($isTaken($candidate) && $suffix < 100) {
            $candidate = 'STORE-'.$offerId.'-'.$suffix;
            $suffix++;
        }

        return $candidate;
    }

    public function destroy(string $id)
    {
        $sku = Sku::findOrFail($id);

        try {
            DB::transaction(function () use ($sku) {
                InventoryAdjustment::query()->where('sku_id', $sku->id)->delete();
                QuotationItem::query()->where('sku_id', $sku->id)->delete();
                $sku->inventory()->delete();
                $sku->delete();
            });
        } catch (\Throwable $e) {
            report($e);

            return response()->json([
                'message' => 'Cannot delete this SKU because other records still reference it.',
            ], 422);
        }

        return response()->json(null, 204);
    }
}
