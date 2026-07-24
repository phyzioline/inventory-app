<?php

namespace App\Domain\Models\Wms;

use Illuminate\Database\Eloquent\Model;
use App\Infrastructure\Traits\IsIsolatedByUser;

class InventoryAdjustment extends Model
{
    use IsIsolatedByUser;

    protected $fillable = [
        'sku_id', 'location_id', 'type', 'quantity', 'reason', 'notes',
        'purchase_batch_item_id', 'unit_cost', 'total_loss_amount', 'user_id',
    ];

    protected $casts = [
        'quantity' => 'decimal:2',
        'unit_cost' => 'decimal:2',
        'total_loss_amount' => 'decimal:2',
    ];

    public function sku()
    {
        return $this->belongsTo(\App\Domain\Models\Wms\Sku::class);
    }

    public function location()
    {
        return $this->belongsTo(\App\Domain\Models\Wms\InventoryLocation::class);
    }

    public function batchItem()
    {
        return $this->belongsTo(\App\Domain\Models\Wms\PurchaseBatchItem::class, 'purchase_batch_item_id');
    }

    public function user()
    {
        return $this->belongsTo(\App\Models\User::class);
    }
}
