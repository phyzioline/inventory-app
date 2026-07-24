<?php

namespace App\Domain\Models\Wms;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\MorphTo;
use App\Infrastructure\Traits\IsIsolatedByUser;

class Expense extends Model
{
    use IsIsolatedByUser;

    protected $table = 'inv_expenses';

    protected $fillable = [
        'expense_number', 'type', 'category', 'amount', 'description',
        'expense_date', 'reference_type', 'reference_id', 'user_id',
        'warehouse_id', 'payment_method', 'vendor_name', 'finance_account_id',
    ];

    protected $casts = [
        'amount' => 'decimal:2',
        'expense_date' => 'date',
    ];

    public function reference(): MorphTo
    {
        return $this->morphTo();
    }

    public function scopeByType(Builder $query, string $type): Builder
    {
        return $query->where('type', $type);
    }

    public function scopeByDateRange(Builder $query, string $startDate, string $endDate): Builder
    {
        return $query->whereBetween('expense_date', [$startDate, $endDate]);
    }
}
