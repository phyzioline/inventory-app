<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('inventory_returns')) {
            return;
        }

        Schema::table('inventory_returns', function (Blueprint $table) {
            if (! Schema::hasColumn('inventory_returns', 'return_location')) {
                $table->string('return_location')->nullable()->after('source_channel');
                $table->index('return_location');
            }

            if (! Schema::hasColumn('inventory_returns', 'return_status')) {
                $table->string('return_status')->default('return_requested')->after('status');
                $table->index('return_status');
            }

            if (! Schema::hasColumn('inventory_returns', 'last_update_date')) {
                $table->dateTime('last_update_date')->nullable()->after('return_date');
                $table->index('last_update_date');
            }

            if (! Schema::hasColumn('inventory_returns', 'channel')) {
                $table->string('channel')->nullable()->after('merchant_identifier');
                $table->index('channel');
            }

            if (! Schema::hasColumn('inventory_returns', 'financial_deduction')) {
                $table->decimal('financial_deduction', 12, 2)->default(0)->after('refund_amount');
            }

            if (! Schema::hasColumn('inventory_returns', 'extra_shipping_fee')) {
                $table->decimal('extra_shipping_fee', 12, 2)->default(0)->after('financial_deduction');
            }

            if (! Schema::hasColumn('inventory_returns', 'inventory_status')) {
                $table->string('inventory_status')->default('on_hold')->after('return_status');
                $table->index('inventory_status');
            }
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('inventory_returns')) {
            return;
        }

        Schema::table('inventory_returns', function (Blueprint $table) {
            foreach ([
                'return_location',
                'return_status',
                'last_update_date',
                'channel',
                'financial_deduction',
                'extra_shipping_fee',
                'inventory_status',
            ] as $column) {
                if (Schema::hasColumn('inventory_returns', $column)) {
                    $table->dropColumn($column);
                }
            }
        });
    }
};
