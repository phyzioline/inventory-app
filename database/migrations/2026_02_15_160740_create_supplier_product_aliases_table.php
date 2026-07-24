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
        Schema::create('supplier_product_aliases', function (Blueprint $table) {
            $table->id();
            $table->foreignId('vendor_id')->constrained('vendors')->onDelete('cascade');
            $table->foreignId('master_product_id')->constrained('master_products')->onDelete('cascade');
            $table->string('supplier_product_name')->comment('Product name as known by this supplier');
            $table->string('supplier_sku')->nullable()->comment('Supplier\'s own SKU code');
            $table->decimal('last_unit_cost', 10, 2)->nullable()->comment('Last known price from this supplier');
            $table->timestamps();

            // Ensure one alias per vendor-product combination
            $table->unique(['vendor_id', 'master_product_id'], 'vendor_product_unique');
            $table->index('supplier_product_name');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('supplier_product_aliases');
    }
};
