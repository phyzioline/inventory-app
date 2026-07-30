<?php

namespace App\Infrastructure\Traits;

use App\Application\Support\TenantContext;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\Auth;

trait IsIsolatedByUser
{
    /**
     * Boot the trait and apply the global scope.
     */
    protected static function bootIsIsolatedByUser(): void
    {
        static::addGlobalScope('user_isolation', function (Builder $builder) {
            $table = $builder->getModel()->getTable();
            $tenantId = TenantContext::id();
            if ($tenantId !== null) {
                $builder->where($table.'.user_id', $tenantId);

                return;
            }

            // HTTP without an authenticated user: never return other tenants' rows. Older behaviour
            // (no WHERE) exposed every record with nullable user_id to any session edge case.
            if (! app()->runningInConsole()) {
                $builder->whereRaw('0 = 1');
            }
        });

        static::creating(function ($model) {
            $tenantId = TenantContext::id();
            if ($tenantId !== null && ($model->user_id === null || $model->user_id === '')) {
                $model->user_id = $tenantId;
            }
        });
    }

    /**
     * Relationship to the user who owns this record.
     */
    public function user()
    {
        return $this->belongsTo(\App\Models\User::class);
    }
}
