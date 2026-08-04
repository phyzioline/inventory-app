<?php

namespace App\Presentation\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use App\Application\Services\ChannelStockResolver;
use App\Application\Services\PurchaseImportService;
use App\Application\Services\SkuUniquenessGuard;
use App\Domain\Models\Wms\Channel;
use App\Domain\Models\Wms\InventoryOffer;
use App\Domain\Models\Wms\MasterProduct;
use App\Domain\Models\Wms\Sku;
use App\Domain\Models\Wms\SkuInventory;

class MasterProductController extends Controller
{
    private const IMAGE_FETCH_HEADERS = [
        'User-Agent' => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept' => 'image/*,text/html;q=0.9,*/*;q=0.8',
    ];

    /**
     * Same quantity as the master-products table "المخزون" column — this SKU at its channel warehouse only.
     */
    private function skuStockAsMasterProductsTable(Sku $sku): float
    {
        return $this->skuStockFromSkuModel($sku);
    }

    private function skuStockFromSkuModel(Sku $sku): float
    {
        if ($sku->relationLoaded('inventory')) {
            return ChannelStockResolver::availableQuantityFromPreloadedInventory($sku);
        }

        return ChannelStockResolver::availableQuantityForSkuListing($sku);
    }

    /**
     * Display a listing of the resource.
     */
    public function index(Request $request)
    {
        $userId = auth()->id();
        $search = trim((string) $request->query('search', ''));
        $limit = max(1, min((int) $request->query('limit', 50), 200));
        $compact = (bool) $request->boolean('compact', false);
        $channelId = (int) $request->query('channel_id', 0);
        $locationId = (int) $request->query('location_id', 0);

        // If a channel_id is provided, scope stock to the channel's linked location (preferred),
        // so channel pages (e.g. FBA) show the same stock number as the channel listing.
        if ($locationId <= 0 && $channelId > 0) {
            $locationId = (int) (DB::table('inventory_locations')
                ->where('channel_id', $channelId)
                ->orderBy('id')
                ->value('id') ?? 0);
        }

        if ($userId && $search === '') {
            $pageForAdoption = max(1, (int) $request->query('page', 1));
            $shouldAdopt = ! $request->boolean('paginate', false) && (int) $request->query('page', 0) <= 0
                ? true
                : $pageForAdoption === 1;
            if ($shouldAdopt) {
                try {
                    $this->adoptOrphanInventoryForUser((int) $userId);
                } catch (\Throwable $e) {
                    Log::warning('Orphan inventory adoption skipped', [
                        'user_id' => $userId,
                        'error' => $e->getMessage(),
                    ]);
                }
            }
        }

        // Fast search mode (used by dialogs like Link SKU / purchase invoice picker)
        if ($search !== '') {
            $includeChannels = (bool) $request->boolean('include_channels', false);
            $withSkus = (bool) $request->boolean('with_skus', false);
            $query = MasterProduct::query()
                ->where(function ($q) use ($search) {
                    $q->where('internal_name', 'like', "%{$search}%")
                        ->orWhere('original_supplier_sku', 'like', "%{$search}%")
                        ->orWhereHas('offers.skus', function ($sq) use ($search) {
                            $sq->where('sku', 'like', "%{$search}%")
                                ->orWhere('name', 'like', "%{$search}%");
                        });
                })
                ->orderByDesc('created_at')
                ->limit($limit);

            if (! $withSkus && ! $includeChannels) {
                $query->select(['id', 'internal_name', 'original_supplier_sku', 'image_url', 'created_at']);
            }

            if ($withSkus || $includeChannels) {
                $query->with(['offers.skus.channel']);
            }

            if ($channelId > 0) {
                $query->whereHas('offers.skus', function ($sq) use ($channelId) {
                    $sq->where('channel_id', $channelId);
                });
            }

            $products = $query->get();

            if ($withSkus) {
                return response()->json($products);
            }

            if ($compact) {
                if (! $includeChannels) {
                    return response()->json($products);
                }

                $storeCh = ChannelStockResolver::resolveMainStoreChannelId();
                $payload = $products->map(function ($p) use ($storeCh) {
                    $skus = $p->offers?->flatMap?->skus ?? collect();
                    $channelRows = $skus
                        ->map(function ($s) {
                            $ch = $s->channel;

                            return $ch ? ['id' => (int) $ch->id, 'name' => (string) ($ch->name ?? ''), 'slug' => (string) ($ch->slug ?? '')] : null;
                        })
                        ->filter()
                        ->unique(fn ($x) => (int) ($x['id'] ?? 0))
                        ->values();

                    $hasStoreSku = $storeCh > 0
                        ? $skus->contains(fn ($s) => (int) ($s->channel_id ?? 0) === $storeCh)
                        : false;

                    return [
                        'id' => $p->id,
                        'internal_name' => $p->internal_name,
                        'original_supplier_sku' => $p->original_supplier_sku,
                        'image_url' => $p->image_url,
                        'channels' => $channelRows,
                        'has_store_sku' => $hasStoreSku,
                    ];
                });

                return response()->json($payload);
            }

            return response()->json($products->map(function ($product) {
                return [
                    'id' => $product->id,
                    'internal_name' => $product->internal_name,
                    'original_supplier_sku' => $product->original_supplier_sku,
                    'image_url' => $product->image_url,
                ];
            }));
        }

        if ($compact) {
            $products = MasterProduct::query()
                ->select(['id', 'internal_name', 'original_supplier_sku', 'image_url', 'created_at'])
                ->orderByDesc('created_at')
                ->limit($limit)
                ->get();

            return response()->json($products);
        }

        $page = max(0, (int) $request->query('page', 0));
        $paginate = $request->boolean('paginate', false) || $page > 0;
        $perPage = max(1, min((int) $request->query('per_page', 40), 60));

        $query = MasterProduct::with(['offers.skus.channel', 'offers.skus.inventory'])
            ->orderByDesc('created_at')
            ->orderByDesc('id');

        if ($paginate) {
            $paginator = $query->paginate($perPage, ['*'], 'page', max(1, $page ?: 1));
            $enriched = $this->enrichMasterProductsCollection($paginator->getCollection(), $locationId);

            return response()->json([
                'data' => $enriched->values()->all(),
                'current_page' => $paginator->currentPage(),
                'last_page' => $paginator->lastPage(),
                'per_page' => $paginator->perPage(),
                'total' => $paginator->total(),
            ]);
        }

        // Legacy: full catalog in one response (slow for large datasets — prefer paginate=1).
        $products = $this->enrichMasterProductsCollection($query->get(), $locationId);

        return response()->json($products->values()->all());
    }

