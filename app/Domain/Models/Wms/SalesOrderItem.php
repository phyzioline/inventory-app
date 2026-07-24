<?php

namespace App\Domain\Models\Wms;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use App\Infrastructure\Traits\IsIsolatedByUser;

class SalesOrderItem extends Model
{
    use IsIsolatedByUser;

    protected $fillable = [
        'sales_order_id', 'product_id', 'quantity', 'unit_price', 'total_price',
    ];

    protected $casts = [
        'unit_price' => 'decimal:2',
        'total_price' => 'decimal:2',
        'quantity' => 'integer',
    ];

    public function salesOrder(): BelongsTo
    {
        return $this->belongsTo(\App\Domain\Models\Wms\SalesOrder::class);
    }

    public function product(): BelongsTo
    {
        return $this->belongsTo(\App\Domain\Models\Wms\Product::class);
    }
}
