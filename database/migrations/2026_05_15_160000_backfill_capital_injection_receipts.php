<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use App\Domain\Models\Wms\CapitalSource;

return new class extends Migration
{
    /**
     * One-time: capital-only rows had no receipt, so treasury (receipts − outflow) was short vs capital.
     * Inserts a matching "capital injection" receipt per capital source if missing.
     */
    public function up(): void
    {
        if (! Schema::hasTable('inv_capital_sources') || ! Schema::hasTable('inv_receipts')) {
            return;
        }

        $refType = CapitalSource::class;

        foreach (DB::table('inv_capital_sources')->orderBy('id')->cursor() as $src) {
            $exists = DB::table('inv_receipts')
                ->where('user_id', $src->user_id)
                ->where('reference_type', $refType)
                ->where('reference_id', $src->id)
                ->exists();

            if ($exists) {
                continue;
            }

            $num = 'CAP-'.str_pad((string) $src->id, 6, '0', STR_PAD_LEFT);
            while (DB::table('inv_receipts')->where('receipt_number', $num)->exists()) {
                $num = 'CAP-'.str_pad((string) $src->id, 6, '0', STR_PAD_LEFT).'-'.uniqid();
            }

            DB::table('inv_receipts')->insert([
                'receipt_number' => $num,
                'type' => 'Capital Injection',
                'category' => 'capital',
                'amount' => $src->amount,
                'description' => 'رأس مال — '.($src->name ?? 'Capital'),
                'receipt_date' => $src->created_at ? date('Y-m-d', strtotime((string) $src->created_at)) : now()->toDateString(),
                'payment_method' => 'cash',
                'reference_type' => $refType,
                'reference_id' => $src->id,
                'user_id' => $src->user_id,
                'payer_name' => $src->name,
                'finance_account_id' => null,
                'warehouse_id' => null,
                'external_reference' => 'BACKFILL_CAPITAL_SYNC',
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        }
    }

    public function down(): void
    {
        if (! Schema::hasTable('inv_receipts')) {
            return;
        }

        DB::table('inv_receipts')
            ->where('category', 'capital')
            ->where('external_reference', 'BACKFILL_CAPITAL_SYNC')
            ->delete();
    }
};
