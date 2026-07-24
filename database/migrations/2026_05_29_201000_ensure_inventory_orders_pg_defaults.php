<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Backfill NULLs and set PostgreSQL defaults for inventory_orders money/payment columns
 * after MySQL → pgloader (defaults are not always copied).
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('inventory_orders')) {
            return;
        }

        $stringDefaults = [
            'currency' => 'EGP',
            'payment_type' => 'credit',
            'financial_status' => 'pending',
            'settlement_status' => 'pending',
        ];
        foreach ($stringDefaults as $col => $default) {
            if (! Schema::hasColumn('inventory_orders', $col)) {
                continue;
            }
            DB::table('inventory_orders')->whereNull($col)->update([$col => $default]);
            if (Schema::getConnection()->getDriverName() === 'pgsql') {
                DB::statement("ALTER TABLE inventory_orders ALTER COLUMN {$col} SET DEFAULT '{$default}'");
            }
        }

        $numericDefaults = [
            'shipping_amount' => 0,
            'tax_amount' => 0,
            'discount_amount' => 0,
            'paid_amount' => 0,
        ];
        foreach ($numericDefaults as $col => $default) {
            if (! Schema::hasColumn('inventory_orders', $col)) {
                continue;
            }
            DB::table('inventory_orders')->whereNull($col)->update([$col => $default]);
            if (Schema::getConnection()->getDriverName() === 'pgsql') {
                DB::statement("ALTER TABLE inventory_orders ALTER COLUMN {$col} SET DEFAULT {$default}");
            }
        }
    }

    public function down(): void
    {
        //
    }
};
