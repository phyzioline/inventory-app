<?php

namespace App\Domain\Models\Wms;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use App\Infrastructure\Traits\IsIsolatedByUser;

class Warehouse extends Model
{
    use IsIsolatedByUser;

    protected $fillable = [
        'name', 'type', 'location', 'is_active', 'is_main',
    ];

    protected $casts = [
        'is_active' => 'boolean',
    ];

    public function inventory(): HasMany
    {
        return $this->hasMany(\App\Domain\Models\Wms\Inventory::class);
    }
}
