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
        // Inventory-specific tables (prefixed to avoid conflict with existing tables)

        // Expenses
        if (! Schema::hasTable('inv_expenses')) {
            Schema::create('inv_expenses', function (Blueprint $table) {
                $table->id();
                $table->string('type'); // Shipping, Ads, Utilities, Salaries, etc.
                $table->decimal('amount', 15, 2);
                $table->text('description')->nullable();
                $table->date('expense_date');
                $table->string('reference_type')->nullable(); // Order, Product, etc.
                $table->unsignedBigInteger('reference_id')->nullable();
                $table->foreignId('user_id')->nullable()->constrained('users')->onDelete('set null');
                $table->timestamps();

                $table->index(['expense_date', 'type']);
            });
        }

        // Receipts
        if (! Schema::hasTable('inv_receipts')) {
            Schema::create('inv_receipts', function (Blueprint $table) {
                $table->id();
                $table->string('type'); // Customer Payment, Refund, Settlement, etc.
                $table->decimal('amount', 15, 2);
                $table->text('description')->nullable();
                $table->date('receipt_date');
                $table->string('payment_method')->nullable(); // Cash, Bank Transfer, Card
                $table->string('reference_type')->nullable();
                $table->unsignedBigInteger('reference_id')->nullable();
                $table->foreignId('user_id')->nullable()->constrained('users')->onDelete('set null');
                $table->timestamps();

                $table->index(['receipt_date', 'type']);
            });
        }

        // Payments
        if (! Schema::hasTable('inv_payments')) {
            Schema::create('inv_payments', function (Blueprint $table) {
                $table->id();
                $table->string('payee_type'); // Vendor, Supplier, Partner
                $table->unsignedBigInteger('payee_id');
                $table->decimal('amount', 15, 2);
                $table->string('payment_method'); // Cash, Bank Transfer, Check
                $table->date('payment_date');
                $table->string('reference_type')->nullable(); // Invoice, PurchaseOrder
                $table->unsignedBigInteger('reference_id')->nullable();
                $table->string('status')->default('pending'); // pending, completed, cancelled
                $table->text('notes')->nullable();
                $table->foreignId('user_id')->nullable()->constrained('users')->onDelete('set null');
                $table->timestamps();

                $table->index(['payee_type', 'payee_id']);
                $table->index(['payment_date', 'status']);
            });
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::dropIfExists('inv_payments');
        Schema::dropIfExists('inv_receipts');
        Schema::dropIfExists('inv_expenses');
    }
};
