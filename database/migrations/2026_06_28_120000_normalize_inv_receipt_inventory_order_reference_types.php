<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use App\Domain\Models\Wms\InventoryOrder;

return new class extends Migration
{
    public function up(): void
    {
        if (! \Illuminate\Support\Facades\Schema::hasTable('inv_receipts')) {
            return;
        }

        DB::table('inv_receipts')
            ->where('reference_type', 'App\Models\Inventory\InventoryOrder')
            ->update(['reference_type' => InventoryOrder::class]);
    }

    public function down(): void
    {
        if (! \Illuminate\Support\Facades\Schema::hasTable('inv_receipts')) {
            return;
        }

        DB::table('inv_receipts')
            ->where('reference_type', InventoryOrder::class)
            ->update(['reference_type' => 'App\Models\Inventory\InventoryOrder']);
    }
};
