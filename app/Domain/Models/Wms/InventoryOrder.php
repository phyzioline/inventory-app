<?php

namespace App\Domain\Models\Wms;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use App\Models\User;
use App\Infrastructure\Traits\IsIsolatedByUser;
use Database\Factories\InventoryOrderFactory;

class InventoryOrder extends Model
{
    use HasFactory, IsIsolatedByUser;

    protected $fillable = [
        'platform_order_id', 'channel_id', 'status', 'order_date',
        'customer_name', 'customer_email', 'currency',
        'total_amount', 'shipping_amount', 'tax_amount', 'discount_amount',
        'customer_id', 'payment_type', 'paid_amount', 'remaining_amount',
        'financial_status', 'settlement_status', 'notes',
    ];

    protected static function newFactory(): InventoryOrderFactory
    {
        return InventoryOrderFactory::new();
    }

    protected $attributes = [
        'currency' => 'EGP',
        'shipping_amount' => 0,
        'tax_amount' => 0,
        'discount_amount' => 0,
        'payment_type' => 'credit',
        'paid_amount' => 0,
        'financial_status' => 'pending',
        'settlement_status' => 'pending',
    ];

    protected $casts = [
        'order_date' => 'datetime',
        'total_amount' => 'decimal:2',
        'shipping_amount' => 'decimal:2',
        'tax_amount' => 'decimal:2',
        'discount_amount' => 'decimal:2',
        'paid_amount' => 'decimal:2',
        'remaining_amount' => 'decimal:2',
    ];

    public function channel()
    {
        return $this->belongsTo(\App\Domain\Models\Wms\Channel::class);
    }

    public function customer(): BelongsTo
    {
        return $this->belongsTo(\App\Domain\Models\Wms\Customer::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function items()
    {
        return $this->hasMany(\App\Domain\Models\Wms\InventoryOrderItem::class);
    }

    public function costs()
    {
        return $this->hasMany(\App\Domain\Models\Wms\OrderCost::class);
    }

    public function settlementItems()
    {
        return $this->hasMany(\App\Domain\Models\Wms\SettlementItem::class);
    }

    public function editLogs()
    {
        return $this->hasMany(\App\Domain\Models\Wms\InvoiceEditLog::class, 'inventory_order_id');
    }
}
