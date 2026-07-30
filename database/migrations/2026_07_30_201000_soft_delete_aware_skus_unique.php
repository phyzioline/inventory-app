<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Soft-deleted SKUs must not block re-creating the same (user, channel, sku) code.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('skus') || ! Schema::hasColumn('skus', 'deleted_at')) {
            return;
        }

        // May exist as a table UNIQUE CONSTRAINT (not a plain index).
        DB::statement('ALTER TABLE skus DROP CONSTRAINT IF EXISTS skus_user_channel_sku_unique');
        DB::statement('DROP INDEX IF EXISTS skus_user_channel_sku_unique');

        DB::statement('
            CREATE UNIQUE INDEX IF NOT EXISTS skus_user_channel_sku_unique
            ON skus (user_id, channel_id, sku)
            WHERE deleted_at IS NULL
        ');
    }

    public function down(): void
    {
        DB::statement('DROP INDEX IF EXISTS skus_user_channel_sku_unique');
        DB::statement('ALTER TABLE skus DROP CONSTRAINT IF EXISTS skus_user_channel_sku_unique');
        DB::statement('
            CREATE UNIQUE INDEX IF NOT EXISTS skus_user_channel_sku_unique
            ON skus (user_id, channel_id, sku)
        ');
    }
};
