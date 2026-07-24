<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('inventory_orders') || ! Schema::hasTable('customers')) {
            return;
        }
        Schema::table('inventory_orders', function (Blueprint $table) {
            if (! Schema::hasColumn('inventory_orders', 'customer_id')) {
                $table->foreignId('customer_id')
                    ->nullable()
                    ->after('user_id')
                    ->constrained('customers')
                    ->nullOnDelete();
            }
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('inventory_orders')) {
            return;
        }
        Schema::table('inventory_orders', function (Blueprint $table) {
            if (Schema::hasColumn('inventory_orders', 'customer_id')) {
                $table->dropForeign(['customer_id']);
                $table->dropColumn('customer_id');
            }
        });
    }
};
