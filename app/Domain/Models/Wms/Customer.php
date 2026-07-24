<?php

namespace App\Domain\Models\Wms;

use Illuminate\Database\Eloquent\Model;
use App\Infrastructure\Traits\IsIsolatedByUser;

class Customer extends Model
{
    use IsIsolatedByUser;

    protected $fillable = [
        'name', 'email', 'phone', 'tax_id', 'address',
        'credit_limit', 'current_balance', 'currency', 'is_active',
    ];

    protected $casts = [
        'credit_limit' => 'decimal:2',
        'current_balance' => 'decimal:2',
        'is_active' => 'boolean',
    ];

    public function quotations()
    {
        return $this->hasMany(\App\Domain\Models\Wms\Quotation::class);
    }
}
