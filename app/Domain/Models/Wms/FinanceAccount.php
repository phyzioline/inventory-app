<?php

namespace App\Domain\Models\Wms;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use App\Infrastructure\Traits\IsIsolatedByUser;

class FinanceAccount extends Model
{
    use IsIsolatedByUser;

    protected $table = 'inv_finance_accounts';

    protected $fillable = [
        'user_id', 'name', 'account_type', 'opening_balance', 'currency', 'sort_order',
    ];

    protected $casts = [
        'opening_balance' => 'decimal:2',
        'sort_order' => 'integer',
    ];

    public function receipts(): HasMany
    {
        return $this->hasMany(\App\Domain\Models\Wms\Receipt::class, 'finance_account_id');
    }

    public function payments(): HasMany
    {
        return $this->hasMany(\App\Domain\Models\Wms\Payment::class, 'finance_account_id');
    }

    public function expenses(): HasMany
    {
        return $this->hasMany(\App\Domain\Models\Wms\Expense::class, 'finance_account_id');
    }
}
