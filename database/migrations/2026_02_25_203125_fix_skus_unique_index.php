<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * Run the migrations.
     */
    public function up(): void
    {
        Schema::table('skus', function (Blueprint $table) {
            // Drop the old global unique index
            $table->dropUnique('skus_sku_unique');

            // Add a new unique index scoped to user and channel
            // We include user_id and channel_id because a user can have the same SKU on different channels
            $table->unique(['user_id', 'channel_id', 'sku'], 'skus_user_channel_sku_unique');
        });
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        Schema::table('skus', function (Blueprint $table) {
            $table->dropUnique('skus_user_channel_sku_unique');
            $table->unique('sku', 'skus_sku_unique');
        });
    }
};
