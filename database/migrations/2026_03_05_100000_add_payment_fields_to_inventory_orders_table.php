<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('inventory_orders')) {
            return;
        }

        Schema::table('inventory_orders', function (Blueprint $table) {
            if (! Schema::hasColumn('inventory_orders', 'payment_type')) {
                $table->string('payment_type', 50)->default('cash')->after('tax_amount');
            }
            if (! Schema::hasColumn('inventory_orders', 'paid_amount')) {
                $table->decimal('paid_amount', 12, 2)->default(0)->after('payment_type');
            }
            if (! Schema::hasColumn('inventory_orders', 'remaining_amount')) {
                $table->decimal('remaining_amount', 12, 2)->default(0)->after('paid_amount');
                $table->index('remaining_amount');
            }
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('inventory_orders')) {
            return;
        }

        Schema::table('inventory_orders', function (Blueprint $table) {
            if (Schema::hasColumn('inventory_orders', 'remaining_amount')) {
                $table->dropIndex(['remaining_amount']);
                $table->dropColumn('remaining_amount');
            }
            if (Schema::hasColumn('inventory_orders', 'paid_amount')) {
                $table->dropColumn('paid_amount');
            }
            if (Schema::hasColumn('inventory_orders', 'payment_type')) {
                $table->dropColumn('payment_type');
            }
        });
    }
};
