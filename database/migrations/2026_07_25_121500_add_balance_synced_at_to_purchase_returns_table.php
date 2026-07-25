<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('purchase_returns')) {
            return;
        }

        Schema::table('purchase_returns', function (Blueprint $table) {
            if (! Schema::hasColumn('purchase_returns', 'balance_synced_at')) {
                $table->timestamp('balance_synced_at')->nullable()->after('grand_total');
            }
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('purchase_returns')) {
            return;
        }

        Schema::table('purchase_returns', function (Blueprint $table) {
            if (Schema::hasColumn('purchase_returns', 'balance_synced_at')) {
                $table->dropColumn('balance_synced_at');
            }
        });
    }
};
