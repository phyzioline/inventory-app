<?php

namespace App\Domain\Models\Wms;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use App\Infrastructure\Traits\IsIsolatedByUser;

class Settlement extends Model
{
    use IsIsolatedByUser;

    protected $fillable = [
        'channel_id', 'report_id', 'merchant_identifier', 'start_date', 'end_date', 'total_amount', 'status',
    ];

    protected $casts = [
        'start_date' => 'date',
        'end_date' => 'date',
        'total_amount' => 'decimal:2',
    ];

    public function channel(): BelongsTo
    {
        return $this->belongsTo(\App\Domain\Models\Wms\Channel::class);
    }

    public static function importFromCSV(array $csvData, int $channelId): array
    {
        return [];
    }

    public function matchOrders(): int
    {
        return 0;
    }

    public function reconcile(): bool
    {
        return $this->update(['status' => 'reconciled']);
    }

    public function items(): \Illuminate\Database\Eloquent\Relations\HasMany
    {
        return $this->hasMany(\App\Domain\Models\Wms\SettlementItem::class);
    }
}
