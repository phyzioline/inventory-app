<?php

namespace App\Application\Services;

use App\Domain\Models\Wms\Sku;
use Illuminate\Support\Collection;
use Illuminate\Validation\ValidationException;

/**
 * Enforces one SKU code per user across all channels / offers / master products.
 * Existing duplicates are flagged (not auto-merged) so stock stays intact.
 */
class SkuUniquenessGuard
{
    /**
     * Normalize SKU code for comparison (trim; empty → '').
     */
    public static function normalize(string $skuCode): string
    {
        return trim($skuCode);
    }

    /**
     * Active (non-deleted) SKU rows sharing this code for the user.
     *
     * @return Collection<int, Sku>
     */
    public static function findExistingForUser(int $userId, string $skuCode, ?int $excludeSkuId = null): Collection
    {
        $code = self::normalize($skuCode);
        if ($userId <= 0 || $code === '') {
            return collect();
        }

        return Sku::query()
            ->where('user_id', $userId)
            ->where('sku', $code)
            ->when($excludeSkuId !== null && $excludeSkuId > 0, fn ($q) => $q->where('id', '!=', $excludeSkuId))
            ->with(['channel:id,name', 'offer:id,master_product_id,name'])
            ->orderBy('id')
            ->get();
    }

    public static function existsForUser(int $userId, string $skuCode, ?int $excludeSkuId = null): bool
    {
        return self::findExistingForUser($userId, $skuCode, $excludeSkuId)->isNotEmpty();
    }

    /**
     * @return list<array{sku_id: int, channel_id: int|null, channel_name: string|null, offer_id: int|null, offer_name: string|null, master_product_id: int|null}>
     */
    public static function locationPayload(Collection $existing): array
    {
        return $existing->map(function (Sku $sku) {
            return [
                'sku_id' => (int) $sku->id,
                'channel_id' => $sku->channel_id !== null ? (int) $sku->channel_id : null,
                'channel_name' => $sku->channel?->name,
                'offer_id' => $sku->offer_id !== null ? (int) $sku->offer_id : null,
                'offer_name' => $sku->offer?->name,
                'master_product_id' => $sku->offer?->master_product_id !== null
                    ? (int) $sku->offer->master_product_id
                    : null,
            ];
        })->values()->all();
    }

    /**
     * Human-readable Arabic / English message listing where the SKU already lives.
     *
     * @return array{ar: string, en: string, locations: list<array<string, mixed>>}
     */
    public static function conflictMessage(int $userId, string $skuCode, ?int $excludeSkuId = null): array
    {
        $existing = self::findExistingForUser($userId, $skuCode, $excludeSkuId);
        $locations = self::locationPayload($existing);
        $code = self::normalize($skuCode);

        $placePartsAr = [];
        $placePartsEn = [];
        foreach ($locations as $loc) {
            $chAr = $loc['channel_name'] ?: ('قناة #'.($loc['channel_id'] ?? '?'));
            $chEn = $loc['channel_name'] ?: ('channel #'.($loc['channel_id'] ?? '?'));
            $offerBitAr = $loc['offer_name']
                ? ' — عرض «'.$loc['offer_name'].'»'
                : ($loc['master_product_id'] ? ' — منتج أساسي #'.$loc['master_product_id'] : '');
            $offerBitEn = $loc['offer_name']
                ? ' — offer «'.$loc['offer_name'].'»'
                : ($loc['master_product_id'] ? ' — master product #'.$loc['master_product_id'] : '');
            $placePartsAr[] = $chAr.$offerBitAr;
            $placePartsEn[] = $chEn.$offerBitEn;
        }

        $placesAr = $placePartsAr !== [] ? implode('، ', $placePartsAr) : 'عرض آخر';
        $placesEn = $placePartsEn !== [] ? implode(', ', $placePartsEn) : 'another listing';

        return [
            'ar' => 'لا يمكن إضافة SKU «'.$code.'» — موجود بالفعل لدى نفس الحساب في: '.$placesAr
                .'. استخدم العرض الموجود أو غيّر كود الـ SKU.',
            'en' => 'Cannot add SKU «'.$code.'» — it already exists on this account in: '.$placesEn
                .'. Use the existing listing or change the SKU code.',
            'locations' => $locations,
        ];
    }

    /**
     * Hard-block create/rename when the code is already used by this user.
     *
     * @throws ValidationException
     */
    public static function assertAvailable(int $userId, string $skuCode, ?int $excludeSkuId = null, string $locale = 'ar'): void
    {
        $code = self::normalize($skuCode);
        if ($userId <= 0 || $code === '') {
            return;
        }

        if (! self::existsForUser($userId, $code, $excludeSkuId)) {
            return;
        }

        $msg = self::conflictMessage($userId, $code, $excludeSkuId);
        $text = $locale === 'en' ? $msg['en'] : $msg['ar'];

        $exception = ValidationException::withMessages([
            'sku' => [$text],
        ]);
        $exception->response = response()->json([
            'message' => $text,
            'sku_duplicate' => true,
            'duplicate_locations' => $msg['locations'],
            'errors' => ['sku' => [$text]],
        ], 422);

        throw $exception;
    }

    /**
     * Codes in $skuCodes that appear more than once for this user (active rows).
     *
     * @param  list<string>  $skuCodes
     * @return array<string, list<array{sku_id: int, channel_id: int|null, channel_name: string|null}>>
     */
    public static function duplicateMapForCodes(int $userId, array $skuCodes): array
    {
        $normalized = [];
        foreach ($skuCodes as $code) {
            $n = self::normalize((string) $code);
            if ($n !== '') {
                $normalized[$n] = true;
            }
        }
        $codes = array_keys($normalized);
        if ($userId <= 0 || $codes === []) {
            return [];
        }

        $rows = Sku::query()
            ->where('user_id', $userId)
            ->whereIn('sku', $codes)
            ->with(['channel:id,name'])
            ->orderBy('id')
            ->get(['id', 'sku', 'channel_id', 'offer_id']);

        /** @var array<string, list<Sku>> $byCode */
        $byCode = [];
        foreach ($rows as $row) {
            $byCode[(string) $row->sku][] = $row;
        }

        $out = [];
        foreach ($byCode as $code => $list) {
            if (count($list) < 2) {
                continue;
            }
            $out[$code] = array_map(static function (Sku $sku) {
                return [
                    'sku_id' => (int) $sku->id,
                    'channel_id' => $sku->channel_id !== null ? (int) $sku->channel_id : null,
                    'channel_name' => $sku->channel?->name,
                ];
            }, $list);
        }

        return $out;
    }
}
