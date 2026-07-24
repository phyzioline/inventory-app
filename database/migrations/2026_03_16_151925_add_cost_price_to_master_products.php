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
        Schema::table('master_products', function (Blueprint $table) {
            $table->decimal('cost_price', 15, 2)->nullable()->after('original_supplier_sku');
            $table->decimal('selling_price', 15, 2)->nullable()->after('cost_price');
            $table->integer('min_stock')->nullable()->after('selling_price');
            $table->decimal('last_purchase_price', 15, 2)->nullable()->after('min_stock');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('master_products', function (Blueprint $table) {
            $table->dropColumn(['cost_price', 'selling_price', 'min_stock', 'last_purchase_price']);
        });
    }
};
