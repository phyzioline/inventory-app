<?php

namespace App\Application\Services;

use Illuminate\Support\Collection;
use App\Domain\Models\Wms\Sku;

class SkuImageResolver
{
    public static function urlFromSku(?Sku $sku): ?string
    {
        if (! $sku) {
            return null;
        }

        $master = $sku->offer?->masterProduct;

        return $sku->image_url ?: ($master?->image_url ?: null);
    }

    public static function nameFromSku(?Sku $sku): ?string
    {
        if (! $sku) {
            return null;
        }

        return $sku->offer?->masterProduct?->internal_name ?: $sku->name;
    }

    /**
     * @param  iterable<string|null>  $skuCodes
     * @return Collection<string, Sku>
     */
    public static function mapBySkuCodes(iterable $skuCodes): Collection
    {
        $codes = collect($skuCodes)
            ->map(static fn ($code) => trim((string) $code))
            ->filter()
            ->unique()
            ->values();

        if ($codes->isEmpty()) {
            return collect();
        }

        return Sku::query()
            ->whereIn('sku', $codes)
            ->with(['offer.masterProduct'])
            ->get()
            ->keyBy('sku');
    }
}
