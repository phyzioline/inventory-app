<?php

namespace App\Domain\Models\Wms;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use App\Infrastructure\Traits\IsIsolatedByUser;

class PurchaseReturnItem extends Model
{
    use IsIsolatedByUser;

    protected $fillable = [
        'user_id', 'purchase_return_id', 'purchase_batch_item_id', 'sku_id',
        'quantity', 'unit_price', 'total_price', 'reason', 'meta',
    ];

    protected $casts = [
        'quantity' => 'decimal:2',
        'unit_price' => 'decimal:2',
        'total_price' => 'decimal:2',
        'meta' => 'array',
    ];

    public function purchaseReturn(): BelongsTo
    {
        return $this->belongsTo(\App\Domain\Models\Wms\PurchaseReturn::class);
    }

    public function batchItem(): BelongsTo
    {
        return $this->belongsTo(\App\Domain\Models\Wms\PurchaseBatchItem::class, 'purchase_batch_item_id');
    }

    public function sku(): BelongsTo
    {
        return $this->belongsTo(\App\Domain\Models\Wms\Sku::class);
    }
}