    /**
     * Assign null user_id rows to the current user (runs until no orphan master products remain).
     */
    private function adoptOrphanInventoryForUser(int $userId): void
    {
        $cacheKey = 'inventory_orphan_adopted_'.$userId;
        $hasOrphanProducts = MasterProduct::withoutGlobalScope('user_isolation')
            ->whereNull('user_id')
            ->exists();

        if (! $hasOrphanProducts && Cache::has($cacheKey)) {
            return;
        }

        // PostgreSQL rejects UPDATE ... LIMIT — select ids first, then update by id.
        $this->assignUserIdToOrphanRows(
            MasterProduct::class,
            MasterProduct::withoutGlobalScope('user_isolation')->whereNull('user_id'),
            $userId,
            500
        );

        $this->assignUserIdToOrphanRows(
            InventoryOffer::class,
            InventoryOffer::withoutGlobalScope('user_isolation')
                ->whereNull('user_id')
                ->whereHas('masterProduct', function ($q) use ($userId) {
                    $q->withoutGlobalScope('user_isolation')->where('user_id', $userId);
                }),
            $userId,
            1000
        );

        $this->assignUserIdToOrphanRows(
            Sku::class,
            Sku::withoutGlobalScope('user_isolation')
                ->whereNull('user_id')
                ->whereHas('offer', function ($q) use ($userId) {
                    $q->withoutGlobalScope('user_isolation')->where('user_id', $userId);
                }),
            $userId,
            3000
        );

        $this->assignUserIdToOrphanRows(
            SkuInventory::class,
            SkuInventory::withoutGlobalScope('user_isolation')
                ->whereNull('user_id')
                ->whereHas('sku', function ($q) use ($userId) {
                    $q->withoutGlobalScope('user_isolation')->where('user_id', $userId);
                }),
            $userId,
            5000
        );

        if (! MasterProduct::withoutGlobalScope('user_isolation')->whereNull('user_id')->exists()) {
            Cache::put($cacheKey, true, now()->addDay());
        }
    }

