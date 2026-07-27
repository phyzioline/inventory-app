<?php

namespace App\Presentation\Console\Commands;

use Carbon\Carbon;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Fixes marketplace-import order_date values where day/month were swapped
 * (PHP strtotime US MDY reading of DD/MM sheet dates).
 *
 * Typical symptom: dates land in future months (Aug–Dec) with day 1–12,
 * while the real calendar date is the day/month swap (e.g. 2026-08-05 → 2026-05-08).
 */
class FixSwappedMarketplaceOrderDatesCommand extends Command
{
    protected $signature = 'inventory:fix-swapped-order-dates
        {--user= : Limit to a specific user_id}
        {--after=2026-07-23 : Only touch order_date after this date (Y-m-d)}
        {--dry-run : Preview without writing}';

    protected $description = 'Swap day/month on mis-parsed marketplace order dates (DMY vs MDY)';

    public function handle(): int
    {
        if (! Schema::hasTable('inventory_orders')) {
            $this->error('inventory_orders table missing');

            return self::FAILURE;
        }

        $after = (string) $this->option('after');
        $userId = $this->option('user');
        $dryRun = (bool) $this->option('dry-run');

        $query = DB::table('inventory_orders')
            ->whereDate('order_date', '>', $after)
            ->whereRaw('EXTRACT(DAY FROM order_date) BETWEEN 1 AND 12')
            ->whereRaw('EXTRACT(MONTH FROM order_date) BETWEEN 1 AND 12')
            ->whereRaw('EXTRACT(DAY FROM order_date) <> EXTRACT(MONTH FROM order_date)');

        if ($userId !== null && $userId !== '') {
            $query->where('user_id', (int) $userId);
        }

        $rows = $query->orderBy('id')->get(['id', 'platform_order_id', 'user_id', 'order_date']);
        if ($rows->isEmpty()) {
            $this->info('No swapped candidates found.');

            return self::SUCCESS;
        }

        $this->info(($dryRun ? '[dry-run] ' : '').'Candidates: '.$rows->count());

        $fixed = 0;
        foreach ($rows as $row) {
            $current = Carbon::parse($row->order_date);
            $oldDay = (int) $current->day;
            $oldMonth = (int) $current->month;
            $year = (int) $current->year;

            // After swap: month = old day, day = old month
            if (! checkdate($oldDay, $oldMonth, $year)) {
                $this->warn("Skip #{$row->id}: invalid swapped date");

                continue;
            }

            $swapped = Carbon::create(
                $year,
                $oldDay,
                $oldMonth,
                (int) $current->hour,
                (int) $current->minute,
                (int) $current->second
            );

            $this->line(sprintf(
                '  #%d %s  %s → %s',
                $row->id,
                $row->platform_order_id,
                $current->format('Y-m-d H:i'),
                $swapped->format('Y-m-d H:i')
            ));

            if (! $dryRun) {
                DB::table('inventory_orders')
                    ->where('id', $row->id)
                    ->update(['order_date' => $swapped->format('Y-m-d H:i:s')]);
            }
            $fixed++;
        }

        $this->info(($dryRun ? 'Would fix' : 'Fixed').": {$fixed}");

        return self::SUCCESS;
    }
}
