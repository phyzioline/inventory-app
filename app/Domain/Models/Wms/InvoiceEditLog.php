<?php

namespace App\Domain\Models\Wms;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use App\Models\User;

class InvoiceEditLog extends Model
{
    protected $table = 'inv_invoice_edit_logs';

    protected $fillable = [
        'inventory_order_id',
        'user_id',
        'before_snapshot',
        'after_snapshot',
        'items_delta',
        'payment_delta',
        'reason',
    ];

    protected $casts = [
        'before_snapshot' => 'array',
        'after_snapshot' => 'array',
        'items_delta' => 'array',
        'payment_delta' => 'array',
    ];

    public function order(): BelongsTo
    {
        return $this->belongsTo(InventoryOrder::class, 'inventory_order_id');
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
