<?php

namespace App\Domain\Models\Wms;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use App\Infrastructure\Traits\IsIsolatedByUser;
use Database\Factories\InventoryOrderItemFactory;

class InventoryOrderItem extends Model
{
    use HasFactory, IsIsolatedByUser;

    protected $fillable = [
        'inventory_order_id', 'sku_id', 'sku_code',
        'product_name', 'quantity', 'unit_price', 'total_price',
        'stock_deduction_status', 'stock_shortage_reason',
    ];

    protected static function newFactory(): InventoryOrderItemFactory
    {
        return InventoryOrderItemFactory::new();
    }

    protected $casts = [
        'unit_price' => 'decimal:2',
        'total_price' => 'decimal:2',
    ];

    public function order()
    {
        return $this->belongsTo(\App\Domain\Models\Wms\InventoryOrder::class, 'inventory_order_id');
    }

    public function sku()
    {
        return $this->belongsTo(\App\Domain\Models\Wms\Sku::class);
    }
}
