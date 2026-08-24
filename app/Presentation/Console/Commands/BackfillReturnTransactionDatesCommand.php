<?php

namespace App\Presentation\Console\Commands;

use Carbon\Carbon;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * Backdates historical "مرتجع" stock movements (inventory_transactions.reference_type = 'Return')
 * so created_at reflects the real return date from the marketplace sheet (inventory_returns.return_date)
 * instead of the moment the sheet happened to be imported/processed.
 *
 * Only touches rows we can reliably correlate: reference_id points at an inventory_returns.id and that
 * return has a known return_date (falls back to last_update_date). Adjustment-type movements for
 * damaged/unsellable returns are not linked by reference_id and are left alone — only the code path
 * going forward records their date correctly (see InventoryReturn::resolveMovementDate()).
 *
 * Run: php artisan inventory:backfill-return-transaction-dates --dry-run   (preview)
 *      php artisan inventory:backfill-return-transaction-dates            (apply)
 */
class BackfillReturnTransactionDatesCommand extends Command
{
    protected $signature = 'inventory:backfill-return-transaction-dates
        {--user= : Limit to a specific user_id}
        {--tolerance=60 : Skip rows already within this many seconds of the target date}
        {--dry-run : Preview without writing}';

    protected $description = 'Backdate return-restock inventory_transactions rows to the real marketplace return_date';

    public function handle(): int
    {
        $userId = $this->option('user');
        $dryRun = (bool) $this->option('dry-run');
        $tolerance = max(0, (int) $this->option('tolerance'));

        $query = DB::table('inventory_transactions as it')
            ->join('inventory_returns as ir', DB::raw('it.reference_id::bigint'), '=', 'ir.id')
            ->where('it.reference_type', 'Return')
            ->whereNotNull(DB::raw('COALESCE(ir.return_date, ir.last_update_date)'))
            ->select([
                'it.id as tx_id',
                'it.created_at as tx_created_at',
                'ir.return_date',
                'ir.last_update_date',
                'ir.platform_return_id',
                'ir.sku_code',
            ]);

        if ($userId !== null && $userId !== '') {
            $query->where('it.user_id', (int) $userId);
        }

        $rows = $query->orderBy('it.id')->get();
        if ($rows->isEmpty()) {
            $this->info('No return transactions to backfill.');

            return self::SUCCESS;
        }

        $this->info(($dryRun ? '[dry-run] ' : '').'Candidates: '.$rows->count());

        $fixed = 0;
        $skipped = 0;
        $shown = 0;
        foreach ($rows as $row) {
            $target = Carbon::parse($row->return_date ?? $row->last_update_date);
            $current = Carbon::parse($row->tx_created_at);

            if (abs($current->diffInSeconds($target)) <= $tolerance) {
                $skipped++;

                continue;
            }

            if ($shown < 40) {
                $this->line(sprintf(
                    '  tx#%d [%s / %s]  %s → %s',
                    $row->tx_id,
                    $row->platform_return_id,
                    $row->sku_code,
                    $current->format('Y-m-d H:i:s'),
                    $target->format('Y-m-d H:i:s')
                ));
                $shown++;
            }

            if (! $dryRun) {
                DB::table('inventory_transactions')
                    ->where('id', $row->tx_id)
                    ->update([
                        'created_at' => $target->format('Y-m-d H:i:s'),
                        'updated_at' => $target->format('Y-m-d H:i:s'),
                    ]);
            }
            $fixed++;
        }

        if ($fixed > $shown) {
            $this->line('  ... and '.($fixed - $shown).' more');
        }

        $this->info(($dryRun ? 'Would fix' : 'Fixed').": {$fixed}  (already correct: {$skipped})");

        return self::SUCCESS;
    }
}
