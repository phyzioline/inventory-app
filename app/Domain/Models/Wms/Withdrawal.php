<?php

namespace App\Domain\Models\Wms;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use App\Infrastructure\Traits\IsIsolatedByUser;

class Withdrawal extends Model
{
    use IsIsolatedByUser;

    protected $fillable = [
        'capital_source_id', 'amount', 'withdrawal_date', 'status', 'reason',
    ];

    protected $casts = [
        'amount' => 'decimal:2',
        'withdrawal_date' => 'date',
    ];

    public function capitalSource(): BelongsTo
    {
        return $this->belongsTo(\App\Domain\Models\Wms\CapitalSource::class);
    }
}
