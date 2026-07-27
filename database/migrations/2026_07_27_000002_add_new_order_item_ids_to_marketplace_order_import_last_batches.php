<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('marketplace_order_import_last_batches', function (Blueprint $table) {
            if (! Schema::hasColumn('marketplace_order_import_last_batches', 'new_inventory_order_item_ids')) {
                $table->json('new_inventory_order_item_ids')->nullable()->after('new_inventory_order_ids');
            }
        });
    }

    public function down(): void
    {
        Schema::table('marketplace_order_import_last_batches', function (Blueprint $table) {
            if (Schema::hasColumn('marketplace_order_import_last_batches', 'new_inventory_order_item_ids')) {
                $table->dropColumn('new_inventory_order_item_ids');
            }
        });
    }
};
