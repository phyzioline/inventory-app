<?php

namespace App\Domain\Models\Wms;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\MorphTo;
use App\Infrastructure\Traits\IsIsolatedByUser;

class Receipt extends Model
{
    use IsIsolatedByUser;

    protected $table = 'inv_receipts';

    protected $fillable = [
        'receipt_number', 'type', 'category', 'amount', 'description',
        'receipt_date', 'payment_method', 'reference_type', 'reference_id',
        'external_reference', 'user_id', 'warehouse_id', 'payer_name', 'finance_account_id',
    ];

    protected $casts = [
        'amount' => 'decimal:2',
        'receipt_date' => 'date',
    ];

    public function user(): BelongsTo
    {
        return $this->belongsTo(\App\Models\User::class);
    }

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
        return $query->whereBetween('receipt_date', [$startDate, $endDate]);
    }
}
