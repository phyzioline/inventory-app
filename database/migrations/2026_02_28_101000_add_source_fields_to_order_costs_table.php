<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('order_costs')) {
            return;
        }

        Schema::table('order_costs', function (Blueprint $table) {
            if (! Schema::hasColumn('order_costs', 'source_channel')) {
                $table->string('source_channel')->nullable()->after('type');
            }
            if (! Schema::hasColumn('order_costs', 'account_email')) {
                $table->string('account_email')->nullable()->after('source_channel');
            }
            if (! Schema::hasColumn('order_costs', 'external_order_id')) {
                $table->string('external_order_id')->nullable()->after('account_email');
            }
            if (! Schema::hasColumn('order_costs', 'sku_code')) {
                $table->string('sku_code')->nullable()->after('external_order_id');
            }
            if (! Schema::hasColumn('order_costs', 'notes')) {
                $table->text('notes')->nullable()->after('sku_code');
            }
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('order_costs')) {
            return;
        }

        Schema::table('order_costs', function (Blueprint $table) {
            foreach (['notes', 'sku_code', 'external_order_id', 'account_email', 'source_channel'] as $column) {
                if (Schema::hasColumn('order_costs', $column)) {
                    $table->dropColumn($column);
                }
            }
        });
    }
};
