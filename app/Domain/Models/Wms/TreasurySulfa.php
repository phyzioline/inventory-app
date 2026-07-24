<?php

namespace App\Domain\Models\Wms;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use App\Infrastructure\Traits\IsIsolatedByUser;

class TreasurySulfa extends Model
{
    use IsIsolatedByUser;

    protected $table = 'inv_treasury_sulfas';

    protected $fillable = [
        'user_id', 'treasury_account_id', 'lender_name', 'principal_amount',
        'amount_paid', 'status', 'borrowed_on', 'due_on', 'notes',
    ];

    protected $casts = [
        'principal_amount' => 'decimal:2',
        'amount_paid' => 'decimal:2',
        'borrowed_on' => 'date',
        'due_on' => 'date',
    ];

    public function treasuryAccount(): BelongsTo
    {
        return $this->belongsTo(\App\Domain\Models\Wms\TreasuryAccount::class, 'treasury_account_id');
    }

    public function cashTransactions(): HasMany
    {
        return $this->hasMany(\App\Domain\Models\Wms\TreasuryCashTransaction::class, 'sulfa_id');
    }

    public function remainingPrincipal(): string
    {
        $p = (float) $this->principal_amount;
        $paid = (float) $this->amount_paid;

        return (string) round(max(0, $p - $paid), 2);
    }
}
