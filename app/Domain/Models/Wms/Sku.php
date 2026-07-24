<?php

namespace App\Domain\Models\Wms;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use App\Infrastructure\Traits\IsIsolatedByUser;
use Database\Factories\SkuFactory;

class Sku extends Model
{
    use HasFactory, IsIsolatedByUser;

    protected $fillable = [
        'offer_id', 'sku', 'marketplace_id', 'channel_id',
        'cost_price', 'selling_price', 'is_active', 'image_url', 'name',
        'channel_listing_id',
    ];

    protected $casts = [
        'cost_price' => 'decimal:2',
        'selling_price' => 'decimal:2',
        'is_active' => 'boolean',
    ];

    protected static function newFactory(): SkuFactory
    {
        return SkuFactory::new();
    }

    protected static function booted(): void
    {
        static::creating(function (Sku $sku) {
            if ($sku->cost_price === null) {
                $sku->cost_price = 0;
            }
            if ($sku->selling_price === null) {
                $sku->selling_price = 0;
            }
            if ($sku->is_active === null) {
                $sku->is_active = true;
            }
        });

        static::updating(function (Sku $sku) {
            if ($sku->isDirty('cost_price') && $sku->cost_price === null) {
                $sku->cost_price = 0;
            }
            if ($sku->isDirty('selling_price') && $sku->selling_price === null) {
                $sku->selling_price = 0;
            }
        });
    }

    public function offer()
    {
        return $this->belongsTo(\App\Domain\Models\Wms\InventoryOffer::class, 'offer_id');
    }

    public function channel()
    {
        return $this->belongsTo(\App\Domain\Models\Wms\Channel::class);
    }

    public function inventory()
    {
        return $this->hasMany(\App\Domain\Models\Wms\SkuInventory::class);
    }
}
