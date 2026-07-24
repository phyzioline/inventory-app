<?php

namespace App\Domain\Models\Wms;

use Illuminate\Database\Eloquent\Model;

class QuotationItem extends Model
{
    protected $fillable = [
        'quotation_id', 'sku_id', 'description', 'quantity', 'unit_price', 'total',
    ];

    protected $casts = [
        'unit_price' => 'decimal:2',
        'total' => 'decimal:2',
    ];

    public function quotation()
    {
        return $this->belongsTo(\App\Domain\Models\Wms\Quotation::class);
    }

    public function sku()
    {
        return $this->belongsTo(\App\Domain\Models\Wms\Sku::class);
    }
}
