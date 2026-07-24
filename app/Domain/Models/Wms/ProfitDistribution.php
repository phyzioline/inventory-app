<?php

namespace App\Domain\Models\Wms;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ProfitDistribution extends Model
{
    protected $fillable = [
        'capital_source_id', 'amount', 'distribution_date', 'status', 'notes',
    ];

    protected $casts = [
        'amount' => 'decimal:2',
        'distribution_date' => 'date',
    ];

    public function capitalSource(): BelongsTo
    {
        return $this->belongsTo(\App\Domain\Models\Wms\CapitalSource::class);
    }
}
