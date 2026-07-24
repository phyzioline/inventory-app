<?php

namespace App\Domain\Models\Wms;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use App\Infrastructure\Traits\IsIsolatedByUser;
use Database\Factories\InventoryLocationFactory;

class InventoryLocation extends Model
{
    use HasFactory, IsIsolatedByUser;

    protected $fillable = [
        'name', 'type', 'channel_id', 'address', 'is_active',
    ];

    protected static function newFactory(): InventoryLocationFactory
    {
        return InventoryLocationFactory::new();
    }

    protected $casts = [
        'is_active' => 'boolean',
    ];

    public function channel()
    {
        return $this->belongsTo(\App\Domain\Models\Wms\Channel::class);
    }

    public function inventory()
    {
        return $this->hasMany(\App\Domain\Models\Wms\SkuInventory::class, 'location_id');
    }
}
