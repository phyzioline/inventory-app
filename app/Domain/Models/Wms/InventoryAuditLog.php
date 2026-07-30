<?php

namespace App\Domain\Models\Wms;

use Illuminate\Database\Eloquent\Model;

class InventoryAuditLog extends Model
{
    protected $table = 'inventory_audit_logs';

    protected $fillable = [
        'user_id', 'action', 'subject_type', 'subject_id', 'payload',
    ];

    protected $casts = [
        'payload' => 'array',
    ];
}
