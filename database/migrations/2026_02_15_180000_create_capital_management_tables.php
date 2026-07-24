<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up()
    {
        // 1. Capital Sources
        if (! Schema::hasTable('capital_sources')) {
            Schema::create('capital_sources', function (Blueprint $table) {
                $table->id();
                $table->string('name');
                $table->enum('type', ['Investor', 'Loan', 'Company', 'Other']);
                $table->decimal('amount', 15, 2);
                $table->string('status')->default('active');
                $table->timestamps();
            });
        }

        // 2. Profit Distributions
        if (! Schema::hasTable('profit_distributions')) {
            Schema::create('profit_distributions', function (Blueprint $table) {
                $table->id();
                $table->foreignId('capital_source_id')->constrained('capital_sources')->onDelete('cascade');
                $table->decimal('amount', 15, 2);
                $table->date('distribution_date');
                $table->enum('status', ['pending', 'paid'])->default('pending');
                $table->string('notes')->nullable();
                $table->timestamps();
            });
        }

        // 3. Withdrawals
        if (! Schema::hasTable('withdrawals')) {
            Schema::create('withdrawals', function (Blueprint $table) {
                $table->id();
                $table->foreignId('capital_source_id')->constrained('capital_sources')->onDelete('cascade');
                $table->decimal('amount', 15, 2);
                $table->date('withdrawal_date');
                $table->enum('status', ['pending', 'approved', 'completed', 'rejected'])->default('pending');
                $table->string('reason')->nullable();
                $table->timestamps();
            });
        }
    }

    public function down()
    {
        Schema::dropIfExists('withdrawals');
        Schema::dropIfExists('profit_distributions');
        Schema::dropIfExists('capital_sources');
    }
};