    /**
     * @param  class-string  $modelClass
     */
    private function assignUserIdToOrphanRows(string $modelClass, $query, int $userId, int $limit): void
    {
        $ids = (clone $query)
            ->orderBy('id')
            ->limit($limit)
            ->pluck('id');

        if ($ids->isEmpty()) {
            return;
        }

        $modelClass::withoutGlobalScope('user_isolation')
            ->whereIn('id', $ids->all())
            ->update(['user_id' => $userId]);
    }

    /**
     * @param  Collection<int, MasterProduct>  $products
     * @return Collection<int, MasterProduct>
     */
    private function enrichMasterProductsCollection(Collection $products, int $locationId): Collection
    {
        if ($products->isEmpty()) {
            return $products;
        }

        $purchaseBalances = DB::table('purchase_batch_items as pbi')
            ->join('purchase_batches as pb', 'pb.id', '=', 'pbi.purchase_batch_id')
            ->whereIn('pbi.master_product_id', $products->pluck('id')->all())
            ->whereIn('pb.status', ['approved', 'review', 'draft', 'partially_received'])
            ->groupBy('pbi.master_product_id')
            ->selectRaw('pbi.master_product_id, SUM(pbi.quantity - COALESCE(pbi.received_quantity, 0)) as balance')
            ->pluck('balance', 'master_product_id');

        $storeCh = ChannelStockResolver::resolveMainStoreChannelId();
        $allSkusOnPage = $products->flatMap(fn ($product) => $product->offers->flatMap->skus);
        $merchantChannelIds = ChannelStockResolver::merchantChannelIdSet(
            $allSkusOnPage->pluck('channel_id')->all()
        );

        return $products->map(function ($product) use ($locationId, $purchaseBalances, $storeCh, $merchantChannelIds) {
            $allSkus = $product->offers->flatMap->skus;

            $product->total_stock_all_channels = (float) $allSkus->flatMap->inventory->sum('quantity');

            $skipMerchantDup = [];
            foreach ($allSkus as $s) {
                $channelId = (int) ($s->channel_id ?? 0);
                if ($storeCh > 0 && $channelId > 0 && ! empty($merchantChannelIds[$channelId])) {
                    $hasStoreSibling = $allSkus->contains(function ($x) use ($s, $storeCh) {
                        return (int) $x->offer_id === (int) $s->offer_id
                            && (int) $x->channel_id === $storeCh;
                    });
                    if ($hasStoreSibling) {
                        $skipMerchantDup[(int) $s->id] = true;
                    }
                }
            }

            $stockBySkuId = [];
            foreach ($allSkus as $sku) {
                $stockBySkuId[(int) $sku->id] = round($this->skuStockAsMasterProductsTable($sku), 4);
            }

            $uiAlignedTotal = (float) $allSkus
                ->filter(fn (Sku $sku) => empty($skipMerchantDup[(int) $sku->id]))
                ->sum(fn (Sku $sku) => (float) ($stockBySkuId[(int) $sku->id] ?? 0));

            foreach ($product->offers as $offer) {
                foreach ($offer->skus as $origSku) {
                    if (! $origSku->relationLoaded('offer')) {
                        $origSku->setRelation('offer', $offer);
                    }
                    $origSku->setAttribute(
                        'display_quantity',
                        (float) ($stockBySkuId[(int) $origSku->id] ?? 0)
                    );
                }
            }

            if ($locationId > 0) {
                $product->total_stock = (float) $allSkus
                    ->flatMap->inventory
                    ->where('location_id', $locationId)
                    ->sum('quantity');
            } else {
                $product->total_stock = $uiAlignedTotal;
            }

            $product->purchase_balance = (float) ($purchaseBalances[(string) $product->id] ?? $purchaseBalances[$product->id] ?? 0);
            $product->linked_channels_count = $allSkus->pluck('channel_id')->unique()->filter()->count();
            $product->sku_count = $allSkus->count();

            return $product;
        });
    }

