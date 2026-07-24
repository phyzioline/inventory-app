<?php

namespace App\Application\Services;

use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Schema;
use App\Domain\Models\Wms\InventoryReturn;

class InventoryReturnListingService
{
    public function paginate(Request $request): LengthAwarePaginator
    {
        $perPage = max(1, min((int) $request->input('per_page', 50), 1000));
        $heavy = $request->boolean('heavy', false);

        $with = $heavy
            ? ['inventoryOrder.items.sku.offer.masterProduct', 'inventoryOrder.channel']
            : [
                'inventoryOrder:id,platform_order_id,customer_name,order_date,channel_id',
                'inventoryOrder.channel:id,name,slug',
            ];

        $query = InventoryReturn::with($with)
            ->where(function ($q) {
                $q->whereNull('status')->orWhere('status', '!=', 'void');
            });

        if (! $request->boolean('claims_hub')) {
            $this->scopePhysicalReturnsOnly($query);
        }

        if (Schema::hasColumn('inventory_returns', 'last_update_date')) {
            $query->orderByRaw('COALESCE(inventory_returns.last_update_date, inventory_returns.return_date, inventory_returns.created_at) desc');
        } else {
            $query->orderByDesc('inventory_returns.created_at');
        }

        $search = trim((string) $request->query('search', ''));

        if ($search !== '') {
            $escaped = '%'.addcslashes($search, '%_\\').'%';
            $digitsOnly = preg_replace('/\D+/', '', $search) ?? '';
            $query->where(function ($q) use ($escaped, $search, $digitsOnly) {
                $q->where('platform_return_id', 'like', $escaped)
                    ->orWhere('sku_code', 'like', $escaped)
                    ->orWhere('reason', 'like', $escaped)
                    ->orWhereHas('inventoryOrder', function ($oq) use ($escaped) {
                        $oq->where('platform_order_id', 'like', $escaped)
                            ->orWhere('customer_name', 'like', $escaped)
                            ->orWhereHas('items', function ($iq) use ($escaped) {
                                $iq->where('product_name', 'like', $escaped)
                                    ->orWhere('sku_code', 'like', $escaped)
                                    ->orWhereHas('sku', function ($sq) use ($escaped) {
                                        $sq->where('sku', 'like', $escaped);
                                    });
                            });
                    });

                if (ctype_digit($search)) {
                    $q->orWhere('id', (int) $search);
                }

                if (strlen($digitsOnly) >= 2) {
                    $q->orWhereRaw(
                        "regexp_replace(platform_return_id, '[^0-9]', '', 'g') LIKE ?",
                        ['%'.$digitsOnly.'%']
                    )->orWhereHas('inventoryOrder', function ($oq) use ($digitsOnly) {
                        $oq->whereRaw(
                            "regexp_replace(platform_order_id, '[^0-9]', '', 'g') LIKE ?",
                            ['%'.$digitsOnly.'%']
                        );
                    });
                }
            });
        }

        if ($request->boolean('pending_physical')) {
            $query->where(function ($q) {
                $q->whereIn('return_status', ['return_requested', 'pending', 'in_transit'])
                    ->orWhereIn('inventory_status', ['on_hold', 'pending', 'in_transit']);
            });
        }

        $returns = $query->paginate($perPage);
        $skuMap = SkuImageResolver::mapBySkuCodes($returns->getCollection()->pluck('sku_code'));

        $returns->getCollection()->transform(function (InventoryReturn $return) use ($skuMap) {
            $image = null;
            $name = null;
            $returnSku = trim((string) ($return->sku_code ?? ''));

            foreach ($return->inventoryOrder?->items ?? [] as $item) {
                $itemSku = trim((string) ($item->sku?->sku ?? $item->sku_code ?? ''));

                if (! $item->sku || ($returnSku !== '' && $itemSku !== $returnSku)) {
                    continue;
                }

                $image = SkuImageResolver::urlFromSku($item->sku);
                $name = SkuImageResolver::nameFromSku($item->sku) ?: $item->product_name;

                if ($image) {
                    break;
                }
            }

            if (! $image && $returnSku !== '') {
                $sku = $skuMap->get($returnSku);
                $image = SkuImageResolver::urlFromSku($sku);
                $name = $name ?: SkuImageResolver::nameFromSku($sku);
            }

            $return->setAttribute('product_image_url', $image);

            if ($name) {
                $return->setAttribute('product_name', $name);
            }

            return $return;
        });

        return $returns;
    }

    /**
     * Hide payment-sheet financial markers (RefundPrice: Principal/Shipping, STL-*) unless merged with FBA returns CSV evidence.
     */
    private function scopePhysicalReturnsOnly($query): void
    {
        $query->where(function ($q) {
            $q->where(function ($inner) {
                $inner->whereNull('external_status')
                    ->orWhere('external_status', '!=', 'refund_from_payment_sheet');
            })
                ->orWhere('external_status', 'like', 'fba_returns:%')
                ->orWhereRaw("(metadata->>'fba_license_plate') IS NOT NULL AND (metadata->>'fba_license_plate') <> ''")
                ->orWhereRaw("(metadata->>'fba_row_hash') IS NOT NULL AND (metadata->>'fba_row_hash') <> ''");
        });

        $query->where(function ($q) {
            $q->whereNull('platform_return_id')
                ->orWhere('platform_return_id', 'not like', 'STL-%');
        });
    }
}
