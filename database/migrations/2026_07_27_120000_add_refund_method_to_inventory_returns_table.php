<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('inventory_returns', function (Blueprint $table) {
            if (! Schema::hasColumn('inventory_returns', 'refund_method')) {
                $table->string('refund_method')->default('credit_note')->after('refund_amount'); // credit_note, cash, bank_transfer
            }
        });
    }

    public function down(): void
    {
        Schema::table('inventory_returns', function (Blueprint $table) {
            if (Schema::hasColumn('inventory_returns', 'refund_method')) {
                $table->dropColumn('refund_method');
            }
        });
    }
};
