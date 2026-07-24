<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('inventory_orders')) {
            Schema::table('inventory_orders', function (Blueprint $table) {
                if (! Schema::hasColumn('inventory_orders', 'financial_status')) {
                    $table->string('financial_status', 50)->default('pending')->after('status');
                    $table->index('financial_status');
                }
                if (! Schema::hasColumn('inventory_orders', 'settlement_status')) {
                    $table->string('settlement_status', 50)->default('pending')->after('financial_status');
                    $table->index('settlement_status');
                }
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('inventory_orders')) {
            Schema::table('inventory_orders', function (Blueprint $table) {
                if (Schema::hasColumn('inventory_orders', 'settlement_status')) {
                    $table->dropIndex(['settlement_status']);
                    $table->dropColumn('settlement_status');
                }
                if (Schema::hasColumn('inventory_orders', 'financial_status')) {
                    $table->dropIndex(['financial_status']);
                    $table->dropColumn('financial_status');
                }
            });
        }
    }
};
