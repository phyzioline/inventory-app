<?php

namespace App\Domain\Models\Wms;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use App\Infrastructure\Traits\IsIsolatedByUser;

class TreasuryAccount extends Model
{
    use IsIsolatedByUser;

    protected $table = 'inv_treasury_accounts';

    protected $fillable = [
        'user_id', 'name', 'currency', 'is_default',
    ];

    protected $casts = [
        'is_default' => 'boolean',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(\App\Models\User::class);
    }

    public function cashTransactions(): HasMany
    {
        return $this->hasMany(\App\Domain\Models\Wms\TreasuryCashTransaction::class, 'treasury_account_id');
    }

    public function sulfas(): HasMany
    {
        return $this->hasMany(\App\Domain\Models\Wms\TreasurySulfa::class, 'treasury_account_id');
    }
}
