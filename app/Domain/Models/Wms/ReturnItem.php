<?php

namespace App\Domain\Models\Wms;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use App\Infrastructure\Traits\IsIsolatedByUser;

class ReturnItem extends Model
{
    use IsIsolatedByUser;

    protected $table = 'returns';

    protected $fillable = [
        'product_id', 'warehouse_id', 'sales_order_id', 'quantity', 'condition',
        'detected_channel', 'notes', 'status',
    ];

    public function product(): BelongsTo
    {
        return $this->belongsTo(\App\Domain\Models\Wms\Product::class);
    }

    public function warehouse(): BelongsTo
    {
        return $this->belongsTo(\App\Domain\Models\Wms\Warehouse::class);
    }

    public function salesOrder(): BelongsTo
    {
        return $this->belongsTo(\App\Domain\Models\Wms\SalesOrder::class);
    }
}
