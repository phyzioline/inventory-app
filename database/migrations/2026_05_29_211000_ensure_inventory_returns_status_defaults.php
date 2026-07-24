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

        if (Schema::hasColumn('inventory_returns', 'return_status')) {
            DB::table('inventory_returns')
                ->where(function ($q) {
                    $q->whereNull('return_status')->orWhere('return_status', '');
                })
                ->update(['return_status' => 'return_requested']);
            if (Schema::getConnection()->getDriverName() === 'pgsql') {
                DB::statement("ALTER TABLE inventory_returns ALTER COLUMN return_status SET DEFAULT 'return_requested'");
            }
        }

        if (Schema::hasColumn('inventory_returns', 'inventory_status')) {
            DB::table('inventory_returns')
                ->where(function ($q) {
                    $q->whereNull('inventory_status')->orWhere('inventory_status', '');
                })
                ->update(['inventory_status' => 'on_hold']);
            if (Schema::getConnection()->getDriverName() === 'pgsql') {
                DB::statement("ALTER TABLE inventory_returns ALTER COLUMN inventory_status SET DEFAULT 'on_hold'");
            }
        }
    }

    public function down(): void
    {
        //
    }
};
