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
        Schema::table('skus', function (Blueprint $table) {
            // Add location_id for warehouse association
            $table->foreignId('location_id')->nullable()
                ->after('channel_id')
                ->constrained('inventory_locations')
                ->onDelete('set null')
                ->comment('Primary warehouse/location for this SKU');

            // Add is_active flag
            $table->boolean('is_active')->default(true)
                ->after('selling_price')
                ->comment('Whether this SKU is active and can be used in transactions');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('skus', function (Blueprint $table) {
            $table->dropForeign(['location_id']);
            $table->dropColumn(['location_id', 'is_active']);
        });
    }
};
