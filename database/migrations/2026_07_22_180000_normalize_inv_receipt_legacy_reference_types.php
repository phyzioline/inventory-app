<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use App\Domain\Models\Wms\CapitalSource;
use App\Domain\Models\Wms\Settlement;
use App\Domain\Models\Wms\TreasurySulfa;

/**
 * Legacy App\Models\Inventory\* morph types break MorphTo eager-load on receipts.
 */
return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('inv_receipts')) {
            return;
        }

        $map = [
            'App\Models\Inventory\Settlement' => Settlement::class,
            'App\Models\Inventory\TreasurySulfa' => TreasurySulfa::class,
            'App\Models\Inventory\CapitalSource' => CapitalSource::class,
        ];

        foreach ($map as $legacy => $canonical) {
            DB::table('inv_receipts')
                ->where('reference_type', $legacy)
                ->update(['reference_type' => $canonical]);
        }
    }

    public function down(): void
    {
        if (! Schema::hasTable('inv_receipts')) {
            return;
        }

        $map = [
            Settlement::class => 'App\Models\Inventory\Settlement',
            TreasurySulfa::class => 'App\Models\Inventory\TreasurySulfa',
            CapitalSource::class => 'App\Models\Inventory\CapitalSource',
        ];

        foreach ($map as $canonical => $legacy) {
            DB::table('inv_receipts')
                ->where('reference_type', $canonical)
                ->update(['reference_type' => $legacy]);
        }
    }
};
