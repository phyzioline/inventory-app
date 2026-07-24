<?php

namespace App\Domain\Models;

use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\Schema;

/**
 * Standalone-extraction note: the source Product model (Modules\Inventory\app\Domain\Models\Product)
 * was tightly coupled to the monolith's Ecommerce storefront catalog (Category, SubCategory,
 * ProductImage, Tag, Review, ItemsOrder, ProductMetric, ProductBadge, Favorite, CurrencyService)
 * and to Administration's Shareable/HasSeoMeta/HasSlug traits and ImageService.
 *
 * A repo-wide grep confirmed this model (and its Ecommerce-coupled sibling duplicates
 * ProductImage/ProductBadge/Review/StockAudit/ProductTag/ProductActivityLog, which pointed their
 * own `product()` relation at Modules\Ecommerce's Product — not this class — and were dropped
 * entirely rather than ported) has zero callers inside Inventory's own
 * Presentation/Application/Infrastructure layers; the real Inventory/WMS catalog is
 * App\Domain\Models\Wms\MasterProduct / Sku. This class is kept only because
 * App\Domain\Events\ProductCreated type-hints it and the source explicitly asked for the
 * Favorite relation to be removed here. All Ecommerce/Administration coupling has been
 * stripped, not just Favorite — see docs/refactoring notes in the extraction report for the
 * full list of removed relations/accessors.
 */
class Product extends Model
{
    protected static ?array $tableColumnCache = null;

    protected $attributes = [
        'amount_reserved' => 0,
        'frozen_stock' => false,
        'has_variations' => false,
        'track_inventory' => true,
        'has_engineer_option' => false,
        'engineer_required' => false,
        'age_restriction_required' => false,
        'is_returnable' => true,
        'is_cod_available' => true,
        'is_shipping_eligible' => true,
        'handling_time' => 2,
        'dimensions_unit' => 'cm',
        'item_weight_unit' => 'grams',
        'condition' => 'new',
        'product_status' => 'pending',
        'batteries_required' => false,
        'amount' => 0,
    ];

    protected $fillable = [
        'user_id', 'category_id', 'sub_category_id',
        'product_name_ar', 'product_name_en', 'product_price', 'compare_at_price',
        'short_description_ar', 'short_description_en',
        'long_description_ar', 'long_description_en',
        'amount', 'amount_reserved', 'sku', 'slug', 'status', 'frozen_stock',
        'brand_name', 'model_number', 'manufacturer', 'bullet_points', 'generic_keywords', 'product_type',
        'min_quantity', 'max_quantity', 'track_inventory',
        'barcode', 'ean', 'upc',
        'has_variations', 'variation_attributes',
        'country_of_origin', 'warranty_description', 'seller_warranty_description',
        'batteries_required', 'battery_iec_code', 'dangerous_goods_regulations',
        'age_restriction_required', 'responsible_person_email', 'condition', 'special_features',
        'has_engineer_option', 'engineer_price', 'engineer_required',
        'shipping_cost', 'free_shipping',
        'product_status', 'compliance_flag', 'admin_notes', 'last_reviewed_at',
        'package_length', 'package_width', 'package_height', 'dimensions_unit',
        'handling_time', 'commission_rate', 'min_price', 'max_price',
        'is_returnable', 'is_cod_available', 'is_shipping_eligible',
        'cost_price', 'product_video',
        'item_weight', 'item_weight_unit',
    ];

    protected static function boot()
    {
        parent::boot();

        static::creating(function ($product) {
            if ($product->free_shipping === null) {
                $product->free_shipping = false;
            }
            if ($product->shipping_cost === null) {
                $product->shipping_cost = 0;
            }
            if ($product->amount_reserved === null) {
                $product->amount_reserved = 0;
            }
            if ($product->frozen_stock === null) {
                $product->frozen_stock = false;
            }
            if ($product->has_variations === null) {
                $product->has_variations = false;
            }
            if ($product->track_inventory === null) {
                $product->track_inventory = true;
            }
            if ($product->has_engineer_option === null) {
                $product->has_engineer_option = false;
            }
            if ($product->engineer_required === null) {
                $product->engineer_required = false;
            }
            if ($product->age_restriction_required === null) {
                $product->age_restriction_required = false;
            }
            foreach (['is_returnable', 'is_cod_available', 'is_shipping_eligible'] as $flag) {
                if ($product->{$flag} === null) {
                    $product->{$flag} = true;
                }
            }
            if ($product->min_quantity === null || $product->min_quantity === '') {
                $product->min_quantity = 1;
            }
            if ($product->handling_time === null || $product->handling_time === '') {
                $product->handling_time = 2;
            }
            if ($product->dimensions_unit === null || trim((string) $product->dimensions_unit) === '') {
                $product->dimensions_unit = 'cm';
            }
            if ($product->item_weight_unit === null || trim((string) $product->item_weight_unit) === '') {
                $product->item_weight_unit = 'grams';
            }
            if ($product->condition === null || trim((string) $product->condition) === '') {
                $product->condition = 'new';
            }
            if ($product->product_status === null || trim((string) $product->product_status) === '') {
                $product->product_status = 'pending';
            }
            if ($product->amount === null || $product->amount === '') {
                $product->amount = 0;
            }
            if ($product->batteries_required === null) {
                $product->batteries_required = false;
            }
            if (static::hasTableColumn('featured') && $product->featured === null) {
                $product->featured = false;
            }

            static::stripUnknownColumns($product);

            if (empty($product->sku)) {
                $latestId = static::max('id') + 1;
                $vendorId = $product->user_id ?? auth()->id() ?? 1;
                $product->sku = 'V'.$vendorId.'-P'.$latestId.'-'.strtoupper(\Illuminate\Support\Str::random(3));
            }
        });
    }

    public function user()
    {
        return $this->belongsTo(User::class, 'user_id', 'id');
    }

    public function vendor()
    {
        return $this->belongsTo(User::class, 'user_id', 'id');
    }

    public function getStatusAttribute($value)
    {
        return $value === 'active' ? 'Active' : 'Inactive';
    }

    public function getSoldByNameAttribute()
    {
        return $this->vendor ? $this->vendor->name : 'Phyzioline';
    }

    public function getFullSkuAttribute()
    {
        return $this->sku;
    }

    public function getAvailableStockAttribute(): int
    {
        return max(0, (int) ($this->amount ?? 0) - (int) ($this->amount_reserved ?? 0));
    }

    public function isLowStock(int $threshold = 10): bool
    {
        return $this->available_stock <= $threshold && $this->available_stock > 0;
    }

    public function isOutOfStock(): bool
    {
        return $this->available_stock <= 0;
    }

    public function getStockUrgencyMessage(): ?string
    {
        $available = $this->available_stock;
        if ($available <= 0) {
            return null;
        }
        if ($available <= 10) {
            return "Only {$available} left in stock";
        }

        return null;
    }

    protected static function tableColumns(): array
    {
        if (static::$tableColumnCache === null) {
            static::$tableColumnCache = Schema::hasTable('products')
                ? Schema::getColumnListing('products')
                : [];
        }

        return static::$tableColumnCache;
    }

    protected static function hasTableColumn(string $column): bool
    {
        return in_array($column, static::tableColumns(), true);
    }

    protected static function stripUnknownColumns(Model $product): void
    {
        $allowed = static::tableColumns();
        if ($allowed === []) {
            return;
        }
        foreach (array_keys($product->getAttributes()) as $attribute) {
            if (! in_array($attribute, $allowed, true)) {
                $product->offsetUnset($attribute);
            }
        }
    }
}
