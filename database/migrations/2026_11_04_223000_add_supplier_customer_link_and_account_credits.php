<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Party current account: link a supplier to one customer, plus non-cash
 * commission / price-difference credits that reduce supplier AP.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('suppliers') && ! Schema::hasColumn('suppliers', 'linked_customer_id')) {
            Schema::table('suppliers', function (Blueprint $table) {
                $table->foreignId('linked_customer_id')
                    ->nullable()
                    ->after('balance')
                    ->constrained('customers')
                    ->nullOnDelete();
            });

            // One customer may only be linked from one supplier (partial unique).
            Schema::table('suppliers', function (Blueprint $table) {
                $table->unique('linked_customer_id', 'suppliers_linked_customer_id_unique');
            });
        }

        if (! Schema::hasTable('supplier_account_credits')) {
            Schema::create('supplier_account_credits', function (Blueprint $table) {
                $table->id();
                $table->foreignId('user_id')->nullable()->constrained('users')->nullOnDelete();
                $table->foreignId('supplier_id')->constrained('suppliers')->cascadeOnDelete();
                $table->decimal('amount', 15, 2);
                $table->date('credit_date');
                $table->string('reason', 40)->default('commission');
                $table->string('notes', 500)->nullable();
                $table->string('reference', 100)->nullable();
                $table->timestamps();

                $table->index(['supplier_id', 'credit_date']);
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('supplier_account_credits')) {
            Schema::dropIfExists('supplier_account_credits');
        }

        if (Schema::hasTable('suppliers') && Schema::hasColumn('suppliers', 'linked_customer_id')) {
            Schema::table('suppliers', function (Blueprint $table) {
                $table->dropUnique('suppliers_linked_customer_id_unique');
                $table->dropConstrainedForeignId('linked_customer_id');
            });
        }
    }
};
