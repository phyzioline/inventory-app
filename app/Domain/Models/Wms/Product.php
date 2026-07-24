<?php

namespace App\Domain\Models\Wms;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Product extends Model
{
    protected $fillable = [
        'name', 'sku', 'barcode', 'description', 'images', 'cost', 'price', 'stock',
    ];

    protected $casts = [
        'images' => 'array',
        'cost' => 'decimal:2',
        'price' => 'decimal:2',
        'stock' => 'integer',
    ];

    public function asins(): HasMany
    {
        return $this->hasMany(\App\Domain\Models\Wms\ASIN::class);
    }

    public function inventory(): HasMany
    {
        return $this->hasMany(\App\Domain\Models\Wms\Inventory::class);
    }
}
