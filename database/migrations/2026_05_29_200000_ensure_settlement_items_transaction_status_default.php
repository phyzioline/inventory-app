<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('settlement_items') || ! Schema::hasColumn('settlement_items', 'transaction_status')) {
            return;
        }

        DB::table('settlement_items')
            ->where(function ($q) {
                $q->whereNull('transaction_status')->orWhere('transaction_status', '');
            })
            ->update(['transaction_status' => 'released']);

        if (Schema::getConnection()->getDriverName() === 'pgsql') {
            DB::statement("ALTER TABLE settlement_items ALTER COLUMN transaction_status SET DEFAULT 'released'");
        }
    }

    public function down(): void
    {
        //
    }
};
