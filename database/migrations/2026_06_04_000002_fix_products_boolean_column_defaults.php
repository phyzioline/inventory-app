<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('products')) {
            return;
        }

        $booleanColumns = [
            'has_variations' => false,
            'track_inventory' => true,
            'has_engineer_option' => false,
            'engineer_required' => false,
            'age_restriction_required' => false,
            'free_shipping' => false,
            'is_returnable' => true,
            'is_cod_available' => true,
            'is_shipping_eligible' => true,
            'frozen_stock' => false,
        ];

        $driver = Schema::getConnection()->getDriverName();

        foreach ($booleanColumns as $column => $default) {
            if (! Schema::hasColumn('products', $column)) {
                continue;
            }

            DB::table('products')->whereNull($column)->update([$column => $default]);

            if ($driver !== 'pgsql') {
                continue;
            }

            $sqlDefault = $default ? 'TRUE' : 'FALSE';
            DB::statement("ALTER TABLE products ALTER COLUMN {$column} SET DEFAULT {$sqlDefault}");
            DB::statement("ALTER TABLE products ALTER COLUMN {$column} SET NOT NULL");
        }
    }

    public function down(): void
    {
        // Intentionally empty — preserves NOT NULL + defaults on production.
    }
};
