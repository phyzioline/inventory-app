<?php

namespace App\Domain\Models\Wms;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use App\Infrastructure\Traits\IsIsolatedByUser;

class PurchaseReturn extends Model
{
    use IsIsolatedByUser;

    protected $fillable = [
        'user_id', 'purchase_batch_id', 'vendor_id', 'supplier_id', 'location_id',
        'return_number', 'return_date', 'reason', 'refund_method',
        'subtotal', 'tax_amount', 'grand_total', 'currency', 'notes', 'balance_synced_at',
    ];

    protected $casts = [
        'return_date' => 'date',
        'subtotal' => 'decimal:2',
        'tax_amount' => 'decimal:2',
        'grand_total' => 'decimal:2',
        'balance_synced_at' => 'datetime',
    ];

    public function batch(): BelongsTo
    {
        return $this->belongsTo(\App\Domain\Models\Wms\PurchaseBatch::class, 'purchase_batch_id');
    }

    public function vendor(): BelongsTo
    {
        return $this->belongsTo(\App\Domain\Models\Wms\Vendor::class);
    }

    public function supplier(): BelongsTo
    {
        return $this->belongsTo(\App\Domain\Models\Wms\Supplier::class);
    }

    public function location(): BelongsTo
    {
        return $this->belongsTo(\App\Domain\Models\Wms\InventoryLocation::class, 'location_id');
    }

    public function items(): HasMany
    {
        return $this->hasMany(\App\Domain\Models\Wms\PurchaseReturnItem::class);
    }

    public static function generateReturnNumber(): string
    {
        $year = now()->format('Y');
        $last = static::withoutGlobalScopes()
            ->where('return_number', 'like', "PR-{$year}-%")
            ->orderByDesc('id')
            ->value('return_number');
        $seq = 1;
        if ($last) {
            $maybe = (int) substr($last, -4);
            $seq = $maybe > 0 ? ($maybe + 1) : 1;
        }

        return sprintf('PR-%s-%04d', $year, $seq);
    }
}
