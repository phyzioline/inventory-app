<?php

namespace App\Domain\Models\Wms;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use App\Infrastructure\Traits\IsIsolatedByUser;

class ASIN extends Model
{
    use IsIsolatedByUser;

    protected $table = 'asins';

    protected $fillable = [
        'product_id', 'asin_code', 'marketplace', 'display_price', 'status', 'notes', 'image_url',
    ];

    protected $casts = [
        'display_price' => 'decimal:2',
    ];

    public function product(): BelongsTo
    {
        return $this->belongsTo(\App\Domain\Models\Wms\Product::class);
    }

    public function priceHistory(): HasMany
    {
        return $this->hasMany(\App\Domain\Models\Wms\ASINPriceHistory::class);
    }
}
