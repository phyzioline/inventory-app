<?php

namespace App\Domain\Models\Wms;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use App\Infrastructure\Traits\IsIsolatedByUser;

class ProfitDistribution extends Model
{
    use IsIsolatedByUser;

    protected $fillable = [
        'user_id',
        'capital_source_id',
        'amount',
        'period_start',
        'period_end',
        'distribution_date',
        'status',
        'notes',
    ];

    protected $casts = [
        'amount' => 'decimal:2',
        'period_start' => 'date',
        'period_end' => 'date',
        'distribution_date' => 'date',
    ];

    public function capitalSource(): BelongsTo
    {
        return $this->belongsTo(CapitalSource::class);
    }

    public function markAsPaid(): bool
    {
        return $this->update(['status' => 'paid']);
    }
}
