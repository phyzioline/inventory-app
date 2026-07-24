<?php

namespace App\Domain\Models\Wms;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use App\Infrastructure\Traits\IsIsolatedByUser;

class TreasuryCashTransaction extends Model
{
    use IsIsolatedByUser;

    protected $table = 'inv_treasury_cash_transactions';

    protected $fillable = [
        'user_id', 'treasury_account_id', 'direction', 'amount', 'tx_type',
        'reference_type', 'reference_id', 'sulfa_id', 'memo', 'occurred_on',
    ];

    protected $casts = [
        'amount' => 'decimal:2',
        'occurred_on' => 'date',
    ];

    public function treasuryAccount(): BelongsTo
    {
        return $this->belongsTo(\App\Domain\Models\Wms\TreasuryAccount::class, 'treasury_account_id');
    }

    public function sulfa(): BelongsTo
    {
        return $this->belongsTo(\App\Domain\Models\Wms\TreasurySulfa::class, 'sulfa_id');
    }
}
