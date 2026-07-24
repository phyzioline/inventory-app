<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (Schema::hasTable('settlements')) {
            Schema::table('settlements', function (Blueprint $table) {
                if (! Schema::hasColumn('settlements', 'merchant_identifier')) {
                    $table->string('merchant_identifier')->nullable()->after('report_id');
                    $table->index('merchant_identifier');
                }
            });
        }

        if (Schema::hasTable('settlement_items')) {
            Schema::table('settlement_items', function (Blueprint $table) {
                if (! Schema::hasColumn('settlement_items', 'merchant_identifier')) {
                    $table->string('merchant_identifier')->nullable()->after('quantity');
                    $table->index('merchant_identifier');
                }
                if (! Schema::hasColumn('settlement_items', 'fulfillment_channel')) {
                    $table->string('fulfillment_channel')->nullable()->after('merchant_identifier');
                    $table->index('fulfillment_channel');
                }
                if (! Schema::hasColumn('settlement_items', 'marketplace_name')) {
                    $table->string('marketplace_name')->nullable()->after('fulfillment_channel');
                }
            });
        }
    }

    public function down(): void
    {
        if (Schema::hasTable('settlement_items')) {
            Schema::table('settlement_items', function (Blueprint $table) {
                foreach (['marketplace_name', 'fulfillment_channel', 'merchant_identifier'] as $column) {
                    if (Schema::hasColumn('settlement_items', $column)) {
                        $table->dropColumn($column);
                    }
                }
            });
        }

        if (Schema::hasTable('settlements')) {
            Schema::table('settlements', function (Blueprint $table) {
                if (Schema::hasColumn('settlements', 'merchant_identifier')) {
                    $table->dropColumn('merchant_identifier');
                }
            });
        }
    }
};
