<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('inv_finance_accounts')) {
            Schema::create('inv_finance_accounts', function (Blueprint $table) {
                $table->id();
                $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
                $table->string('name');
                /** cash | bank | wallet */
                $table->string('account_type', 32);
                $table->decimal('opening_balance', 15, 2)->default(0);
                $table->string('currency', 8)->default('EGP');
                $table->unsignedSmallInteger('sort_order')->default(0);
                $table->timestamps();

                $table->index(['user_id', 'account_type']);
            });
        }

        if (Schema::hasTable('inv_receipts') && ! Schema::hasColumn('inv_receipts', 'finance_account_id')) {
            Schema::table('inv_receipts', function (Blueprint $table) {
                $table->foreignId('finance_account_id')->nullable()->after('payment_method')->constrained('inv_finance_accounts')->nullOnDelete();
            });
        }

        if (Schema::hasTable('inv_payments') && ! Schema::hasColumn('inv_payments', 'finance_account_id')) {
            Schema::table('inv_payments', function (Blueprint $table) {
                $table->foreignId('finance_account_id')->nullable()->after('payment_method')->constrained('inv_finance_accounts')->nullOnDelete();
            });
        }

        if (Schema::hasTable('inv_expenses') && ! Schema::hasColumn('inv_expenses', 'finance_account_id')) {
            Schema::table('inv_expenses', function (Blueprint $table) {
                $table->foreignId('finance_account_id')->nullable()->after('payment_method')->constrained('inv_finance_accounts')->nullOnDelete();
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('inv_expenses') && Schema::hasColumn('inv_expenses', 'finance_account_id')) {
            Schema::table('inv_expenses', function (Blueprint $table) {
                $table->dropConstrainedForeignId('finance_account_id');
            });
        }
        if (Schema::hasTable('inv_payments') && Schema::hasColumn('inv_payments', 'finance_account_id')) {
            Schema::table('inv_payments', function (Blueprint $table) {
                $table->dropConstrainedForeignId('finance_account_id');
            });
        }
        if (Schema::hasTable('inv_receipts') && Schema::hasColumn('inv_receipts', 'finance_account_id')) {
            Schema::table('inv_receipts', function (Blueprint $table) {
                $table->dropConstrainedForeignId('finance_account_id');
            });
        }
        Schema::dropIfExists('inv_finance_accounts');
    }
};
