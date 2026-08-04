<?php

namespace App\Domain\Models\Wms;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use App\Models\User;
use App\Infrastructure\Traits\IsIsolatedByUser;

class DraftMasterProduct extends Model
{
    use IsIsolatedByUser;

    protected $fillable = [
        'proposed_name', 'category', 'description', 'specifications', 'barcode', 'sku',
        'supplier_name', 'matched_product_id', 'match_confidence', 'status', 'user_action',
        'import_batch_id', 'user_id', 'created_by', 'notes',
    ];

    protected $casts = [
        'specifications' => 'array',
        'status' => 'string',
        'match_confidence' => 'string',
        'user_action' => 'string',
    ];

    public function matchedProduct(): BelongsTo
    {
        return $this->belongsTo(\App\Domain\Models\Wms\MasterProduct::class, 'matched_product_id');
    }

    public function createdBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function scopePending($query)
    {
        return $query->where('status', 'pending');
    }

    public function scopeNeedsReview($query)
    {
        return $query->where('status', 'pending')
            ->whereIn('match_confidence', ['high', 'low']);
    }

    public function scopeNoMatch($query)
    {
        return $query->where('status', 'pending')
            ->where('match_confidence', 'none');
    }

    public function approve(): void
    {
        $userId = $this->user_id ?? auth()->id();
        if (! $userId) {
            throw new \Exception('Cannot approve draft: no user context.');
        }

        try {
            if ($this->user_action === 'create_new') {
                $skuCode = $this->sku ?? ('SKU-'.now()->format('ymdHi').'-'.strtoupper(bin2hex(random_bytes(2))));
                $existingSku = \App\Domain\Models\Wms\Sku::withoutGlobalScope('user_isolation')
                    ->where('user_id', $userId)
                    ->where('sku', $skuCode)
                    ->with('offer.masterProduct')
                    ->first();

                if ($existingSku) {
                    if ($existingSku->offer_id && $existingSku->offer && $existingSku->offer->masterProduct) {
                        $product = $existingSku->offer->masterProduct;
                        if ($this->barcode && ! $product->aliases()->where('alias_text', $this->barcode)->exists()) {
                            $product->aliases()->create(['alias_text' => $this->barcode, 'alias_type' => 'barcode', 'user_id' => $userId]);
                        }
                        if ($this->sku && ! $product->aliases()->where('alias_text', $this->sku)->exists()) {
                            $product->aliases()->create(['alias_text' => $this->sku, 'alias_type' => 'old_sku', 'user_id' => $userId]);
                        }
                        $this->update(['status' => 'merged', 'matched_product_id' => $product->id]);

                        return;
                    }
                    $product = \App\Domain\Models\Wms\MasterProduct::create([
                        'user_id' => $userId, 'internal_name' => $this->proposed_name,
                        'category' => $this->category, 'original_supplier' => $this->specifications['supplier'] ?? null,
                        'original_supplier_sku' => $this->sku, 'specifications' => $this->specifications, 'is_active' => true,
                    ]);
                    $offer = \App\Domain\Models\Wms\InventoryOffer::create([
                        'user_id' => $userId, 'master_product_id' => $product->id,
                        'name' => $this->proposed_name, 'type' => 'single',
                    ]);
                    $existingSku->update([
                        'offer_id' => $offer->id,
                        'name' => $this->proposed_name,
                        'image_url' => $this->specifications['image_url'] ?? $existingSku->image_url,
                        'cost_price' => $this->decimalStringOrFallback($this->specifications['cost_price'] ?? null, $existingSku->cost_price),
                        'selling_price' => $this->decimalStringOrFallback($this->specifications['selling_price'] ?? null, $existingSku->selling_price),
                    ]);
                    if ($this->barcode) {
                        $product->aliases()->create(['alias_text' => $this->barcode, 'alias_type' => 'barcode', 'user_id' => $userId]);
                    }
                    if ($this->sku) {
                        $product->aliases()->create(['alias_text' => $this->sku, 'alias_type' => 'old_sku', 'user_id' => $userId]);
                    }
                    $this->update(['status' => 'approved', 'matched_product_id' => $product->id]);

                    return;
                }

                $product = \App\Domain\Models\Wms\MasterProduct::create([
                    'user_id' => $userId, 'internal_name' => $this->proposed_name,
                    'category' => $this->category, 'original_supplier' => $this->specifications['supplier'] ?? null,
                    'original_supplier_sku' => $this->sku, 'specifications' => $this->specifications, 'is_active' => true,
                ]);
                $offer = \App\Domain\Models\Wms\InventoryOffer::create([
                    'user_id' => $userId, 'master_product_id' => $product->id,
                    'name' => $this->proposed_name, 'type' => 'single',
                ]);
                $sku = null;
                if ($skuCode) {
                    if (\App\Application\Services\SkuUniquenessGuard::existsForUser((int) $userId, (string) $skuCode)) {
                        throw new \Exception(
                            \App\Application\Services\SkuUniquenessGuard::conflictMessage((int) $userId, (string) $skuCode)['ar']
                        );
                    }
                    $sku = \App\Domain\Models\Wms\Sku::create([
                        'user_id' => $userId,
                        'offer_id' => $offer->id,
                        'sku' => $skuCode,
                        'name' => $this->proposed_name,
                        'image_url' => $this->specifications['image_url'] ?? null,
                        'cost_price' => $this->decimalStringOrFallback($this->specifications['cost_price'] ?? null, '0'),
                        'selling_price' => $this->decimalStringOrFallback($this->specifications['selling_price'] ?? null, '0'),
                        'channel_id' => 1,
                    ]);
                }
                $quantity = $this->specifications['quantity'] ?? 0;
                if ($sku && $quantity > 0) {
                    $location = \App\Domain\Models\Wms\InventoryLocation::where('user_id', $userId)->first();
                    if ($location) {
                        \App\Domain\Models\Wms\SkuInventory::create([
                            'user_id' => $userId, 'sku_id' => $sku->id,
                            'location_id' => $location->id, 'quantity' => $quantity,
                        ]);
                    }
                }
                if ($this->barcode) {
                    $product->aliases()->create(['alias_text' => $this->barcode, 'alias_type' => 'barcode', 'user_id' => $userId]);
                }
                if ($this->sku) {
                    $product->aliases()->create(['alias_text' => $this->sku, 'alias_type' => 'old_sku', 'user_id' => $userId]);
                }
                $this->update(['status' => 'approved', 'matched_product_id' => $product->id]);

            } elseif ($this->user_action === 'link_existing' && $this->matched_product_id) {
                $product = $this->matchedProduct;
                if (! $product) {
                    throw new \Exception("Matched product not found for ID: {$this->matched_product_id}");
                }
                $offer = \App\Domain\Models\Wms\InventoryOffer::where('master_product_id', $product->id)
                    ->where('user_id', $userId)->first();
                if (! $offer) {
                    $offer = \App\Domain\Models\Wms\InventoryOffer::create([
                        'user_id' => $userId, 'master_product_id' => $product->id,
                        'name' => $product->internal_name, 'type' => 'single',
                    ]);
                }
                $skuCode = $this->sku;
                if ($skuCode) {
                    $existingSku = \App\Domain\Models\Wms\Sku::where('sku', $skuCode)->where('user_id', $userId)->first();
                    if (! $existingSku) {
                        \App\Domain\Models\Wms\Sku::create([
                            'user_id' => $userId, 'offer_id' => $offer->id,
                            'sku' => $skuCode, 'name' => $this->proposed_name,
                            'image_url' => $this->specifications['image_url'] ?? null,
                            'cost_price' => $this->decimalStringOrFallback($this->specifications['cost_price'] ?? null, '0'),
                            'selling_price' => $this->decimalStringOrFallback($this->specifications['selling_price'] ?? null, '0'),
                            'channel_id' => 1,
                        ]);
                    }
                }
                if ($this->barcode && ! $product->aliases()->where('alias_text', $this->barcode)->exists()) {
                    $product->aliases()->create(['alias_text' => $this->barcode, 'alias_type' => 'barcode', 'user_id' => $userId]);
                }
                if ($this->sku && ! $product->aliases()->where('alias_text', $this->sku)->exists()) {
                    $product->aliases()->create(['alias_text' => $this->sku, 'alias_type' => 'old_sku', 'user_id' => $userId]);
                }
                $this->update(['status' => 'merged']);
            }
        } catch (\Exception $e) {
            \Log::error("Failed to approve draft product {$this->id}: ".$e->getMessage());
            throw $e;
        }
    }

    public function reject(): void
    {
        $this->update(['status' => 'rejected']);
    }

    private function decimalStringOrFallback(mixed $value, mixed $fallback): string
    {
        if ($value !== null && $value !== '' && is_numeric($value)) {
            return (string) $value;
        }
        if ($fallback !== null && $fallback !== '' && is_numeric($fallback)) {
            return (string) $fallback;
        }

        return '0';
    }
}
