<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('settlement_items') || ! Schema::hasColumn('settlement_items', 'reconciliation_status')) {
            return;
        }

        DB::table('settlement_items')
            ->whereNull('reconciliation_status')
            ->update(['reconciliation_status' => 'unreconciled']);

        if (Schema::getConnection()->getDriverName() === 'pgsql') {
            DB::statement("ALTER TABLE settlement_items ALTER COLUMN reconciliation_status SET DEFAULT 'unreconciled'");
        }
    }

    public function down(): void
    {
        // Non-destructive data fix — leave column default in place on rollback.
    }
};