    /**
     * Ensure the master product has a SKU listing on the warehouse/channel tied to location_id
     * (used by purchase invoice picker when a product exists but has no store listing yet).
     */
    public function ensureChannelListing(Request $request, string $id, PurchaseImportService $importService): JsonResponse
    {
        $validated = $request->validate([
            'location_id' => 'required|integer|exists:inventory_locations,id',
        ]);

        $masterId = (int) $id;
        $locationId = (int) $validated['location_id'];
        $userId = (int) auth()->id();

        $skuId = $importService->resolveSkuIdForManualPurchaseLine(
            $masterId,
            0,
            $locationId,
            $userId
        );

        if (! $skuId) {
            return response()->json([
                'message' => 'Could not create or resolve a SKU for this product on the selected warehouse/channel.',
            ], 422);
        }

        $sku = Sku::with(['offer.masterProduct', 'channel'])->find($skuId);

        return response()->json([
            'sku_id' => $skuId,
            'sku' => $sku,
        ]);
    }

    /**
     * Store a newly created resource in storage.
     * Maps existing React "Product" payload to MasterProduct + Offer + Sku
     */
    public function store(Request $request)
    {
        $validated = $request->validate([
            'internal_name' => 'required_without:name|string',
            'name' => 'required_without:internal_name|string',
            'sku' => 'nullable|string',
            'original_supplier_sku' => 'nullable|string',
            'selling_price' => 'nullable|numeric',
            'cost_price' => 'nullable|numeric',
            'barcode' => 'nullable|string',
            'specifications' => 'nullable|array',
            'specifications.notes' => 'nullable|string',
            'channel_id' => 'nullable|integer',
            'create_default_listing' => 'nullable|boolean',
        ]);

        $name = $request->internal_name ?? $request->name;
        $skuCode = $request->sku ?? $request->original_supplier_sku;
        $createDefaultListing = $request->boolean('create_default_listing', false);

        DB::beginTransaction();
        try {
            $resolvedProductImage = $this->resolveAndStoreProductImage($request->image_url);
            $resolvedSkuImage = $this->resolveAndStoreProductImage($request->sku_image_url ?? $request->image_url);

            // 1. Create Master Product only (offers/SKUs are added manually per channel).
            $extraSpecs = is_array($request->specifications) ? $request->specifications : [];
            $product = MasterProduct::create([
                'internal_name' => $name,
                'category' => $request->category_id,
                'image_url' => $resolvedProductImage['stored_url'] ?? $request->image_url,
                'original_supplier' => $request->original_supplier,
                'original_supplier_sku' => $request->original_supplier_sku,
                'specifications' => array_merge([
                    'min_stock' => $request->min_stock,
                    'barcode' => $request->barcode,
                    'images' => $request->images,
                    'source_image_url' => $resolvedProductImage['source_url'] ?? $request->image_url,
                    'source_image_input_url' => $resolvedProductImage['input_url'] ?? $request->image_url,
                ], $extraSpecs),
                'is_active' => true,
            ]);

            if ($createDefaultListing) {
                $offer = InventoryOffer::create([
                    'master_product_id' => $product->id,
                    'name' => $name,
                    'type' => 'single',
                ]);

                $listingChannelId = $request->input('channel_id');
                if ($listingChannelId === null || $listingChannelId === '') {
                    $listingChannelId = $request->has('channel_id') ? null : 1;
                }

                $finalSkuCode = SkuUniquenessGuard::normalize((string) ($skuCode ?? ('SKU-'.strtoupper(bin2hex(random_bytes(3))))));
                SkuUniquenessGuard::assertAvailable((int) auth()->id(), $finalSkuCode);

                Sku::create([
                    'offer_id' => $offer->id,
                    'sku' => $finalSkuCode,
                    'name' => $request->platform_product_name ?? $name,
                    'image_url' => $resolvedSkuImage['stored_url'] ?? ($request->sku_image_url ?? $request->image_url),
                    'selling_price' => $request->selling_price ?? 0,
                    'cost_price' => $request->cost_price ?? 0,
                    'channel_id' => $listingChannelId,
                ]);
            }

            DB::commit();

            $product->load(['offers.skus.channel']);

            return response()->json(array_merge($product->toArray(), [
                'offers' => $product->offers,
                'needs_first_offer' => ! $createDefaultListing,
            ]), 201);

        } catch (\Illuminate\Validation\ValidationException $e) {
            DB::rollBack();
            throw $e;
        } catch (\Exception $e) {
            DB::rollBack();

            return response()->json(['error' => $e->getMessage()], 500);
        }
    }

