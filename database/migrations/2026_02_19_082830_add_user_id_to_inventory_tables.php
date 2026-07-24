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
        $tables = [
            'master_products',
            'inventory_offers',
            'skus',
            'inventory_locations',
            'channels',
            'sku_inventory',
            'inventory_transactions',
            'inventory_orders',
            'inventory_returns',
            'settlements',
            'capital_sources',
            'profit_distributions',
            'withdrawals',
            'suppliers',
            'purchase_batches',
            'quotations',
            'receipts',
            'payments',
            'expenses',
            'warehouses',
            'asins',
            'asin_price_histories',
            'customers',
            'draft_master_products',
            'inventory_order_items',
            'order_costs',
            'product_aliases',
            'purchase_batch_items',
            'purchase_uploads',
            'quotation_items',
            'return_items',
            'sales_orders',
            'sales_order_items',
            'settlement_items',
            'supplier_product_aliases',
            'vendors',
        ];

        foreach ($tables as $tableName) {
            if (Schema::hasTable($tableName)) {
                Schema::table($tableName, function (Blueprint $table) use ($tableName) {
                    if (! Schema::hasColumn($tableName, 'user_id')) {
                        $table->foreignId('user_id')->nullable()->after('id')->constrained('users')->nullOnDelete();
                    }
                });
            }
        }
    }

    /**
     * Reverse the migrations.
     */
    public function down(): void
    {
        $tables = [
            'master_products',
            'inventory_offers',
            'skus',
            'inventory_locations',
            'channels',
            'sku_inventory',
            'inventory_transactions',
            'inventory_orders',
            'inventory_returns',
            'settlements',
            'capital_sources',
            'profit_distributions',
            'withdrawals',
            'suppliers',
            'purchase_batches',
            'quotations',
            'receipts',
            'payments',
            'expenses',
            'warehouses',
            'asins',
            'asin_price_histories',
            'customers',
            'draft_master_products',
            'inventory_order_items',
            'order_costs',
            'product_aliases',
            'purchase_batch_items',
            'purchase_uploads',
            'quotation_items',
            'return_items',
            'sales_orders',
            'sales_order_items',
            'settlement_items',
            'supplier_product_aliases',
            'vendors',
        ];

        foreach ($tables as $tableName) {
            if (Schema::hasTable($tableName)) {
                Schema::table($tableName, function (Blueprint $table) use ($tableName) {
                    if (Schema::hasColumn($tableName, 'user_id')) {
                        try {
                            $table->dropForeign([$tableName.'_user_id_foreign']);
                        } catch (\Exception $e) {
                            // Fallback or ignore
                        }
                        $table->dropColumn('user_id');
                    }
                });
            }
        }
    }
};
