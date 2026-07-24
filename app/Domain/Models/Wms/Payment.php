<?php

namespace App\Domain\Models\Wms;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\MorphTo;
use App\Infrastructure\Traits\IsIsolatedByUser;

class Payment extends Model
{
    use IsIsolatedByUser;

    protected $table = 'inv_payments';

    protected $fillable = [
        'payment_number', 'payee_type', 'payee_id', 'payee_name', 'warehouse_id',
        'amount', 'payment_method', 'payment_date', 'reference_type', 'reference_id',
        'status', 'notes', 'user_id', 'finance_account_id',
    ];

    protected $casts = [
        'amount' => 'decimal:2',
        'payment_date' => 'date',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(\App\Models\User::class);
    }

    public function payee(): MorphTo
    {
        return $this->morphTo();
    }

    public function reference(): MorphTo
    {
        return $this->morphTo();
    }

    public function scopeByStatus(Builder $query, string $status): Builder
    {
        return $query->where('status', $status);
    }

    public function scopeByDateRange(Builder $query, string $startDate, string $endDate): Builder
    {
        return $query->whereBetween('payment_date', [$startDate, $endDate]);
    }

    public function markCompleted(): bool
    {
        return $this->update(['status' => 'completed']);
    }

    public function cancel(): bool
    {
        return $this->update(['status' => 'cancelled']);
    }
}
