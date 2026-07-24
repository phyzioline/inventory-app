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
        Schema::create('settlement_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('settlement_id')->constrained()->onDelete('cascade');
            $table->string('platform_order_id')->nullable()->index();
            $table->string('transaction_type')->nullable();
            $table->string('sku')->nullable()->index();
            $table->string('description', 500)->nullable();
            $table->decimal('amount', 15, 2)->default(0);
            $table->integer('quantity')->default(0);
            $table->string('marketplace_name')->nullable();
            $table->string('currency')->default('EGP');
            $table->dateTime('transaction_date')->nullable();
            $table->json('raw_data')->nullable(); // Original row data
            $table->string('reconciliation_status')->default('unreconciled'); // unreconciled, matched, discrepant, manual
            $table->foreignId('inventory_order_id')->nullable()->constrained('inventory_orders');
            $table->timestamps();
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('settlement_items');
    }
};
