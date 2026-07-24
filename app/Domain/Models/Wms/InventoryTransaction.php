<?php

namespace App\Domain\Models\Wms;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use App\Infrastructure\Traits\IsIsolatedByUser;
use Database\Factories\InventoryTransactionFactory;

class InventoryTransaction extends Model
{
    use HasFactory, IsIsolatedByUser;

    protected $fillable = [
        'sku_id', 'location_id', 'type', 'quantity', 'reference_type', 'reference_id', 'notes',
    ];

    protected static function newFactory(): InventoryTransactionFactory
    {
        return InventoryTransactionFactory::new();
    }

    protected $casts = [
        'quantity' => 'integer',
    ];

    public function sku()
    {
        return $this->belongsTo(\App\Domain\Models\Wms\Sku::class);
    }

    public function location()
    {
        return $this->belongsTo(\App\Domain\Models\Wms\InventoryLocation::class, 'location_id');
    }
}
