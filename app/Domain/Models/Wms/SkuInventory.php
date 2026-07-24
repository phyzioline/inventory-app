<?php

namespace App\Domain\Models\Wms;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use App\Infrastructure\Traits\IsIsolatedByUser;
use Database\Factories\SkuInventoryFactory;

class SkuInventory extends Model
{
    use HasFactory, IsIsolatedByUser;

    protected $table = 'sku_inventory';

    protected $fillable = [
        'sku_id', 'location_id', 'quantity', 'reserved',
    ];

    protected static function newFactory(): SkuInventoryFactory
    {
        return SkuInventoryFactory::new();
    }

    public function sku()
    {
        return $this->belongsTo(\App\Domain\Models\Wms\Sku::class);
    }

    public function location()
    {
        return $this->belongsTo(\App\Domain\Models\Wms\InventoryLocation::class, 'location_id');
    }
}
