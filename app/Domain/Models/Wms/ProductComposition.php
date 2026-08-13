<?php

namespace App\Domain\Models\Wms;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use App\Infrastructure\Traits\IsIsolatedByUser;
use Database\Factories\ProductCompositionFactory;

class ProductComposition extends Model
{
    use HasFactory, IsIsolatedByUser;

    protected $fillable = [
        'parent_offer_id', 'component_offer_id', 'quantity_per', 'notes',
    ];

    protected $casts = [
        'quantity_per' => 'integer',
    ];

    protected static function newFactory(): ProductCompositionFactory
    {
        return ProductCompositionFactory::new();
    }

    public function parentOffer()
    {
        return $this->belongsTo(InventoryOffer::class, 'parent_offer_id');
    }

    public function componentOffer()
    {
        return $this->belongsTo(InventoryOffer::class, 'component_offer_id');
    }
}
