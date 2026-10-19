<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Marketplace orders dated before this moment are history: imported for money / settlement
 * matching only, never deducted from stock (the channel's stock was counted after they shipped).
 * Null = every imported order deducts (previous behaviour).
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('channels') && ! Schema::hasColumn('channels', 'stock_tracking_starts_at')) {
            Schema::table('channels', function (Blueprint $table) {
                $table->timestamp('stock_tracking_starts_at')->nullable();
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('channels') && Schema::hasColumn('channels', 'stock_tracking_starts_at')) {
            Schema::table('channels', function (Blueprint $table) {
                $table->dropColumn('stock_tracking_starts_at');
            });
        }
    }
};