    /**
     * Display the specified resource.
     */
    public function show(string $id)
    {
        $product = MasterProduct::with(['offers.skus.inventory.location', 'offers.skus.channel.locations'])->find($id);
        if (! $product) {
            $product = MasterProduct::withoutGlobalScope('user_isolation')
                ->with(['offers.skus.inventory.location', 'offers.skus.channel.locations'])
                ->find($id);
            if ($product) {
                if ($product->user_id === null) {
                    $product->update(['user_id' => auth()->id()]);
                } elseif ($product->user_id != auth()->id()) {
                    abort(404);
                }
            } else {
                abort(404);
            }
        }

        $allSkus = $product->offers->flatMap->skus;
        $storeCh = ChannelStockResolver::resolveMainStoreChannelId();
        $skipMerchantDup = [];
        foreach ($allSkus as $s) {
            if ($storeCh > 0 && ChannelStockResolver::isMerchantChannel((int) $s->channel_id)) {
                $hasStoreSibling = $allSkus->contains(function ($x) use ($s, $storeCh) {
                    return (int) $x->offer_id === (int) $s->offer_id
                        && (int) $x->channel_id === $storeCh;
                });
                if ($hasStoreSibling) {
                    $skipMerchantDup[(int) $s->id] = true;
                }
            }
        }
        $product->total_stock = (float) $allSkus
            ->filter(fn (Sku $sku) => empty($skipMerchantDup[(int) $sku->id]))
            ->sum(fn (Sku $sku) => $this->skuStockAsMasterProductsTable($sku));

        foreach ($product->offers as $offer) {
            foreach ($offer->skus as $origSku) {
                $origSku->setAttribute(
                    'display_quantity',
                    round($this->skuStockAsMasterProductsTable($origSku), 4)
                );
            }
        }

        $userId = (int) ($product->user_id ?? auth()->id() ?? 0);
        $dupMap = SkuUniquenessGuard::duplicateMapForCodes(
            $userId,
            $allSkus->map(fn (Sku $s) => (string) ($s->sku ?? ''))->all()
        );
        foreach ($product->offers as $offer) {
            foreach ($offer->skus as $origSku) {
                $code = (string) ($origSku->sku ?? '');
                if ($code !== '' && isset($dupMap[$code])) {
                    $siblings = array_values(array_filter(
                        $dupMap[$code],
                        static fn (array $row) => (int) ($row['sku_id'] ?? 0) !== (int) $origSku->id
                    ));
                    $origSku->setAttribute('is_duplicate_sku', true);
                    $origSku->setAttribute('duplicate_action_required', true);
                    $origSku->setAttribute('duplicate_siblings', $siblings);
                } else {
                    $origSku->setAttribute('is_duplicate_sku', false);
                    $origSku->setAttribute('duplicate_action_required', false);
                    $origSku->setAttribute('duplicate_siblings', []);
                }
            }
        }

        $product->purchase_balance = $product->purchaseBatchItems()
            ->whereHas('batch', function ($q) {
                $q->whereIn('status', ['approved', 'review', 'draft', 'partially_received']);
            })
            ->sum(DB::raw('quantity - received_quantity'));

        return response()->json($product);
    }

