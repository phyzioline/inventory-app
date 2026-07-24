<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('inventory_returns')) {
            return;
        }

        foreach (['financial_deduction', 'extra_shipping_fee', 'refund_amount'] as $col) {
            if (! Schema::hasColumn('inventory_returns', $col)) {
                continue;
            }
            DB::table('inventory_returns')->whereNull($col)->update([$col => 0]);
            if (Schema::getConnection()->getDriverName() === 'pgsql') {
                DB::statement("ALTER TABLE inventory_returns ALTER COLUMN {$col} SET DEFAULT 0");
            }
        }
    }

    public function down(): void
    {
        //
    }
};
