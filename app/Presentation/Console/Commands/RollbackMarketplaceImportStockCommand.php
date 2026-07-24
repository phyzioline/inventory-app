<?php

namespace App\Presentation\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use App\Domain\Models\Wms\InventoryTransaction;
use App\Domain\Models\Wms\SkuInventory;

/**
 * Reverses OUT stock movements created by MarketplaceImportService (deductInventoryForImportedOrder).
 * Use after accidentally re-importing historical order sheets that double-sold local inventory.
 */
class RollbackMarketplaceImportStockCommand extends Command
{
    protected $signature = 'inventory:rollback-marketplace-import-stock
                            {--user= : Inventory user_id (tenant) who owns the transactions}
                            {--since= : Only transactions created at or after this datetime (Y-m-d H:i:s)}
                            {--until= : Only transactions created at or before this datetime}
                            {--dry-run : List matching rows without changing stock}';

    protected $description = 'Restock SKUs by reversing OUT inventory_transactions from marketplace order import deductions';

    public function handle(): int
    {
        $userId = (int) ($this->option('user') ?: 0);
        if ($userId <= 0) {
            $this->error('Required: --user=<inventory_user_id> (the account that ran the import).');

            return 1;
        }

        $dryRun = (bool) $this->option('dry-run');
        $since = $this->option('since') ? (string) $this->option('since') : null;
        $until = $this->option('until') ? (string) $this->option('until') : null;

        $q = InventoryTransaction::query()
            ->where('type', 'OUT')
            ->where('reference_type', 'ImportedOrder')
            ->where('user_id', $userId)
            ->where('notes', 'like', '%Marketplace order import deduction%')
            ->orderBy('id');

        if ($since) {
            $q->where('created_at', '>=', $since);
        }
        if ($until) {
            $q->where('created_at', '<=', $until);
        }

        $rows = $q->get();
        if ($rows->isEmpty()) {
            $this->info('No matching OUT transactions found.');

            return 0;
        }

        $this->info('Found '.$rows->count().' deduction transaction(s).');
        if ($dryRun) {
            foreach ($rows as $r) {
                $this->line(sprintf(
                    'id=%s sku_id=%s loc=%s qty=%s ref=%s at=%s',
                    $r->id,
                    $r->sku_id,
                    $r->location_id,
                    $r->quantity,
                    $r->reference_id,
                    $r->created_at
                ));
            }
            $this->warn('Dry run only — no changes.');

            return 0;
        }

        Auth::loginUsingId($userId);

        $reversed = 0;
        DB::transaction(function () use ($rows, $userId, &$reversed) {
            foreach ($rows as $tx) {
                $qty = (int) ($tx->quantity ?? 0);
                if ($qty <= 0) {
                    continue;
                }

                $inv = SkuInventory::query()
                    ->where('sku_id', $tx->sku_id)
                    ->where('location_id', $tx->location_id)
                    ->first();

                if ($inv) {
                    $inv->increment('quantity', $qty);
                }

                InventoryTransaction::create([
                    'sku_id' => $tx->sku_id,
                    'location_id' => $tx->location_id,
                    'type' => 'IN',
                    'quantity' => $qty,
                    'reference_type' => 'ImportedOrder',
                    'reference_id' => (string) ($tx->reference_id ?? ''),
                    'notes' => 'Rollback: reversed marketplace order import deduction (tx #'.$tx->id.')',
                    'user_id' => $userId,
                ]);

                $reversed++;
            }
        });

        Auth::logout();
        $this->info("Restocked from {$reversed} import deduction(s).");

        return 0;
    }
}
