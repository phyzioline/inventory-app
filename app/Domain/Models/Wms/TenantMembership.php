<?php

namespace App\Domain\Models\Wms;

use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

class TenantMembership extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'tenant_user_id',
        'member_user_id',
        'role',
        'invited_at',
        'accepted_at',
    ];

    protected $casts = [
        'invited_at' => 'datetime',
        'accepted_at' => 'datetime',
    ];

    public function tenant(): BelongsTo
    {
        return $this->belongsTo(User::class, 'tenant_user_id');
    }

    public function member(): BelongsTo
    {
        return $this->belongsTo(User::class, 'member_user_id');
    }
}