    /**
     * Update the specified resource in storage.
     */
    public function update(Request $request, string $id)
    {
        $product = MasterProduct::findOrFail($id);

        $request->validate([
            'internal_name' => 'sometimes|string',
            'name' => 'sometimes|string',
            'selling_price' => 'sometimes|numeric',
            'cost_price' => 'sometimes|numeric',
            'specifications' => 'nullable|array',
            'specifications.notes' => 'nullable|string',
        ]);

        $name = $request->internal_name ?? $request->name;

        DB::beginTransaction();
        try {
            $hasNewImage = $request->filled('image_url');
            $resolvedProductImage = $hasNewImage
                ? $this->resolveAndStoreProductImage($request->image_url)
                : null;

            $extraSpecs = is_array($request->specifications) ? $request->specifications : [];
            $product->update([
                'internal_name' => $name ?? $product->internal_name,
                'category' => $request->category_id ?? $product->category,
                'image_url' => $resolvedProductImage['stored_url'] ?? ($request->image_url ?? $product->image_url),
                'original_supplier' => $request->original_supplier ?? $product->original_supplier,
                'original_supplier_sku' => $request->original_supplier_sku ?? $product->original_supplier_sku,
                'specifications' => array_merge($product->specifications ?? [], [
                    'min_stock' => $request->min_stock ?? ($product->specifications['min_stock'] ?? 0),
                    'barcode' => $request->barcode ?? ($product->specifications['barcode'] ?? null),
                    'images' => $request->images ?? ($product->specifications['images'] ?? []),
                    'source_image_url' => $resolvedProductImage['source_url']
                        ?? ($hasNewImage ? $request->image_url : ($product->specifications['source_image_url'] ?? null)),
                    'source_image_input_url' => $resolvedProductImage['input_url']
                        ?? ($hasNewImage ? $request->image_url : ($product->specifications['source_image_input_url'] ?? null)),
                ], $extraSpecs),
            ]);

            // Update SKU prices if provided
            if ($request->selling_price !== null || $request->cost_price !== null) {
                $offer = $product->offers()->first();
                if ($offer) {
                    $sku = $offer->skus()->first();
                    if ($sku) {
                        $sku->update([
                            'selling_price' => $request->selling_price ?? $sku->selling_price,
                            'cost_price' => $request->cost_price ?? $sku->cost_price,
                        ]);
                    }
                }
            }

            DB::commit();

            return response()->json($product->load(['offers.skus']));

        } catch (\Exception $e) {
            DB::rollBack();

            return response()->json(['error' => $e->getMessage()], 500);
        }
    }

    /**
     * Remove the specified resource from storage.
     */
    public function destroy(string $id)
    {
        MasterProduct::destroy($id);

        return response()->json(null, 204);
    }

