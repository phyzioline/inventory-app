<?php

namespace App\Domain\Models\Wms;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class InventoryCycleCountItem extends Model
{
    protected $fillable = [
        'cycle_count_id', 'sku_id', 'system_qty', 'counted_qty', 'variance_qty',
    ];

    protected $casts = [
        'system_qty' => 'decimal:4',
        'counted_qty' => 'decimal:4',
        'variance_qty' => 'decimal:4',
    ];

    public function cycleCount(): BelongsTo
    {
        return $this->belongsTo(InventoryCycleCount::class, 'cycle_count_id');
    }

    public function sku(): BelongsTo
    {
        return $this->belongsTo(Sku::class);
    }
}
