<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('inventory_orders')) {
            Schema::table('inventory_orders', function (Blueprint $table) {
                if (! Schema::hasColumn('inventory_orders', 'discount_amount')) {
                    $table->decimal('discount_amount', 10, 2)->default(0)->after('tax_amount');
                }
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('inventory_orders')) {
            Schema::table('inventory_orders', function (Blueprint $table) {
                if (Schema::hasColumn('inventory_orders', 'discount_amount')) {
                    $table->dropColumn('discount_amount');
                }
            });
        }
    }
};
