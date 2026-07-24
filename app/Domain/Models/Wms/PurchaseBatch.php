<?php

namespace App\Domain\Models\Wms;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use App\Models\User;
use App\Infrastructure\Traits\IsIsolatedByUser;

class PurchaseBatch extends Model
{
    use IsIsolatedByUser;

    protected $fillable = [
        'batch_number', 'purchase_upload_id', 'user_id', 'vendor_id',
        'supplier_name_raw', 'supplier_matched', 'invoice_number', 'invoice_date',
        'currency', 'subtotal', 'tax_amount', 'grand_total', 'status',
        'location_id', 'received_at', 'notes',
    ];

    protected $casts = [
        'invoice_date' => 'date',
        'received_at' => 'datetime',
        'supplier_matched' => 'boolean',
        'subtotal' => 'decimal:2',
        'tax_amount' => 'decimal:2',
        'grand_total' => 'decimal:2',
    ];

    protected static function booted(): void
    {
        static::creating(function (PurchaseBatch $batch) {
            if ($batch->supplier_matched === null) {
                $batch->supplier_matched = $batch->vendor_id !== null;
            }
            if ($batch->subtotal === null) {
                $batch->subtotal = 0;
            }
            if ($batch->tax_amount === null) {
                $batch->tax_amount = 0;
            }
            if ($batch->grand_total === null) {
                $batch->grand_total = 0;
            }
        });
    }

    public function upload(): BelongsTo
    {
        return $this->belongsTo(\App\Domain\Models\Wms\PurchaseUpload::class, 'purchase_upload_id');
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function vendor(): BelongsTo
    {
        return $this->belongsTo(\App\Domain\Models\Wms\Vendor::class);
    }

    public function location(): BelongsTo
    {
        return $this->belongsTo(\App\Domain\Models\Wms\InventoryLocation::class, 'location_id');
    }

    public function items(): HasMany
    {
        return $this->hasMany(\App\Domain\Models\Wms\PurchaseBatchItem::class);
    }

    public function scopeDraft($query)
    {
        return $query->where('status', 'draft');
    }

    public function scopeApproved($query)
    {
        return $query->where('status', 'approved');
    }

    public function recalculateTotals(): void
    {
        $subtotal = $this->items()->sum('total_price');
        $this->update([
            'subtotal' => $subtotal,
            'grand_total' => $subtotal + (float) ($this->tax_amount ?? 0),
        ]);
    }

    public static function generateBatchNumber(?int $userId = null): string
    {
        $year = now()->format('Y');
        $query = static::query();
        if ($userId) {
            $query = static::withoutGlobalScopes()->where('user_id', $userId);
        }
        $last = $query->where('batch_number', 'like', "PB-{$year}-%")
            ->orderByDesc('id')
            ->value('batch_number');
        $seq = $last ? ((int) substr($last, -4) + 1) : 1;

        return sprintf('PB-%s-%04d', $year, $seq);
    }
}
