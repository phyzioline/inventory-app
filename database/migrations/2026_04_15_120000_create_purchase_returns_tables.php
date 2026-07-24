<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('purchase_returns')) {
            Schema::create('purchase_returns', function (Blueprint $table) {
                $table->id();
                $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete();

                $table->foreignId('purchase_batch_id')->constrained('purchase_batches')->cascadeOnDelete();
                $table->foreignId('vendor_id')->nullable()->constrained('vendors')->nullOnDelete();
                $table->foreignId('supplier_id')->nullable()->constrained('suppliers')->nullOnDelete();
                $table->foreignId('location_id')->nullable()->constrained('inventory_locations')->nullOnDelete();

                $table->string('return_number')->nullable()->index();
                $table->date('return_date');
                $table->string('reason')->nullable();
                $table->string('refund_method')->default('credit_note'); // credit_note, cash, bank_transfer

                $table->decimal('subtotal', 15, 2)->default(0);
                $table->decimal('tax_amount', 15, 2)->default(0);
                $table->decimal('grand_total', 15, 2)->default(0);
                $table->string('currency', 8)->default('EGP');

                $table->text('notes')->nullable();
                $table->timestamps();
            });
        }

        if (! Schema::hasTable('purchase_return_items')) {
            Schema::create('purchase_return_items', function (Blueprint $table) {
                $table->id();
                $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete();

                $table->foreignId('purchase_return_id')->constrained('purchase_returns')->cascadeOnDelete();
                $table->foreignId('purchase_batch_item_id')->nullable()->constrained('purchase_batch_items')->nullOnDelete();
                $table->foreignId('sku_id')->nullable()->constrained('skus')->nullOnDelete();

                $table->decimal('quantity', 15, 2)->default(0);
                $table->decimal('unit_price', 15, 2)->default(0);
                $table->decimal('total_price', 15, 2)->default(0);
                $table->string('reason')->nullable();
                $table->json('meta')->nullable();
                $table->timestamps();

                $table->index(['purchase_return_id', 'sku_id']);
            });
        }
    }

    public function down(): void
    {
        Schema::dropIfExists('purchase_return_items');
        Schema::dropIfExists('purchase_returns');
    }
};
