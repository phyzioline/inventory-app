<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('inventory_order_items', function (Blueprint $table) {
            if (! Schema::hasColumn('inventory_order_items', 'stock_deduction_status')) {
                $table->string('stock_deduction_status')->nullable()->after('total_price'); // deducted|shortage|not_applicable
            }
            if (! Schema::hasColumn('inventory_order_items', 'stock_shortage_reason')) {
                $table->text('stock_shortage_reason')->nullable()->after('stock_deduction_status');
            }
        });
    }

    public function down(): void
    {
        Schema::table('inventory_order_items', function (Blueprint $table) {
            if (Schema::hasColumn('inventory_order_items', 'stock_shortage_reason')) {
                $table->dropColumn('stock_shortage_reason');
            }
            if (Schema::hasColumn('inventory_order_items', 'stock_deduction_status')) {
                $table->dropColumn('stock_deduction_status');
            }
        });
    }
};
