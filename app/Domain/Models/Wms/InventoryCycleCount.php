<?php

namespace App\Domain\Models\Wms;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use App\Infrastructure\Traits\IsIsolatedByUser;

class InventoryCycleCount extends Model
{
    use IsIsolatedByUser;

    protected $fillable = [
        'user_id', 'location_id', 'status', 'notes', 'posted_at',
    ];

    protected $casts = [
        'posted_at' => 'datetime',
    ];

    public function location(): BelongsTo
    {
        return $this->belongsTo(InventoryLocation::class, 'location_id');
    }

    public function items(): HasMany
    {
        return $this->hasMany(InventoryCycleCountItem::class, 'cycle_count_id');
    }
}
