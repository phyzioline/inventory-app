<?php

declare(strict_types=1);

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\Schema;
use App\Application\Services\SulfaCashMirrorService;
use App\Domain\Models\Wms\Receipt;
use App\Domain\Models\Wms\TreasurySulfa;

return new class extends Migration
{
    public function up(): void
    {
        if (! Schema::hasTable('inv_treasury_sulfas')) {
            return;
        }

        $mirror = app(SulfaCashMirrorService::class);

        TreasurySulfa::query()->orderBy('id')->chunkById(100, function ($rows) use ($mirror): void {
            foreach ($rows as $sulfa) {
                $exists = Receipt::withoutGlobalScopes()
                    ->where('user_id', $sulfa->user_id)
                    ->where('reference_type', TreasurySulfa::class)
                    ->where('reference_id', $sulfa->id)
                    ->exists();

                if (! $exists) {
                    $mirror->syncBorrowReceipt($sulfa);
                }
            }
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('inv_treasury_sulfas')) {
            return;
        }

        Receipt::withoutGlobalScopes()
            ->where('reference_type', TreasurySulfa::class)
            ->where('category', 'sulfa')
            ->delete();
    }
};
