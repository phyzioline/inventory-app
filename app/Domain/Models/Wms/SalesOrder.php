<?php

namespace App\Domain\Models\Wms;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use App\Infrastructure\Traits\IsIsolatedByUser;

class SalesOrder extends Model
{
    use IsIsolatedByUser;

    protected $fillable = [
        'order_number', 'external_order_number', 'warehouse_id', 'status', 'total_amount', 'order_date',
    ];

    protected $casts = [
        'total_amount' => 'decimal:2',
        'order_date' => 'datetime',
    ];

    public function warehouse(): BelongsTo
    {
        return $this->belongsTo(\App\Domain\Models\Wms\Warehouse::class);
    }

    public function items(): HasMany
    {
        return $this->hasMany(\App\Domain\Models\Wms\SalesOrderItem::class);
    }
}
