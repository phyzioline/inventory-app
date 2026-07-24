<?php

namespace App\Domain\Models\Wms;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use App\Infrastructure\Traits\IsIsolatedByUser;

class ASINPriceHistory extends Model
{
    use IsIsolatedByUser;

    protected $table = 'asin_price_history';

    protected $fillable = [
        'asin_id', 'price', 'user_id',
    ];

    protected $casts = [
        'price' => 'decimal:2',
    ];

    public function asin(): BelongsTo
    {
        return $this->belongsTo(\App\Domain\Models\Wms\ASIN::class);
    }
}
