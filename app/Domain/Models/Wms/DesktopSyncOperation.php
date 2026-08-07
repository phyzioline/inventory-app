<?php

namespace App\Domain\Models\Wms;

use App\Infrastructure\Traits\IsIsolatedByUser;
use Illuminate\Database\Eloquent\Model;

/**
 * Idempotency ledger for offline stock operations pushed from the desktop
 * client — one row per client-generated UUID so a retried push (e.g. after a
 * dropped connection) never applies the same stock movement twice.
 */
class DesktopSyncOperation extends Model
{
    use IsIsolatedByUser;

    protected $fillable = [
        'device_id', 'client_op_id', 'operation_type', 'status',
        'inventory_transaction_id', 'error_message', 'applied_at',
    ];

    protected $casts = [
        'applied_at' => 'datetime',
    ];

    public function inventoryTransaction()
    {
        return $this->belongsTo(InventoryTransaction::class);
    }
}