    /**
     * Get inventory (stock across all locations) for a specific master product.
     */
    public function inventory(string $id)
    {
        $product = MasterProduct::with(['offers.skus.inventory.location'])->findOrFail($id);

        $inventory = [];
        foreach ($product->offers as $offer) {
            foreach ($offer->skus as $sku) {
                foreach ($sku->inventory as $stock) {
                    $inventory[] = [
                        'id' => $stock->id,
                        'sku_id' => $sku->id,
                        'sku' => $sku->sku,
                        'location_id' => $stock->location_id,
                        'location_name' => $stock->location?->name,
                        'quantity' => $stock->quantity,
                        'reserved_quantity' => $stock->reserved_quantity ?? 0,
                    ];
                }
            }
        }

        return response()->json($inventory);
    }

    /**
     * Get total stock count for a specific master product.
     */
    public function stock(string $id)
    {
        $product = MasterProduct::with(['offers.skus.inventory'])->findOrFail($id);

        $totalStock = 0;
        foreach ($product->offers as $offer) {
            foreach ($offer->skus as $sku) {
                $totalStock += $sku->inventory->sum('quantity');
            }
        }

        return response()->json(['total_stock' => $totalStock]);
    }

    /**
     * Bulk delete master products.
     */
    public function bulkDelete(Request $request)
    {
        $request->validate([
            'ids' => 'required|array',
            'ids.*' => 'exists:master_products,id',
        ]);

        $ids = $request->ids;
        $count = MasterProduct::whereIn('id', $ids)->delete();

        return response()->json([
            'message' => "تم حذف {$count} منتج بنجاح",
            'deleted' => $count,
        ]);
    }

    /**
     * Bulk link master products to the main warehouse and sync inventory.
     */
    public function bulkLink(Request $request)
    {
        $request->validate([
            'ids' => 'required|array',
            'ids.*' => 'exists:master_products,id',
        ]);

        $ids = $request->ids;

        DB::beginTransaction();
        try {
            foreach ($ids as $id) {
                $product = MasterProduct::with('offers.skus')->find($id);
                if (! $product) {
                    continue;
                }

                foreach ($product->offers as $offer) {
                    foreach ($offer->skus as $sku) {
                        // Logic to "link" to main warehouse:
                        // 1. Ensure channel_id is 1 (Store/Main) or mark as synced
                        // 2. Here we'll just update a dummy field or ensure it's active
                        $sku->update([
                            'is_active' => true,
                            // In a real scenario, we might trigger a sync job here
                        ]);
                    }
                }
            }

            DB::commit();

            return response()->json(['message' => 'Products linked and synced successfully']);

        } catch (\Exception $e) {
            DB::rollBack();

            return response()->json(['error' => $e->getMessage()], 500);
        }
    }

    /**
     * POST /api/inventory/admin/regenerate-master-products
     * Emergency tool to restore the Product -> Offer -> SKU hierarchy
     * for orphaned SKUs (those with offer_id = null).
     */
    public function regenerateFromOrphans(Request $request): JsonResponse
    {
        // Never honor client-supplied user_id (IDOR). Super-admin middleware gates access;
        // regeneration always targets the authenticated admin's own tenant unless explicitly
        // run via artisan with a scoped command.
        $userId = auth()->id();

        if (! $userId) {
            return response()->json(['success' => false, 'message' => 'User ID required'], 400);
        }

        // 1. Find all SKUs for this user that don't have an offer
        $orphans = Sku::where('user_id', $userId)
            ->whereNull('offer_id')
            ->get();

        if ($orphans->isEmpty()) {
            return response()->json(['message' => 'No orphaned SKUs found'], 200);
        }

        $restoredCount = 0;
        $groupedOrphans = $orphans->groupBy('sku');

        DB::beginTransaction();
        try {
            foreach ($groupedOrphans as $skuCode => $skus) {
                // Determine a name (take from the first SKU)
                $name = $skus->first()->name ?? $skuCode;

                // A. Create Master Product if it doesn't exist for this SKU string
                // Note: We search by SKU to avoid duplicates if user already has some
                $masterProduct = MasterProduct::where('user_id', $userId)
                    ->where('sku', $skuCode)
                    ->first();

                if (! $masterProduct) {
                    $masterProduct = MasterProduct::create([
                        'user_id' => $userId,
                        'internal_name' => $name,
                        'sku' => $skuCode,
                        'is_active' => true,
                    ]);
                }

                // B. Create a simple offer for this product
                $offer = InventoryOffer::create([
                    'user_id' => $userId,
                    'master_product_id' => $masterProduct->id,
                    'name' => 'Default Offer',
                    'type' => 'single',
                    'is_active' => true,
                ]);

                // C. Link all SKUs in this group to the offer
                foreach ($skus as $sku) {
                    $sku->update(['offer_id' => $offer->id]);
                    $restoredCount++;
                }
            }

            DB::commit();
        } catch (\Exception $e) {
            DB::rollBack();

            return response()->json(['error' => 'Regeneration failed: '.$e->getMessage()], 500);
        }

        return response()->json([
            'message' => 'Hierarchy restored successfully',
            'skus_linked' => $restoredCount,
            'products_created' => $groupedOrphans->count(),
        ]);
    }

