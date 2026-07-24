<?php

namespace App\Domain\Models\Wms;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Inventory extends Model
{
    protected $table = 'inventory';

    protected $fillable = [
        'product_id', 'warehouse_id', 'quantity',
    ];

    protected $casts = [
        'quantity' => 'integer',
    ];

    public function product(): BelongsTo
    {
        return $this->belongsTo(\App\Domain\Models\Wms\Product::class);
    }

    public function warehouse(): BelongsTo
    {
        return $this->belongsTo(\App\Domain\Models\Wms\Warehouse::class);
    }
}
