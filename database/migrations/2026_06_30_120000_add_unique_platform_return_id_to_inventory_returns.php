<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('inventory_returns')) {
            return;
        }

        if (! Schema::hasColumn('inventory_returns', 'platform_return_id')
            || ! Schema::hasColumn('inventory_returns', 'user_id')) {
            return;
        }

        DB::statement(
            'CREATE UNIQUE INDEX IF NOT EXISTS inventory_returns_user_platform_return_id_unique '
            .'ON inventory_returns (user_id, platform_return_id) '
            ."WHERE platform_return_id IS NOT NULL AND platform_return_id <> ''"
        );
    }

    public function down(): void
    {
        if (! Schema::hasTable('inventory_returns')) {
            return;
        }

        DB::statement('DROP INDEX IF EXISTS inventory_returns_user_platform_return_id_unique');
    }
};
