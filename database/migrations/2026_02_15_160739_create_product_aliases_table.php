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
        Schema::create('product_aliases', function (Blueprint $table) {
            $table->id();
            $table->foreignId('master_product_id')->constrained('master_products')->onDelete('cascade');
            $table->string('alias_text')->comment('The alias value (barcode, old SKU, supplier name, etc.)');
            $table->enum('alias_type', [
                'supplier_name',
                'amazon_title',
                'old_sku',
                'barcode',
                'sku_alias',
                'internal_code',
            ])->comment('Type of alias for categorization');
            $table->timestamps();

            // Indexes for fast matching
            $table->index(['alias_text', 'alias_type'], 'alias_lookup_idx');
            $table->index('master_product_id');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('product_aliases');
    }
};
