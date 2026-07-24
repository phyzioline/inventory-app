<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('products', function (Blueprint $table) {
            // Product Details - Additional fields
            if (! Schema::hasColumn('products', 'brand_name')) {
                $table->string('brand_name')->nullable()->after('product_name_en');
            }
            if (! Schema::hasColumn('products', 'model_number')) {
                $table->string('model_number')->nullable()->after('brand_name');
            }
            if (! Schema::hasColumn('products', 'manufacturer')) {
                $table->string('manufacturer')->nullable()->after('model_number');
            }
            if (! Schema::hasColumn('products', 'bullet_points')) {
                // Safe check for parent column
                if (Schema::hasColumn('products', 'long_description_en')) {
                    $table->text('bullet_points')->nullable()->after('long_description_en');
                } else {
                    $table->text('bullet_points')->nullable();
                }
            }
            if (! Schema::hasColumn('products', 'generic_keywords')) {
                $table->string('generic_keywords')->nullable();
            }
            if (! Schema::hasColumn('products', 'product_type')) {
                $table->string('product_type')->nullable();
            }

            // Offer/Pricing fields
            if (! Schema::hasColumn('products', 'compare_at_price')) {
                $table->decimal('compare_at_price', 10, 2)->nullable()->after('product_price');
            }
            if (! Schema::hasColumn('products', 'cost_price')) {
                $table->decimal('cost_price', 10, 2)->nullable()->after('compare_at_price');
            }
            if (! Schema::hasColumn('products', 'min_quantity')) {
                $table->integer('min_quantity')->default(1)->after('amount');
            }
            if (! Schema::hasColumn('products', 'max_quantity')) {
                $table->integer('max_quantity')->nullable()->after('min_quantity');
            }
            if (! Schema::hasColumn('products', 'track_inventory')) {
                $table->boolean('track_inventory')->default(true)->after('max_quantity');
            }
            if (! Schema::hasColumn('products', 'barcode')) {
                $table->string('barcode')->nullable()->after('sku');
            }
            if (! Schema::hasColumn('products', 'ean')) {
                $table->string('ean')->nullable()->after('barcode');
            }
            if (! Schema::hasColumn('products', 'upc')) {
                $table->string('upc')->nullable()->after('ean');
            }

            // Variations support
            if (! Schema::hasColumn('products', 'has_variations')) {
                $table->boolean('has_variations')->default(false)->after('upc');
            }
            if (! Schema::hasColumn('products', 'variation_attributes')) {
                $table->json('variation_attributes')->nullable()->after('has_variations'); // e.g., ["Color", "Size"]
            }

            // Safety & Compliance
            if (! Schema::hasColumn('products', 'country_of_origin')) {
                $table->string('country_of_origin')->nullable()->after('variation_attributes');
            }
            if (! Schema::hasColumn('products', 'warranty_description')) {
                $table->text('warranty_description')->nullable()->after('country_of_origin');
            }
            if (! Schema::hasColumn('products', 'seller_warranty_description')) {
                $table->text('seller_warranty_description')->nullable()->after('warranty_description');
            }
            if (! Schema::hasColumn('products', 'batteries_required')) {
                $table->boolean('batteries_required')->nullable()->after('seller_warranty_description');
            }
            if (! Schema::hasColumn('products', 'battery_iec_code')) {
                $table->string('battery_iec_code')->nullable()->after('batteries_required');
            }
            if (! Schema::hasColumn('products', 'dangerous_goods_regulations')) {
                $table->string('dangerous_goods_regulations')->nullable()->after('battery_iec_code');
            }
            if (! Schema::hasColumn('products', 'item_weight')) {
                $table->decimal('item_weight', 10, 2)->nullable()->after('dangerous_goods_regulations');
            }
            if (! Schema::hasColumn('products', 'item_weight_unit')) {
                $table->string('item_weight_unit')->default('grams')->after('item_weight');
            }
            if (! Schema::hasColumn('products', 'age_restriction_required')) {
                $table->boolean('age_restriction_required')->default(false)->after('item_weight_unit');
            }
            if (! Schema::hasColumn('products', 'responsible_person_email')) {
                $table->string('responsible_person_email')->nullable()->after('age_restriction_required');
            }

            // Additional metadata
            if (! Schema::hasColumn('products', 'condition')) {
                $table->string('condition')->default('new')->after('responsible_person_email'); // new, used, refurbished
            }
            if (! Schema::hasColumn('products', 'special_features')) {
                $table->text('special_features')->nullable()->after('condition');
            }
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('products', function (Blueprint $table) {
            $table->dropColumn([
                'brand_name', 'model_number', 'manufacturer', 'bullet_points', 'generic_keywords', 'product_type',
                'compare_at_price', 'cost_price', 'min_quantity', 'max_quantity', 'track_inventory',
                'barcode', 'ean', 'upc', 'has_variations', 'variation_attributes',
                'country_of_origin', 'warranty_description', 'seller_warranty_description',
                'batteries_required', 'battery_iec_code', 'dangerous_goods_regulations',
                'item_weight', 'item_weight_unit', 'age_restriction_required', 'responsible_person_email',
                'condition', 'special_features',
            ]);
        });
    }
};
