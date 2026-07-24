<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('settlement_items')) {
            return;
        }

        Schema::table('settlement_items', function (Blueprint $table) {
            if (! Schema::hasColumn('settlement_items', 'transaction_status')) {
                $table->string('transaction_status')->default('released')->after('transaction_type');
                $table->index('transaction_status');
            }

            if (! Schema::hasColumn('settlement_items', 'fee_amount')) {
                $table->decimal('fee_amount', 15, 2)->default(0)->after('amount');
            }
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('settlement_items')) {
            return;
        }

        Schema::table('settlement_items', function (Blueprint $table) {
            if (Schema::hasColumn('settlement_items', 'fee_amount')) {
                $table->dropColumn('fee_amount');
            }
            if (Schema::hasColumn('settlement_items', 'transaction_status')) {
                $table->dropColumn('transaction_status');
            }
        });
    }
};
