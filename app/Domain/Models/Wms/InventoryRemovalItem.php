<?php

namespace App\Domain\Models\Wms;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use App\Infrastructure\Traits\IsIsolatedByUser;

class InventoryRemovalItem extends Model
{
    use IsIsolatedByUser;

    protected $table = 'inventory_removal_items';

    protected $fillable = [
        'user_id',
        'inventory_removal_order_id', 'sku_code', 'fnsku', 'disposition',
        'requested_quantity', 'cancelled_quantity', 'disposed_quantity',
        'shipped_quantity', 'in_process_quantity',
        'removal_fee', 'currency',
        'receive_status', 'received_at', 'received_location_id', 'received_quantity',
    ];

    protected $casts = [
        'requested_quantity' => 'integer',
        'cancelled_quantity' => 'integer',
        'disposed_quantity' => 'integer',
        'shipped_quantity' => 'integer',
        'in_process_quantity' => 'integer',
        'received_quantity' => 'integer',
        'received_at' => 'datetime',
        'removal_fee' => 'decimal:4',
    ];

    public function removalOrder(): BelongsTo
    {
        return $this->belongsTo(\App\Domain\Models\Wms\InventoryRemovalOrder::class, 'inventory_removal_order_id');
    }

    public function receivedLocation(): BelongsTo
    {
        return $this->belongsTo(\App\Domain\Models\Wms\InventoryLocation::class, 'received_location_id');
    }
}
