<?php

namespace App\Domain\Models\Wms;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use App\Infrastructure\Traits\IsIsolatedByUser;

class SupplierProductAlias extends Model
{
    use IsIsolatedByUser;

    protected $fillable = [
        'vendor_id', 'master_product_id', 'supplier_product_name', 'supplier_sku', 'last_unit_cost',
    ];

    protected $casts = [
        'last_unit_cost' => 'decimal:2',
    ];

    public function vendor(): BelongsTo
    {
        return $this->belongsTo(\App\Domain\Models\Wms\Vendor::class);
    }

    public function masterProduct(): BelongsTo
    {
        return $this->belongsTo(\App\Domain\Models\Wms\MasterProduct::class);
    }
}
