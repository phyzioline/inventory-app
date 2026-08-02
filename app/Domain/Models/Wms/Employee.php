<?php

namespace App\Domain\Models\Wms;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use App\Infrastructure\Traits\IsIsolatedByUser;

class Employee extends Model
{
    use IsIsolatedByUser;

    protected $table = 'inv_employees';

    protected $fillable = [
        'user_id',
        'name',
        'job_title',
        'phone',
        'base_salary',
        'is_active',
        'hired_at',
        'notes',
    ];

    protected $casts = [
        'base_salary' => 'decimal:2',
        'is_active' => 'boolean',
        'hired_at' => 'date',
    ];

    public function scopeActive(Builder $query): Builder
    {
        return $query->where('is_active', true);
    }
}
