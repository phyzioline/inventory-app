<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /**
     * FIFO costing for adjustments expects remaining_quantity; an older migration file was empty.
     */
    public function up(): void
    {
        if (! Schema::hasTable('purchase_batch_items')) {
            return;
        }
        if (! Schema::hasColumn('purchase_batch_items', 'remaining_quantity')) {
            Schema::table('purchase_batch_items', function (Blueprint $table) {
                $table->decimal('remaining_quantity', 14, 2)->nullable()->after('received_quantity');
            });
        }

        if (Schema::hasColumn('purchase_batch_items', 'remaining_quantity')) {
            DB::table('purchase_batch_items')
                ->whereNull('remaining_quantity')
                ->update([
                    'remaining_quantity' => DB::raw('COALESCE(NULLIF(received_quantity, 0), quantity, 0)'),
                ]);
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('purchase_batch_items') && Schema::hasColumn('purchase_batch_items', 'remaining_quantity')) {
            Schema::table('purchase_batch_items', function (Blueprint $table) {
                $table->dropColumn('remaining_quantity');
            });
        }
    }
};
