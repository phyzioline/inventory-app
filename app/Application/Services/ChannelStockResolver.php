<?php

namespace App\Application\Services;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;
use App\Domain\Models\Wms\Channel;
use App\Domain\Models\Wms\InventoryLocation;
use App\Domain\Models\Wms\Sku;
use App\Domain\Models\Wms\SkuInventory;

/**
 * Single place for "where does this channel's sales consume stock from?"
 * Merchant/MFN: deduct from merchant-channel stock first; if insufficient, fall back to main store (المحل).
 */
class ChannelStockResolver
{
    public const MAIN_STORE_CHANNEL_ID = 1;

    private static ?int $mainStoreChannelIdCache = null;

    /**
     * Clear static channel-resolution caches (required after RefreshDatabase in tests).
     */
    public static function clearCache(): void
    {
        self::$mainStoreChannelIdCache = null;
    }

    /**
     * True when this channel's sales consume stock from the main store bucket.
     *
     * This is intentionally based on scope resolution (not string matching alone),
     * because some merchant channels may not include "merchant/fbm/mfn" in their name/slug.
     */
    public static function deductsFromMainStoreBucket(int $channelId): bool
    {
        $storeId = self::resolveMainStoreChannelId();
        if ($storeId <= 0) {
            return false;
        }

        // If the channel itself is the store, it's not a "merchant deducing from store";
        // it's simply a store order.
        if ($channelId === $storeId) {
            return false;
        }

        return self::resolveStockScopeChannelId($channelId) === $storeId;
    }

    public static function isMerchantChannel(?int $channelId): bool
    {
        if ($channelId === null || $channelId <= 0) {
            return false;
        }
        $channel = Channel::query()->find($channelId);
        if (! $channel) {
            return false;
        }

        return self::isMerchantChannelModel($channel);
    }

    public static function isMerchantChannelModel(Channel $channel): bool
    {
        $explicitType = strtolower(trim((string) ($channel->type ?? '')));
        if ($explicitType !== '') {
            if (str_contains($explicitType, 'merchant')) {
                return true;
            }
            if (in_array($explicitType, ['fbm', 'mfn', 'merchant_fulfilled', 'amazon_fbm', 'amazon_mfn'], true)) {
                return true;
            }
        }
        $name = strtolower((string) ($channel->name ?? ''));
        $slug = strtolower((string) ($channel->slug ?? ''));

        return str_contains($name, 'merchant')
            || str_contains($name, 'mfn')
            || str_contains($name, 'fbm')
            || str_contains($name, 'تاجر')
            || str_contains($slug, 'merchant')
            || str_contains($slug, 'mfn')
            || str_contains($slug, 'fbm');
    }

    public static function isFbaChannel(?int $channelId): bool
    {
        if ($channelId === null || $channelId <= 0) {
            return false;
        }
        $channel = Channel::query()->find($channelId);
        if (! $channel) {
            return false;
        }

        return self::isFbaChannelModel($channel);
    }

    public static function isFbaChannelModel(Channel $channel): bool
    {
        $explicitType = strtolower(trim((string) ($channel->type ?? '')));
        if ($explicitType !== '') {
            if (str_contains($explicitType, 'fba') || $explicitType === 'afn') {
                return true;
            }
        }
        $name = strtolower((string) ($channel->name ?? ''));
        $slug = strtolower((string) ($channel->slug ?? ''));

        // Avoid matching "التاجر" / merchant when checking FBA.
        if (self::isMerchantChannelModel($channel)) {
            return false;
        }

        return str_contains($name, 'fba')
            || str_contains($slug, 'fba')
            || (bool) preg_match('/\bfba\b|\bafn\b/', $name.' '.$slug);
    }

