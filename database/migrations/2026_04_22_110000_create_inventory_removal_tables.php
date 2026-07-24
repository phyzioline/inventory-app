<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('inventory_removal_orders', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('source')->default('amazon'); // amazon
            $table->string('removal_order_id')->index(); // Amazon removal order id ("order-id" in sheet)
            $table->string('order_source')->nullable(); // Seller-initiated Manual Removal, Amazon-initiated...
            $table->string('order_type')->nullable();   // Return
            $table->string('service_speed')->nullable(); // Standard
            $table->string('order_status')->nullable(); // Pending / Completed
            $table->dateTime('request_date')->nullable();
            $table->dateTime('last_updated_date')->nullable();
            $table->string('currency', 8)->nullable();
            $table->timestamps();

            $table->unique(['user_id', 'source', 'removal_order_id'], 'inv_removal_user_source_order_unique');
        });

        Schema::create('inventory_removal_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('inventory_removal_order_id')->constrained('inventory_removal_orders')->cascadeOnDelete();
            $table->string('sku_code')->nullable()->index();
            $table->string('fnsku')->nullable();
            $table->string('disposition')->nullable(); // Sellable / Unsellable

            $table->integer('requested_quantity')->default(0);
            $table->integer('cancelled_quantity')->default(0);
            $table->integer('disposed_quantity')->default(0);
            $table->integer('shipped_quantity')->default(0);
            $table->integer('in_process_quantity')->default(0);

            $table->decimal('removal_fee', 12, 4)->nullable();
            $table->string('currency', 8)->nullable();

            // Receiving confirmation (our system)
            $table->string('receive_status')->default('pending'); // pending / received
            $table->dateTime('received_at')->nullable();
            $table->foreignId('received_location_id')->nullable()->constrained('inventory_locations')->nullOnDelete();
            $table->integer('received_quantity')->default(0);

            $table->timestamps();

            // Avoid duplicates on re-upload: order + sku + disposition
            $table->unique(
                ['user_id', 'inventory_removal_order_id', 'sku_code', 'disposition'],
                'inv_removal_item_unique'
            );
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('inventory_removal_items');
        Schema::dropIfExists('inventory_removal_orders');
    }
};
