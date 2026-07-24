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
        'master_product_id', 'name', 'type', 'components',
    ];

    protected static function newFactory(): InventoryOfferFactory
    {
        return InventoryOfferFactory::new();
    }

    protected $casts = [
        'components' => 'array',
    ];

    public function masterProduct()
    {
        return $this->belongsTo(\App\Domain\Models\Wms\MasterProduct::class);
    }

    public function skus()
    {
        return $this->hasMany(\App\Domain\Models\Wms\Sku::class, 'offer_id');
    }
}
