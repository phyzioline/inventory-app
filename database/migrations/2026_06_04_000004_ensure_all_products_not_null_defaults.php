<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * PostgreSQL may have NOT NULL columns without DEFAULT when added via partial migrations.
 * Align DB defaults with ProductService::normalizeProductDefaults().
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('products')) {
            return;
        }

        $driver = Schema::getConnection()->getDriverName();
        if ($driver !== 'pgsql') {
            return;
        }

        $intDefaults = [
            'amount_reserved' => 0,
            'min_quantity' => 1,
            'handling_time' => 2,
        ];

        foreach ($intDefaults as $column => $default) {
            if (! Schema::hasColumn('products', $column)) {
                continue;
            }
            DB::table('products')->whereNull($column)->update([$column => $default]);
            DB::statement("ALTER TABLE products ALTER COLUMN {$column} SET DEFAULT {$default}");
            DB::statement("ALTER TABLE products ALTER COLUMN {$column} SET NOT NULL");
        }

        $boolDefaults = [
            'has_variations' => false,
            'track_inventory' => true,
            'frozen_stock' => false,
            'has_engineer_option' => false,
            'engineer_required' => false,
            'age_restriction_required' => false,
            'free_shipping' => false,
            'is_returnable' => true,
            'is_cod_available' => true,
            'is_shipping_eligible' => true,
        ];

        foreach ($boolDefaults as $column => $default) {
            if (! Schema::hasColumn('products', $column)) {
                continue;
            }
            DB::table('products')->whereNull($column)->update([$column => $default]);
            $sql = $default ? 'TRUE' : 'FALSE';
            DB::statement("ALTER TABLE products ALTER COLUMN {$column} SET DEFAULT {$sql}");
            DB::statement("ALTER TABLE products ALTER COLUMN {$column} SET NOT NULL");
        }

        $stringDefaults = [
            'dimensions_unit' => 'cm',
            'item_weight_unit' => 'grams',
            'condition' => 'new',
            'product_status' => 'pending',
        ];

        foreach ($stringDefaults as $column => $default) {
            if (! Schema::hasColumn('products', $column)) {
                continue;
            }
            DB::table('products')->whereNull($column)->update([$column => $default]);
            $escaped = str_replace("'", "''", $default);
            DB::statement("ALTER TABLE products ALTER COLUMN {$column} SET DEFAULT '{$escaped}'");
        }

        if (Schema::hasColumn('products', 'shipping_cost')) {
            DB::table('products')->whereNull('shipping_cost')->update(['shipping_cost' => 0]);
            DB::statement('ALTER TABLE products ALTER COLUMN shipping_cost SET DEFAULT 0');
        }
    }

    public function down(): void
    {
        //
    }
};
