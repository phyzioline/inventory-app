<?php

namespace App\Domain\Models\Wms;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use App\Infrastructure\Traits\IsIsolatedByUser;

class ProductAlias extends Model
{
    use IsIsolatedByUser;

    protected $fillable = [
        'master_product_id', 'alias_text', 'alias_type', 'user_id',
    ];

    public function masterProduct(): BelongsTo
    {
        return $this->belongsTo(\App\Domain\Models\Wms\MasterProduct::class, 'master_product_id');
    }

    public function scopeByText($query, string $text)
    {
        return $query->where('alias_text', $text);
    }

    public function scopeOfType($query, string $type)
    {
        return $query->where('alias_type', $type);
    }
}
