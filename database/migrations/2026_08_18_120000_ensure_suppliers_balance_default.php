<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * PostgreSQL `suppliers.balance` is NOT NULL but has no DEFAULT after dump restore.
 * Name-only creates (purchase invoice "Add supplier") omitted the column and 500'd.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('suppliers') || ! Schema::hasColumn('suppliers', 'balance')) {
            return;
        }

        DB::table('suppliers')->whereNull('balance')->update(['balance' => 0]);

        if (Schema::getConnection()->getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE suppliers ALTER COLUMN balance SET DEFAULT 0');
            DB::statement('ALTER TABLE suppliers ALTER COLUMN balance SET NOT NULL');
        }
    }

    public function down(): void
    {
        if (! Schema::hasTable('suppliers') || ! Schema::hasColumn('suppliers', 'balance')) {
            return;
        }

        if (Schema::getConnection()->getDriverName() === 'pgsql') {
            DB::statement('ALTER TABLE suppliers ALTER COLUMN balance DROP DEFAULT');
        }
    }
};
