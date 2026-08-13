<?php

namespace App\Domain\Models\Wms;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use App\Infrastructure\Traits\IsIsolatedByUser;
use Database\Factories\InventoryOfferFactory;

class InventoryOffer extends Model
{
    use HasFactory, IsIsolatedByUser;

    protected $fillable = [
        'master_product_id', 'name', 'type',
    ];

    protected static function newFactory(): InventoryOfferFactory
    {
        return InventoryOfferFactory::new();
    }

    public function masterProduct()
    {
        return $this->belongsTo(\App\Domain\Models\Wms\MasterProduct::class);
    }

    public function skus()
    {
        return $this->hasMany(\App\Domain\Models\Wms\Sku::class, 'offer_id');
    }

    /**
     * This offer's own components (it is the parent/kit in the link).
     */
    public function components()
    {
        return $this->hasMany(\App\Domain\Models\Wms\ProductComposition::class, 'parent_offer_id');
    }

    /**
     * Compositions where this offer is used as someone else's component.
     */
    public function usedInCompositions()
    {
        return $this->hasMany(\App\Domain\Models\Wms\ProductComposition::class, 'component_offer_id');
    }
}
