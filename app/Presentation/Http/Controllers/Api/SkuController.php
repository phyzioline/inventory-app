<?php

namespace App\Presentation\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use App\Application\Services\ChannelStockResolver;
use App\Domain\Models\Wms\Channel;
use App\Domain\Models\Wms\InventoryAdjustment;
use App\Domain\Models\Wms\InventoryLocation;
use App\Domain\Models\Wms\QuotationItem;
use App\Domain\Models\Wms\Sku;
use App\Domain\Models\Wms\SkuInventory;

class SkuController extends Controller
{
    /**
     * Quantity for channel SKU listing: this channel's warehouse only.
     *
     * @param  int  $scopeChannelId  Page channel id (listing channel).
     * @param  int  $linkedLocationId  First inventory_locations row for that channel.
     */
    private function quantityForChannelScopedSku(Sku $sku, int $scopeChannelId, int $linkedLocationId): float
    {
        if ($scopeChannelId > 0 && (int) $sku->id > 0) {
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

        $masterTotalsById = [];
        if ($channelId > 0 && $scopedLocationId >= 0) {
            foreach ($rows as $sku) {
                $masterId = (int) ($sku->offer?->masterProduct?->id ?? 0);
                if ($masterId <= 0) {
                    continue;
                }
                if (! isset($masterTotalsById[$masterId])) {
                    $masterTotalsById[$masterId] = 0.0;
                }

                $masterTotalsById[$masterId] += ChannelStockResolver::deductsFromMainStoreBucket($channelId)
                    ? 0.0
                    : $this->quantityForChannelScopedSku($sku, $channelId, $scopedLocationId);
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

        return $rows->map(function ($sku) use ($scopedLocationId, $masterTotalsById, $channelId, $linkedLocationByChannelId) {
            $data = $sku->toArray();
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
                if (ChannelStockResolver::deductsFromMainStoreBucket($channelId)) {
                    $plan = ChannelStockResolver::planMerchantOrderDeduction((int) $sku->id, $channelId, 1.0);
                    $data['display_quantity'] = 0;
                    $data['sellable_from_store_quantity'] = round((float) ($plan['store_available'] ?? 0), 4);
                    $phantom = round(
                        (float) $this->quantityForChannelScopedSku($sku, $channelId, $scopedLocationId),
                        4
                    );
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

        $userId = auth()->id();
        if (! empty($validated['channel_id'])) {
            $exists = Sku::where('user_id', $userId)->where('channel_id', $validated['channel_id'])->where('sku', $validated['sku'])->exists();
            if ($exists) {
                return response()->json(['message' => 'SKU already exists for this channel'], 422);
            }
        } else {
            $exists = Sku::where('sku', $validated['sku'])->exists();
            if ($exists) {
                return response()->json(['message' => 'SKU already exists'], 422);
            }
        }

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

        if (array_key_exists('sku', $validated)) {
            $newSku = trim((string) $validated['sku']);
            if ($newSku === '') {
                return response()->json(['message' => 'SKU cannot be empty'], 422);
            }

            $targetChannelId = array_key_exists('channel_id', $validated)
                ? $validated['channel_id']
                : $sku->channel_id;

            $duplicateQuery = Sku::query()
                ->where('id', '!=', $sku->id)
                ->where('user_id', $sku->user_id)
                ->where('sku', $newSku);

            if (! empty($targetChannelId)) {
                $duplicateQuery->where('channel_id', $targetChannelId);
            }

            if ($duplicateQuery->exists()) {
                return response()->json(['message' => 'SKU already exists for this channel'], 422);
            }
        }

        DB::transaction(function () use ($sku, $validated, $previousOfferId, $nextOfferId) {
            $sku->update($validated);

            // When a channel SKU gets linked to an offer (offer_id becomes non-null),
            // ensure the MAIN STORE has a SKU for the same offer so marketplace merchant orders
            // deduct from shop stock instead of creating negative balances on the channel SKU.
            if ($previousOfferId === 0 && $nextOfferId > 0) {
                $this->ensureMainStoreSkuForOfferAndRehomeStoreInventory($sku);
            }
        });

        return response()->json($sku->load(['offer', 'channel']));
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
        if (Sku::query()->where('sku', $candidate)->exists()) {
            $candidate = $base.'-STORE';
        }
        if (Sku::query()->where('sku', $candidate)->exists()) {
            $candidate = $base.'-STORE-'.$offerId;
        }
        if (Sku::query()->where('sku', $candidate)->exists()) {
            $candidate = 'STORE-'.$offerId;
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