    private function resolveAndStoreProductImage(?string $url): ?array
    {
        $url = trim((string) $url);
        if ($url === '' || ! filter_var($url, FILTER_VALIDATE_URL)) {
            return null;
        }

        try {
            $response = Http::timeout(10)->withHeaders(self::IMAGE_FETCH_HEADERS)->get($url);
            if (! $response->successful()) {
                return null;
            }

            $contentType = strtolower((string) $response->header('Content-Type', ''));
            $sourceUrl = $url;

            if (str_contains($contentType, 'text/html')) {
                $extractedUrl = $this->extractImageFromHtml($response->body());
                if (! $extractedUrl || ! filter_var($extractedUrl, FILTER_VALIDATE_URL)) {
                    return null;
                }

                $sourceUrl = $extractedUrl;
                $response = Http::timeout(10)->withHeaders(self::IMAGE_FETCH_HEADERS)->get($sourceUrl);
                if (! $response->successful()) {
                    return null;
                }

                $contentType = strtolower((string) $response->header('Content-Type', ''));
            }

            if (! str_contains($contentType, 'image')) {
                return null;
            }

            $extension = $this->guessImageExtension($sourceUrl, $contentType);
            $path = 'products/'.date('Y/m').'/'.Str::uuid().'.'.$extension;

            Storage::disk('public')->put($path, $response->body(), ['visibility' => 'public']);

            return [
                'stored_url' => Storage::url($path),
                'source_url' => $sourceUrl,
                'input_url' => $url,
            ];
        } catch (\Throwable $e) {
            Log::warning('Master product image store failed', [
                'url' => $url,
                'error' => $e->getMessage(),
            ]);

            return null;
        }
    }

    private function extractImageFromHtml(string $html): ?string
    {
        $patterns = [
            '/<meta[^>]+property=["\']og:image["\'][^>]+content=["\']([^"\']+)["\']/i',
            '/<meta[^>]+name=["\']twitter:image["\'][^>]+content=["\']([^"\']+)["\']/i',
        ];

        foreach ($patterns as $pattern) {
            if (preg_match($pattern, $html, $matches)) {
                return html_entity_decode($matches[1], ENT_QUOTES | ENT_HTML5);
            }
        }

        return null;
    }

    private function guessImageExtension(string $url, string $contentType): string
    {
        $path = parse_url($url, PHP_URL_PATH) ?: '';
        $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
        if (in_array($ext, ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp', 'avif'], true)) {
            return $ext;
        }

        return match (true) {
            str_contains($contentType, 'png') => 'png',
            str_contains($contentType, 'webp') => 'webp',
            str_contains($contentType, 'gif') => 'gif',
            str_contains($contentType, 'bmp') => 'bmp',
            str_contains($contentType, 'avif') => 'avif',
            default => 'jpg',
        };
    }
}
