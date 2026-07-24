<?php

namespace App\Domain\Models\Wms;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class PurchaseBatchItem extends Model
{
    protected $fillable = [
        'purchase_batch_id', 'master_product_id', 'sku_id', 'raw_description',
        'product_matched', 'quantity', 'received_quantity', 'remaining_quantity',
        'unit_price', 'total_price', 'variance_quantity', 'variance_notes', 'batch_cost_id',
    ];

    protected $casts = [
        'product_matched' => 'boolean',
        'quantity' => 'decimal:2',
        'received_quantity' => 'decimal:2',
        'remaining_quantity' => 'decimal:2',
        'unit_price' => 'decimal:2',
        'total_price' => 'decimal:2',
        'variance_quantity' => 'decimal:2',
    ];

    public function batch(): BelongsTo
    {
        return $this->belongsTo(\App\Domain\Models\Wms\PurchaseBatch::class, 'purchase_batch_id');
    }

    public function masterProduct(): BelongsTo
    {
        return $this->belongsTo(\App\Domain\Models\Wms\MasterProduct::class);
    }

    public function sku(): BelongsTo
    {
        return $this->belongsTo(\App\Domain\Models\Wms\Sku::class);
    }
}
