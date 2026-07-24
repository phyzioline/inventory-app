<?php

namespace App\Domain\Models\Wms;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;

class OrderCost extends Model
{
    use HasFactory;

    protected $fillable = [
        'inventory_order_id', 'type', 'amount',
    ];

    protected $casts = [
        'amount' => 'decimal:2',
    ];

    public function order()
    {
        return $this->belongsTo(\App\Domain\Models\Wms\InventoryOrder::class, 'inventory_order_id');
    }
}
