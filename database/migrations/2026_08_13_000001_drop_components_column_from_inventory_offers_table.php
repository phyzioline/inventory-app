<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * `inventory_offers.components` (json, "for bundles") was never read by any code path —
 * confirmed dead across the whole app. Dropped in favour of the proper relational
 * `product_compositions` table (next migration), which also avoids a name collision with
 * the new InventoryOffer::components() relation.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasColumn('inventory_offers', 'components')) {
            Schema::table('inventory_offers', function (Blueprint $table) {
                $table->dropColumn('components');
            });
        }
    }

    public function down(): void
    {
        if (! Schema::hasColumn('inventory_offers', 'components')) {
            Schema::table('inventory_offers', function (Blueprint $table) {
                $table->json('components')->nullable();
            });
        }
    }
};
