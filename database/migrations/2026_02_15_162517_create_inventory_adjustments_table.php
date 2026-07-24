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
        Schema::create('inventory_adjustments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('sku_id')->constrained('skus');
            $table->foreignId('location_id')->constrained('inventory_locations');
            $table->string('type'); // DAMAGE, LOST, THEFT, EXPIRED, CORRECTION, etc
            $table->decimal('quantity', 15, 2); // Absolute quantity adjusted
            $table->string('reason')->nullable();
            $table->text('notes')->nullable();

            // Financial Tracking (FIFO)
            $table->foreignId('purchase_batch_item_id')->nullable()->constrained('purchase_batch_items');
            $table->decimal('unit_cost', 15, 2)->nullable();
            $table->decimal('total_loss_amount', 15, 2)->nullable();

            $table->foreignId('user_id')->constrained('users');
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('inventory_adjustments');
    }
};
