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
        Schema::table('inv_expenses', function (Blueprint $table) {
            $table->string('expense_number')->nullable()->after('id');
            $table->string('category')->nullable()->after('expense_number'); // To store frontend category like 'general', 'shipping'
            $table->foreignId('warehouse_id')->nullable()->constrained('inventory_locations')->nullOnDelete()->after('amount');
            $table->string('payment_method')->default('cash')->after('amount');
            $table->string('vendor_name')->nullable()->after('description');
        });

        Schema::table('inv_receipts', function (Blueprint $table) {
            $table->string('receipt_number')->nullable()->after('id');
            $table->foreignId('warehouse_id')->nullable()->constrained('inventory_locations')->nullOnDelete()->after('amount');
            $table->string('payer_name')->nullable()->after('description');
        });

        Schema::table('inv_payments', function (Blueprint $table) {
            $table->string('payment_number')->nullable()->after('id');
            $table->foreignId('warehouse_id')->nullable()->constrained('inventory_locations')->nullOnDelete()->after('amount');
            $table->string('payee_name')->nullable()->after('payee_id');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('inv_expenses', function (Blueprint $table) {
            $table->dropForeign(['warehouse_id']);
            $table->dropColumn(['expense_number', 'category', 'warehouse_id', 'payment_method', 'vendor_name']);
        });

        Schema::table('inv_receipts', function (Blueprint $table) {
            $table->dropForeign(['warehouse_id']);
            $table->dropColumn(['receipt_number', 'warehouse_id', 'payer_name']);
        });

        Schema::table('inv_payments', function (Blueprint $table) {
            $table->dropForeign(['warehouse_id']);
            $table->dropColumn(['payment_number', 'warehouse_id', 'payee_name']);
        });
    }
};