    /**
     * @param  list<int>  $channelIds
     * @return array<int, true>
     */
    public static function merchantChannelIdSet(array $channelIds): array
    {
        $ids = array_values(array_unique(array_filter(array_map('intval', $channelIds), fn ($id) => $id > 0)));
        if ($ids === []) {
            return [];
        }

        $set = [];
        foreach (Channel::query()->whereIn('id', $ids)->get(['id', 'name', 'slug', 'type']) as $channel) {
            if (self::isMerchantChannelModel($channel)) {
                $set[(int) $channel->id] = true;
            }
        }

        return $set;
    }

    public static function resolveMainStoreChannelId(): int
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
                self::$mainStoreChannelIdCache = (int) $c->id;

                return self::$mainStoreChannelIdCache;
            }
        }

        self::$mainStoreChannelIdCache = self::MAIN_STORE_CHANNEL_ID;

        return self::$mainStoreChannelIdCache;
    }

    /**
     * Physical stock bucket channel id for a listing (merchant -> main store).
     */
    public static function resolveStockScopeChannelId(?int $listingChannelId): int
    {
        if ($listingChannelId === null || $listingChannelId <= 0) {
            return 0;
        }
        if (self::isMerchantChannel($listingChannelId)) {
            return self::resolveMainStoreChannelId();
        }

        return $listingChannelId;
    }

    public static function resolveFirstLocationIdForChannel(int $channelId): ?int
    {
        $channelLocation = InventoryLocation::query()
            ->where('channel_id', $channelId)
            ->where(function ($q) {
                $q->where('is_active', true)->orWhereNull('is_active');
            })
            ->orderBy('id')
            ->first();

        if ($channelLocation) {
            return (int) $channelLocation->id;
        }

        $fallbackActive = InventoryLocation::query()
            ->where(function ($q) {
                $q->where('is_active', true)->orWhereNull('is_active');
            })
            ->orderBy('id')
            ->first();

        if ($fallbackActive) {
            return (int) $fallbackActive->id;
        }

        $any = InventoryLocation::query()->orderBy('id')->first();

        return $any ? (int) $any->id : null;
    }

    /**
     * Primary warehouse for a channel (no merchant → store redirect).
     */
    public static function resolveDeductionLocationIdForChannel(int $channelId): ?int
    {
        return self::resolveFirstLocationIdForChannel($channelId);
    }

    /**
     * Match MasterProductController — المحل / physical store shows full on-hand per SKU.
     */
    public static function isLocalStoreLikeChannel(?Channel $channel): bool
    {
        if (! $channel) {
            return false;
        }
        $slug = mb_strtolower((string) ($channel->slug ?? ''));
        $name = mb_strtolower((string) ($channel->name ?? ''));
        foreach (['store', 'shop', 'main', 'physical'] as $needle) {
            if (str_contains($slug, $needle) || str_contains($name, $needle)) {
                return true;
            }
        }
        foreach (['المحل', 'المخزن'] as $ar) {
            if (str_contains($name, $ar)) {
                return true;
            }
        }

        return false;
    }

    /**
     * Warehouse location ids tagged to a sales channel.
     *
     * @return list<int>
     */
    public static function resolveLocationIdsForChannel(int $channelId): array
    {
        if ($channelId <= 0) {
            return [];
        }

        return InventoryLocation::query()
            ->where('channel_id', $channelId)
            ->orderBy('id')
            ->pluck('id')
            ->map(fn ($id) => (int) $id)
            ->filter(fn ($id) => $id > 0)
            ->values()
            ->all();
    }

    /**
     * Warehouse location ids used for channel SKU stock (same rules as master-products "المخزون").
     *
     * @return list<int>
     */
    public static function resolveChannelStockLocationIdsForSku(Sku $sku, int $channelId): array
    {
        if ((int) $sku->id <= 0 || $channelId <= 0) {
            return [];
        }

        $rows = SkuInventory::query()
            ->where('sku_id', (int) $sku->id)
            ->with('location')
            ->get();

        $ids = [];
        $hadTaggedMatch = false;
        foreach ($rows as $row) {
            $loc = $row->location;
            if ($loc && (int) ($loc->channel_id ?? 0) === $channelId) {
                $ids[(int) $row->location_id] = true;
                $hadTaggedMatch = true;
            }
        }
        if ($hadTaggedMatch) {
            return array_values(array_map('intval', array_keys($ids)));
        }

        $linkedId = (int) (self::resolveFirstLocationIdForChannel($channelId) ?? 0);

        return $linkedId > 0 ? [$linkedId] : [];
    }

    /**
     * Sales channel whose warehouse bucket should be used for stock on this listing SKU.
     */
    public static function resolveStockChannelIdForSku(Sku $sku, int $orderChannelId): int
    {
        if (self::deductsFromMainStoreBucket($orderChannelId)) {
            return $orderChannelId;
        }

        $skuChannelId = (int) ($sku->channel_id ?? 0);

        return $skuChannelId > 0 ? $skuChannelId : $orderChannelId;
    }

    /**
     * Channel stock from an already-loaded inventory relation (avoids N+1 on list pages).
     */
    public static function availableQuantityFromPreloadedInventory(Sku $sku, ?int $channelId = null): float
    {
        if ((int) $sku->id <= 0) {
            return 0.0;
        }

        $listingChannelId = (int) ($channelId ?? $sku->channel_id ?? 0);
        /** @var Collection<int, SkuInventory> $invs */
        $invs = $sku->relationLoaded('inventory') ? $sku->inventory : collect();

        // Eager-loaded but empty: query DB here. ForSkuListing / ForSkuAtChannelLocations
        // would call back into this method and recurse until stack overflow (master-products 500).
        if ($sku->relationLoaded('inventory') && $invs->isEmpty()) {
            if ($listingChannelId <= 0) {
                return max(0.0, (float) SkuInventory::query()
                    ->where('sku_id', (int) $sku->id)
                    ->sum('quantity'));
            }

            $locationIds = self::resolveChannelStockLocationIdsForSku($sku, $listingChannelId);
            if ($locationIds === []) {
                return 0.0;
            }

            return max(0.0, (float) SkuInventory::query()
                ->where('sku_id', (int) $sku->id)
                ->whereIn('location_id', $locationIds)
                ->sum('quantity'));
        }

        if ($listingChannelId <= 0) {
            return max(0.0, (float) $invs->sum(fn ($r) => (float) ($r->quantity ?? 0)));
        }

        $sumAtChannel = 0.0;
        $hadTaggedMatch = false;
        foreach ($invs as $row) {
            $loc = $row->relationLoaded('location') ? $row->location : null;
            if ($loc && (int) ($loc->channel_id ?? 0) === $listingChannelId) {
                $sumAtChannel += (float) ($row->quantity ?? 0);
                $hadTaggedMatch = true;
            }
        }
        if ($hadTaggedMatch) {
            return $sumAtChannel;
        }

        $linkedId = 0;
        if ($sku->relationLoaded('channel') && $sku->channel) {
            $locs = $sku->channel->relationLoaded('locations') ? $sku->channel->locations : collect();
            $linkedId = (int) ($locs->sortBy('id')->first()?->id ?? 0);
        }
        if ($linkedId <= 0) {
            $linkedId = (int) (self::resolveFirstLocationIdForChannel($listingChannelId) ?? 0);
        }
        if ($linkedId <= 0) {
            return 0.0;
        }

        return max(0.0, (float) $invs
            ->where('location_id', $linkedId)
            ->sum(fn ($r) => (float) ($r->quantity ?? 0)));
    }

    /**
     * On-hand for this SKU at warehouse locations tagged to its listing channel.
     */
    public static function availableQuantityForSkuAtChannelLocations(Sku $sku, ?int $channelId = null): float
    {
        $listingChannelId = (int) ($channelId ?? $sku->channel_id ?? 0);
        if ($listingChannelId <= 0 || (int) $sku->id <= 0) {
            return 0.0;
        }

        if ($sku->relationLoaded('inventory')) {
            return self::availableQuantityFromPreloadedInventory($sku, $listingChannelId);
        }

        $locationIds = self::resolveChannelStockLocationIdsForSku($sku, $listingChannelId);
        if ($locationIds === []) {
            return 0.0;
        }

        return max(0.0, (float) SkuInventory::query()
            ->where('sku_id', (int) $sku->id)
            ->whereIn('location_id', $locationIds)
            ->sum('quantity'));
    }

    /**
     * On-hand for a channel listing row: this SKU only at warehouse locations tagged to its channel.
     */
    public static function availableQuantityForSkuListing(Sku $sku): float
    {
        if ($sku->relationLoaded('inventory')) {
            return self::availableQuantityFromPreloadedInventory($sku);
        }

        if (empty($sku->channel_id)) {
            return max(0.0, (float) SkuInventory::query()
                ->where('sku_id', (int) $sku->id)
                ->sum('quantity'));
        }

        return self::availableQuantityForSkuAtChannelLocations($sku);
    }

    /**
     * Available qty for a SKU at a channel's warehouse locations — never pools sibling listings.
     */
    public static function availableQuantityForChannelSku(int $skuId, int $channelId): float
    {
        if ($skuId <= 0 || $channelId <= 0) {
            return 0.0;
        }

        $sku = Sku::query()->find($skuId);
        if (! $sku) {
            return 0.0;
        }

        return self::availableQuantityForSkuAtChannelLocations($sku, $channelId);
    }

    /**
     * @deprecated Use {@see availableQuantityForChannelSku}
     */
    public static function availableQuantityAtChannelLocations(int $skuId, int $channelId): float
    {
        return self::availableQuantityForChannelSku($skuId, $channelId);
    }

    /**
     * Batch store-bucket availability for merchant listing SKUs (list/index pages).
     * Avoids per-row planMerchantOrderDeduction / resolveStoreSkuId queries.
     *
     * @param  Collection<int, Sku>|\Illuminate\Support\Collection<int, Sku>|iterable<int, Sku>  $listingSkus
     * @return array<int, float> listing_sku_id => store_available qty
     */
    public static function batchStoreAvailableForListingSkus(iterable $listingSkus): array
    {
        $storeChannelId = self::resolveMainStoreChannelId();
        if ($storeChannelId <= 0) {
            return [];
        }

        $listingById = [];
        $masterIds = [];
        $offerIds = [];
        foreach ($listingSkus as $sku) {
            if (! $sku instanceof Sku) {
                continue;
            }
            $id = (int) $sku->id;
            if ($id <= 0) {
                continue;
            }
            $listingById[$id] = $sku;
            $masterId = (int) ($sku->offer?->master_product_id ?? 0);
            if ($masterId > 0) {
                $masterIds[$masterId] = true;
            }
            $offerId = (int) ($sku->offer_id ?? 0);
            if ($offerId > 0) {
                $offerIds[$offerId] = true;
            }
        }

        if ($listingById === []) {
            return [];
        }

        $result = array_fill_keys(array_keys($listingById), 0.0);
        if ($masterIds === [] && $offerIds === []) {
            return $result;
        }

        $storeSkus = Sku::query()
            ->where('channel_id', $storeChannelId)
            ->where(function ($q) use ($masterIds, $offerIds) {
                if ($masterIds !== []) {
                    $q->orWhereHas('offer', static fn ($oq) => $oq->whereIn('master_product_id', array_keys($masterIds)));
                }
                if ($offerIds !== []) {
                    $q->orWhereIn('offer_id', array_keys($offerIds));
                }
            })
            ->with('offer:id,master_product_id')
            ->get(['id', 'offer_id', 'channel_id']);

        if ($storeSkus->isEmpty()) {
            return $result;
        }

        $storeSkuIds = $storeSkus->pluck('id')->map(fn ($id) => (int) $id)->filter(fn ($id) => $id > 0)->values()->all();
        $storeLocationIds = self::resolveLocationIdsForChannel($storeChannelId);

        $qtyByStoreSkuId = [];
        if ($storeSkuIds !== []) {
            $invQuery = SkuInventory::query()->whereIn('sku_id', $storeSkuIds);
            if ($storeLocationIds !== []) {
                $invQuery->whereIn('location_id', $storeLocationIds);
            }
            foreach ($invQuery->selectRaw('sku_id, SUM(quantity) as total_qty')->groupBy('sku_id')->get() as $row) {
                $qtyByStoreSkuId[(int) $row->sku_id] = max(0.0, (float) ($row->total_qty ?? 0));
            }
        }

        $storeSkuIdsByMaster = [];
        $storeSkuIdByOffer = [];
        foreach ($storeSkus as $storeSku) {
            $sid = (int) $storeSku->id;
            $masterId = (int) ($storeSku->offer?->master_product_id ?? 0);
            $offerId = (int) ($storeSku->offer_id ?? 0);
            if ($masterId > 0) {
                $storeSkuIdsByMaster[$masterId][] = $sid;
            }
            if ($offerId > 0 && ! isset($storeSkuIdByOffer[$offerId])) {
                $storeSkuIdByOffer[$offerId] = $sid;
            }
        }

        foreach ($listingById as $listingId => $listingSku) {
            $storeSkuId = 0;
            $masterId = (int) ($listingSku->offer?->master_product_id ?? 0);
            if ($masterId > 0 && ! empty($storeSkuIdsByMaster[$masterId])) {
                $bestId = 0;
                $bestQty = -1.0;
                foreach ($storeSkuIdsByMaster[$masterId] as $sid) {
                    $qty = $qtyByStoreSkuId[$sid] ?? 0.0;
                    if ($qty > $bestQty) {
                        $bestQty = $qty;
                        $bestId = $sid;
                    }
                }
                $storeSkuId = $bestId > 0 ? $bestId : (int) $storeSkuIdsByMaster[$masterId][0];
            } else {
                $offerId = (int) ($listingSku->offer_id ?? 0);
                if ($offerId > 0) {
                    $storeSkuId = (int) ($storeSkuIdByOffer[$offerId] ?? 0);
                }
            }

            $result[$listingId] = $storeSkuId > 0 ? (float) ($qtyByStoreSkuId[$storeSkuId] ?? 0.0) : 0.0;
        }

        return $result;
    }

    /**
     * Store-channel SKU id for the same master product as the listing SKU.
     */
    public static function resolveStoreSkuIdForListingSku(Sku $listingSku): ?int
    {
        $storeChannelId = self::resolveMainStoreChannelId();
        $masterId = (int) ($listingSku->offer?->master_product_id ?? 0);
        if ($storeChannelId <= 0) {
            return null;
        }

        if ($masterId > 0) {
            $storeSkuIds = Sku::query()
                ->where('channel_id', $storeChannelId)
                ->whereHas('offer', static fn ($q) => $q->where('master_product_id', $masterId))
                ->pluck('id')
                ->map(fn ($id) => (int) $id)
                ->filter(fn ($id) => $id > 0)
                ->all();

            if ($storeSkuIds !== []) {
                $bestId = (int) (SkuInventory::query()
                    ->whereIn('sku_id', $storeSkuIds)
                    ->selectRaw('sku_id, SUM(quantity) as total_qty')
                    ->groupBy('sku_id')
                    ->orderByDesc('total_qty')
                    ->value('sku_id') ?? 0);

                if ($bestId > 0) {
                    return $bestId;
                }

                return (int) $storeSkuIds[0];
            }
        }

        $offerId = (int) ($listingSku->offer_id ?? 0);
        if ($offerId > 0) {
            $id = (int) (Sku::query()
                ->where('offer_id', $offerId)
                ->where('channel_id', $storeChannelId)
                ->orderByDesc('id')
                ->value('id') ?? 0);

            return $id > 0 ? $id : null;
        }

        return null;
    }

    /**
     * Merchant orders: try listing (merchant) channel stock, then main store for the same product.
     *
     * @return array{
     *   listing_sku_id: int,
     *   store_sku_id: int|null,
     *   merchant_location_id: int|null,
     *   store_location_id: int|null,
     *   merchant_available: float,
     *   store_available: float,
     *   can_fulfill: bool,
     *   deduct_merchant_qty: float,
     *   deduct_store_qty: float,
     * }
     */
    public static function planMerchantOrderDeduction(int $listingSkuId, int $orderChannelId, float $quantity): array
    {
        $qty = max(0.0, (float) $quantity);
        $empty = [
            'listing_sku_id' => $listingSkuId,
            'store_sku_id' => null,
            'merchant_location_id' => null,
            'store_location_id' => null,
            'merchant_available' => 0.0,
            'store_available' => 0.0,
            'can_fulfill' => false,
            'deduct_merchant_qty' => 0.0,
            'deduct_store_qty' => 0.0,
        ];

        if ($listingSkuId <= 0 || $orderChannelId <= 0 || $qty <= 0) {
            return $empty;
        }

        // Merchant/MFN channels are virtual listings — physical stock lives in المحل (main store) only.
        // Merchant warehouse locations may contain phantom stock (e.g. mis-booked returns); reconcile those
        // separately via reconcilePhantomMerchantStockForListingSku(). This method intentionally deducts
        // from the main store only so that the deduction logic matches the preview simulation.
        $merchantAvail = 0.0;
        $fromMerchant = 0.0;
        $remaining = $qty;

        $storeChannelId = self::resolveMainStoreChannelId();
        $listingSku = Sku::query()->with('offer')->find($listingSkuId);
        $storeSkuId = $listingSku ? self::resolveStoreSkuIdForListingSku($listingSku) : null;
        $storeAvail = 0.0;
        $fromStore = 0.0;

        if ($remaining > 0.0000001 && $storeSkuId > 0 && $storeChannelId > 0) {
            $storeAvail = self::availableQuantityForChannelSku((int) $storeSkuId, $storeChannelId);
            $fromStore = min($remaining, $storeAvail);
        }

        $merchantLoc = self::resolveDeductionLocationIdAtChannel($listingSkuId, $orderChannelId, (int) ceil($fromMerchant));
        $storeLoc = ($storeSkuId > 0 && $fromStore > 0)
            ? self::resolveDeductionLocationIdAtChannel((int) $storeSkuId, $storeChannelId, (int) ceil($fromStore))
            : null;

        return [
            'listing_sku_id' => $listingSkuId,
            'store_sku_id' => $storeSkuId > 0 ? (int) $storeSkuId : null,
            'merchant_location_id' => $merchantLoc,
            'store_location_id' => $storeLoc,
            'merchant_available' => $merchantAvail,
            'store_available' => $storeAvail,
            'can_fulfill' => ($fromMerchant + $fromStore + 1e-9) >= $qty,
            'deduct_merchant_qty' => $fromMerchant,
            'deduct_store_qty' => $fromStore,
        ];
    }

    /**
     * Pick a location for this channel (merchant channel uses merchant warehouse, not المحل).
     */
    public static function resolveDeductionLocationIdAtChannel(int $skuId, int $channelId, int $quantity = 1): ?int
    {
        if ($skuId <= 0 || $channelId <= 0) {
            return null;
        }

        $qty = max(1, $quantity);
        $preferredLoc = (int) (self::resolveFirstLocationIdForChannel($channelId) ?? 0);
        $channel = Channel::query()->find($channelId);

        if ($channel && self::isLocalStoreLikeChannel($channel)) {
            if ($preferredLoc > 0) {
                $atPreferred = (float) (SkuInventory::query()
                    ->where('sku_id', $skuId)
                    ->where('location_id', $preferredLoc)
                    ->value('quantity') ?? 0);
                if ($atPreferred + 1e-9 >= (float) $qty) {
                    return $preferredLoc;
                }
            }

            $row = SkuInventory::query()
                ->where('sku_id', $skuId)
                ->where('quantity', '>=', $qty)
                ->orderByDesc('quantity')
                ->first(['location_id']);

            return $row ? (int) $row->location_id : ($preferredLoc > 0 ? $preferredLoc : null);
        }

        if ($preferredLoc > 0) {
            $atPreferred = (float) (SkuInventory::query()
                ->where('sku_id', $skuId)
                ->where('location_id', $preferredLoc)
                ->value('quantity') ?? 0);
            if ($atPreferred + 1e-9 >= (float) $qty) {
                return $preferredLoc;
            }
        }

        $sku = Sku::query()->find($skuId);
        if ($sku) {
            $scopedIds = self::resolveChannelStockLocationIdsForSku($sku, $channelId);
            if ($scopedIds !== []) {
                $row = SkuInventory::query()
                    ->where('sku_id', $skuId)
                    ->whereIn('location_id', $scopedIds)
                    ->where('quantity', '>=', $qty)
                    ->orderByDesc('quantity')
                    ->first(['location_id']);
                if ($row) {
                    return (int) $row->location_id;
                }

                $anyStock = SkuInventory::query()
                    ->where('sku_id', $skuId)
                    ->whereIn('location_id', $scopedIds)
                    ->where('quantity', '>', 0)
                    ->orderByDesc('quantity')
                    ->first(['location_id']);
                if ($anyStock) {
                    return (int) $anyStock->location_id;
                }
            }
        }

        $row = SkuInventory::query()
            ->where('sku_id', $skuId)
            ->where('quantity', '>=', $qty)
            ->whereHas('location', static fn ($lq) => $lq->where('channel_id', $channelId))
            ->orderByDesc('quantity')
            ->first(['location_id']);

        if ($row) {
            return (int) $row->location_id;
        }

        if ($preferredLoc > 0) {
            $atLinked = (float) (SkuInventory::query()
                ->where('sku_id', $skuId)
                ->where('location_id', $preferredLoc)
                ->value('quantity') ?? 0);
            if ($atLinked > 0) {
                return $preferredLoc;
            }
        }

        return $preferredLoc > 0 ? $preferredLoc : null;
    }

    /**
     * Move mistaken merchant-bucket stock (e.g. old return restocks) into the main store SKU.
     * Writes TRANSFER + IN ledger rows so الترحيلات / تتبع الحركة stay accurate.
     *
     * @return float Quantity moved
     */
    public static function reconcilePhantomMerchantStockForListingSku(Sku $listingSku, int $merchantChannelId): float
    {
        if ((int) $listingSku->id <= 0 || $merchantChannelId <= 0 || ! self::deductsFromMainStoreBucket($merchantChannelId)) {
            return 0.0;
        }

        $result = app(StockRehomeTransferService::class)
            ->reconcilePhantomMerchantStockWithLedger($listingSku, $merchantChannelId);

        return (float) ($result['moved'] ?? 0.0);
    }

    /**
     * Combined fulfillable qty for merchant orders (merchant channel + المحل fallback).
     */
    public static function availableQuantityForMerchantOrder(Sku $listingSku, int $orderChannelId): float
    {
        $plan = self::planMerchantOrderDeduction((int) $listingSku->id, $orderChannelId, 1.0);

        return max(0.0, (float) $plan['merchant_available']) + max(0.0, (float) $plan['store_available']);
    }

    /**
     * Inventory rows in scope for an order channel (matches SkuController listing rules).
     * Merchant orders: store bucket + listing channel primary locations.
     */
    public static function skuInventoryInScopeQuery(int $skuId, int $orderChannelId): Builder
    {
        $scopeChannelId = self::resolveStockScopeChannelId($orderChannelId);
        if ($scopeChannelId <= 0) {
            $scopeChannelId = $orderChannelId;
        }

        $channelIds = array_values(array_unique(array_filter([
            $scopeChannelId,
            $orderChannelId > 0 && $orderChannelId !== $scopeChannelId ? $orderChannelId : null,
        ])));

        $primaryLocationIds = [];
        foreach ($channelIds as $chId) {
            $lid = (int) (self::resolveFirstLocationIdForChannel($chId) ?? 0);
            if ($lid > 0) {
                $primaryLocationIds[] = $lid;
            }
        }
        $primaryLocationIds = array_values(array_unique($primaryLocationIds));

        return SkuInventory::query()
            ->where('sku_id', $skuId)
            ->where(function ($q) use ($primaryLocationIds, $channelIds) {
                if ($primaryLocationIds !== []) {
                    $q->whereIn('location_id', $primaryLocationIds);
                }
                if ($channelIds !== []) {
                    $q->orWhereHas('location', static function ($lq) use ($channelIds) {
                        $lq->whereIn('channel_id', $channelIds);
                    });
                }
            });
    }

    /**
     * Available qty for a channel SKU listing — mirrors SkuController::quantityForChannelScopedSku.
     */
    public static function availableQuantityForSku(Sku $sku, int $scopeChannelId): float
    {
        if ($scopeChannelId <= 0 || (int) $sku->id <= 0) {
            return 0.0;
        }

        return max(0.0, (float) self::skuInventoryInScopeQuery((int) $sku->id, $scopeChannelId)->sum('quantity'));
    }

    public static function availableQuantityForOrderChannel(Sku $sku, int $orderChannelId): float
    {
        if ($orderChannelId <= 0 || (int) $sku->id <= 0) {
            return 0.0;
        }

        if (self::deductsFromMainStoreBucket($orderChannelId)) {
            return self::availableQuantityForMerchantOrder($sku, $orderChannelId);
        }

        $stockChannelId = self::resolveStockChannelIdForSku($sku, $orderChannelId);

        return self::availableQuantityForSkuAtChannelLocations($sku, $stockChannelId);
    }

    public static function availableQuantityForSkuId(int $skuId, int $orderChannelId): float
    {
        if ($skuId <= 0) {
            return 0.0;
        }

        $sku = Sku::query()->find($skuId);
        if (! $sku) {
            return 0.0;
        }

        return self::availableQuantityForOrderChannel($sku, $orderChannelId);
    }

    /**
     * Prefer the channel's primary location, then any in-scope location with enough stock.
     */
    public static function resolveDeductionLocationIdForSku(int $skuId, int $channelId, int $quantity = 1): ?int
    {
        if ($skuId <= 0 || $channelId <= 0) {
            return null;
        }

        if (self::deductsFromMainStoreBucket($channelId)) {
            $plan = self::planMerchantOrderDeduction($skuId, $channelId, (float) max(1, $quantity));
            if ($plan['deduct_merchant_qty'] > 0 && $plan['merchant_location_id']) {
                return (int) $plan['merchant_location_id'];
            }
            if ($plan['deduct_store_qty'] > 0 && $plan['store_location_id']) {
                return (int) $plan['store_location_id'];
            }

            return $plan['merchant_location_id'] ?? $plan['store_location_id'];
        }

        $qty = max(1, $quantity);

        return self::resolveDeductionLocationIdAtChannel($skuId, $channelId, $qty);
    }

    /**
     * True when at least one in-scope location can fulfill the full quantity.
     */
    public static function hasFulfillableLocationForSku(int $skuId, int $channelId, int $quantity): bool
    {
        if ($skuId <= 0 || $channelId <= 0 || $quantity <= 0) {
            return false;
        }

        if (self::deductsFromMainStoreBucket($channelId)) {
            $plan = self::planMerchantOrderDeduction($skuId, $channelId, (float) max(1, $quantity));

            return (bool) $plan['can_fulfill'];
        }

        $qty = max(1, $quantity);

        $sku = Sku::query()->find($skuId);
        if (! $sku) {
            return false;
        }

        $stockChannelId = self::resolveStockChannelIdForSku($sku, $channelId);
        $locationIds = self::resolveChannelStockLocationIdsForSku($sku, $stockChannelId);
        if ($locationIds === []) {
            return false;
        }

        return SkuInventory::query()
            ->where('sku_id', $skuId)
            ->whereIn('location_id', $locationIds)
            ->where('quantity', '>=', $qty)
            ->exists();
    }
}
