<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('marketplace_order_import_last_batches')) {
            return;
        }

        if (Schema::getConnection()->getDriverName() !== 'pgsql') {
            return;
        }

        DB::statement('
            DELETE FROM marketplace_order_import_last_batches AS a
            USING marketplace_order_import_last_batches AS b
            WHERE a.user_id = b.user_id AND a.id < b.id
        ');
        DB::statement('
            CREATE UNIQUE INDEX IF NOT EXISTS marketplace_order_import_last_batches_user_id_unique
            ON marketplace_order_import_last_batches (user_id)
        ');
    }

    public function down(): void
    {
        if (! Schema::hasTable('marketplace_order_import_last_batches')) {
            return;
        }

        if (Schema::getConnection()->getDriverName() !== 'pgsql') {
            return;
        }

        DB::statement('DROP INDEX IF EXISTS marketplace_order_import_last_batches_user_id_unique');
    }
};
