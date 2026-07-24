<?php

namespace App\Domain\Models\Wms;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use App\Infrastructure\Traits\IsIsolatedByUser;

class InventoryRemovalOrder extends Model
{
    use IsIsolatedByUser;

    protected $table = 'inventory_removal_orders';

    protected $fillable = [
        'source', 'removal_order_id', 'order_source', 'order_type',
        'service_speed', 'order_status', 'request_date', 'last_updated_date', 'currency',
    ];

    protected $casts = [
        'request_date' => 'datetime',
        'last_updated_date' => 'datetime',
    ];

    public function items(): HasMany
    {
        return $this->hasMany(\App\Domain\Models\Wms\InventoryRemovalItem::class, 'inventory_removal_order_id');
    }
}
