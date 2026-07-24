<?php

namespace App\Domain\Models\Wms;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use App\Infrastructure\Traits\IsIsolatedByUser;

class CapitalSource extends Model
{
    use IsIsolatedByUser;

    protected $fillable = [
        'name', 'type', 'amount', 'ownership_percentage', 'user_id',
    ];

    protected $casts = [
        'amount' => 'decimal:2',
        'ownership_percentage' => 'decimal:2',
    ];

    public function profitDistributions(): HasMany
    {
        return $this->hasMany(\App\Domain\Models\Wms\ProfitDistribution::class);
    }

    public function withdrawals(): HasMany
    {
        return $this->hasMany(\App\Domain\Models\Wms\Withdrawal::class);
    }

    public function calculateTotalContribution(): float
    {
        return (float) $this->amount;
    }

    public function getOwnershipPercentage(): float
    {
        $totalCapital = static::sum('amount');

        return $totalCapital > 0 ? ($this->amount / $totalCapital) * 100 : 0;
    }

    public function getNetPosition(): float
    {
        $distributions = $this->profitDistributions()->where('status', 'paid')->sum('amount');
        $withdrawals = $this->withdrawals()->where('status', 'completed')->sum('amount');

        return $this->amount - $distributions - $withdrawals;
    }
}
