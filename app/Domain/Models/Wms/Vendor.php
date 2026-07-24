<?php

namespace App\Domain\Models\Wms;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use App\Infrastructure\Traits\IsIsolatedByUser;

class Vendor extends Model
{
    use IsIsolatedByUser;

    protected $fillable = [
        'name', 'email', 'phone', 'address', 'current_balance', 'is_active',
    ];

    protected $casts = [
        'current_balance' => 'decimal:2',
        'is_active' => 'boolean',
    ];

    public function scopeActive(Builder $query): Builder
    {
        return $query->where('is_active', true);
    }

    public function updateBalance(float $amount, string $operation = 'add'): bool
    {
        if ($operation === 'add') {
            $this->increment('current_balance', $amount);
        } else {
            $this->decrement('current_balance', $amount);
        }

        return true;
    }

    public function payments()
    {
        return \App\Domain\Models\Wms\Payment::where('payee_type', \App\Domain\Models\Wms\Vendor::class)
            ->where('payee_id', $this->id)
            ->orderBy('payment_date', 'desc')
            ->get();
    }
}
