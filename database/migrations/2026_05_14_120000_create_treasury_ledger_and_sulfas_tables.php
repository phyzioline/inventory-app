<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Clean partial runs (migration may have failed on long auto-generated index names).
        Schema::dropIfExists('inv_treasury_cash_transactions');
        Schema::dropIfExists('inv_treasury_sulfas');
        Schema::dropIfExists('inv_treasury_accounts');

        Schema::create('inv_treasury_accounts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->string('name')->default('Main cashbox');
            $table->string('currency', 8)->default('EGP');
            $table->boolean('is_default')->default(false);
            $table->timestamps();

            $table->index(['user_id', 'is_default'], 'inv_treas_acct_user_def');
        });

        Schema::create('inv_treasury_sulfas', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('treasury_account_id')->constrained('inv_treasury_accounts')->cascadeOnDelete();
            $table->string('lender_name');
            $table->decimal('principal_amount', 15, 2);
            $table->decimal('amount_paid', 15, 2)->default(0);
            $table->string('status', 32)->default('open'); // open, settled, cancelled
            $table->date('borrowed_on');
            $table->date('due_on')->nullable();
            $table->text('notes')->nullable();
            $table->timestamps();

            $table->index(['user_id', 'status'], 'inv_sulfa_user_stat');
        });

        Schema::create('inv_treasury_cash_transactions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('user_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('treasury_account_id')->constrained('inv_treasury_accounts')->cascadeOnDelete();
            $table->string('direction', 8); // in, out
            $table->decimal('amount', 15, 2);
            $table->string('tx_type', 64); // sulfa_borrow, sulfa_repay, manual_adjustment, ...
            $table->string('reference_type')->nullable();
            $table->unsignedBigInteger('reference_id')->nullable();
            $table->foreignId('sulfa_id')->nullable()->constrained('inv_treasury_sulfas')->nullOnDelete();
            $table->string('memo')->nullable();
            $table->date('occurred_on');
            $table->timestamps();

            $table->index(['treasury_account_id', 'occurred_on'], 'inv_tcash_acct_date');
            $table->index(['user_id', 'tx_type'], 'inv_tcash_user_type');
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('inv_treasury_cash_transactions');
        Schema::dropIfExists('inv_treasury_sulfas');
        Schema::dropIfExists('inv_treasury_accounts');
    }
};
