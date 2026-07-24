<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('sku_inventory')) {
            return;
        }

        // Merge duplicates (same user_id + sku_id + location_id) before adding a unique index.
        // Duplicates can happen if older code inserted rows without user_id or if concurrent writes raced.
        $dupes = DB::table('sku_inventory')
            ->select('user_id', 'sku_id', 'location_id')
            ->groupBy('user_id', 'sku_id', 'location_id')
            ->havingRaw('COUNT(*) > 1')
            ->get();

        foreach ($dupes as $g) {
            $rows = DB::table('sku_inventory')
                ->where('user_id', $g->user_id)
                ->where('sku_id', $g->sku_id)
                ->where('location_id', $g->location_id)
                ->orderBy('id')
                ->get();

            if ($rows->count() <= 1) {
                continue;
            }

            $keepId = (int) $rows->first()->id;
            $sumQty = (int) $rows->sum('quantity');
            $sumReserved = 0;
            if (Schema::hasColumn('sku_inventory', 'reserved')) {
                $sumReserved = (int) $rows->sum('reserved');
            }
            if (Schema::hasColumn('sku_inventory', 'reserved_quantity')) {
                $sumReserved = (int) $rows->sum('reserved_quantity');
            }

            $payload = ['quantity' => $sumQty];
            if (Schema::hasColumn('sku_inventory', 'reserved')) {
                $payload['reserved'] = $sumReserved;
            }
            if (Schema::hasColumn('sku_inventory', 'reserved_quantity')) {
                $payload['reserved_quantity'] = $sumReserved;
            }

            DB::table('sku_inventory')->where('id', $keepId)->update($payload);

            $deleteIds = $rows->pluck('id')->map(fn ($v) => (int) $v)->filter(fn ($v) => $v !== $keepId)->values()->all();
            if (! empty($deleteIds)) {
                DB::table('sku_inventory')->whereIn('id', $deleteIds)->delete();
            }
        }

        // Add the unique index to prevent future duplicates.
        Schema::table('sku_inventory', function (Blueprint $table) {
            if (! migration_index_exists('sku_inventory', 'sku_inventory_user_sku_location_unique')) {
                $table->unique(['user_id', 'sku_id', 'location_id'], 'sku_inventory_user_sku_location_unique');
            }
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('sku_inventory')) {
            return;
        }

        Schema::table('sku_inventory', function (Blueprint $table) {
            try {
                $table->dropUnique('sku_inventory_user_sku_location_unique');
            } catch (\Throwable $e) {
                // ignore
            }
        });
    }
};
