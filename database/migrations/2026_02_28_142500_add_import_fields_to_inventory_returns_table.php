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
            if (! Schema::hasColumn('inventory_returns', 'sku_code')) {
                $table->string('sku_code')->nullable()->after('platform_return_id');
                $table->index('sku_code');
            }
            if (! Schema::hasColumn('inventory_returns', 'return_quantity')) {
                $table->integer('return_quantity')->default(1)->after('sku_code');
            }
            if (! Schema::hasColumn('inventory_returns', 'return_date')) {
                $table->dateTime('return_date')->nullable()->after('return_quantity');
            }
            if (! Schema::hasColumn('inventory_returns', 'external_status')) {
                $table->string('external_status')->nullable()->after('return_date');
            }
            if (! Schema::hasColumn('inventory_returns', 'refund_amount')) {
                $table->decimal('refund_amount', 12, 2)->default(0)->after('external_status');
            }
            if (! Schema::hasColumn('inventory_returns', 'source_channel')) {
                $table->string('source_channel')->nullable()->after('refund_amount');
            }
            if (! Schema::hasColumn('inventory_returns', 'merchant_identifier')) {
                $table->string('merchant_identifier')->nullable()->after('source_channel');
                $table->index('merchant_identifier');
            }
            if (! Schema::hasColumn('inventory_returns', 'fulfillment_channel')) {
                $table->string('fulfillment_channel')->nullable()->after('merchant_identifier');
            }
            if (! Schema::hasColumn('inventory_returns', 'metadata')) {
                $table->json('metadata')->nullable()->after('fulfillment_channel');
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
                'metadata',
                'fulfillment_channel',
                'merchant_identifier',
                'source_channel',
                'refund_amount',
                'external_status',
                'return_date',
                'return_quantity',
                'sku_code',
            ] as $column) {
                if (Schema::hasColumn('inventory_returns', $column)) {
                    $table->dropColumn($column);
                }
            }
        });
    }
};
