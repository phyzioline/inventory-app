<?php

namespace App\Domain\Models\Wms;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;
use App\Infrastructure\Traits\IsIsolatedByUser;
use Database\Factories\MasterProductFactory;

class MasterProduct extends Model
{
    use HasFactory, IsIsolatedByUser, SoftDeletes;

    protected $fillable = [
        'internal_name', 'category', 'specifications', 'original_supplier',
        'original_supplier_sku', 'is_active', 'image_url', 'mp_id',
        'cost_price', 'selling_price', 'min_stock', 'last_purchase_price',
    ];

    protected static function newFactory(): MasterProductFactory
    {
        return MasterProductFactory::new();
    }

    protected $casts = [
        'specifications' => 'array',
        'is_active' => 'boolean',
    ];

    public function offers()
    {
        return $this->hasMany(\App\Domain\Models\Wms\InventoryOffer::class);
    }

    public function skus()
    {
        return $this->hasManyThrough(\App\Domain\Models\Wms\Sku::class, \App\Domain\Models\Wms\InventoryOffer::class, 'master_product_id', 'offer_id');
    }

    public function aliases()
    {
        return $this->hasMany(\App\Domain\Models\Wms\ProductAlias::class, 'master_product_id');
    }

    public function supplierAliases()
    {
        return $this->hasMany(\App\Domain\Models\Wms\SupplierProductAlias::class, 'master_product_id');
    }

    public function purchaseBatchItems()
    {
        return $this->hasMany(\App\Domain\Models\Wms\PurchaseBatchItem::class);
    }
}
