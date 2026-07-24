<?php

namespace App\Domain\Models\Wms;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class SettlementItem extends Model
{
    protected $attributes = [
        'reconciliation_status' => 'unreconciled',
    ];

    protected $fillable = [
        'settlement_id', 'platform_order_id', 'transaction_type', 'transaction_status',
        'sku', 'description', 'amount', 'fee_amount', 'quantity', 'merchant_identifier',
        'fulfillment_channel', 'marketplace_name', 'currency', 'transaction_date',
        'raw_data', 'reconciliation_status', 'inventory_order_id',
    ];

    protected $casts = [
        'amount' => 'decimal:2',
        'fee_amount' => 'decimal:2',
        'quantity' => 'integer',
        'transaction_date' => 'datetime',
        'raw_data' => 'array',
    ];

    public function settlement(): BelongsTo
    {
        return $this->belongsTo(\App\Domain\Models\Wms\Settlement::class);
    }

    public function inventoryOrder(): BelongsTo
    {
        return $this->belongsTo(\App\Domain\Models\Wms\InventoryOrder::class);
    }
}
