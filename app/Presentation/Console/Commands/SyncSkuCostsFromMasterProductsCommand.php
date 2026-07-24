<?php

namespace App\Presentation\Console\Commands;

use Illuminate\Console\Command;
use App\Application\Services\ProfitEngineService;
use App\Domain\Models\Wms\Sku;

/**
 * After fixing SKU ↔ master product links, stored sku.cost_price / last_purchase_price may still
 * reflect an old listing. This aligns them with the same rules as ProfitEngineService (master
 * catalog → batch average → SKU fallback).
 */
class SyncSkuCostsFromMasterProductsCommand extends Command
{
    protected $signature = 'inventory:sync-sku-costs-from-master
                            {--dry-run : Show planned updates without saving}
                            {--user-id= : Limit to SKUs owned by this user_id}';

    protected $description = 'Copy effective purchase unit cost from linked master products onto SKU rows (cost_price + last_purchase_price).';

    public function handle(ProfitEngineService $profit): int
    {
        $dryRun = (bool) $this->option('dry-run');
        $userIdOpt = $this->option('user-id');

        $q = Sku::query()->with(['offer.masterProduct']);

        if ($userIdOpt !== null && $userIdOpt !== '' && (int) $userIdOpt > 0) {
            $q->where('user_id', (int) $userIdOpt);
        }

        $updated = 0;
        $skippedNoMaster = 0;
        $skippedNoUnit = 0;
        $unchanged = 0;
        $examples = [];

        foreach ($q->cursor() as $sku) {
            $master = $sku->offer?->masterProduct;
            if (! $master) {
                $skippedNoMaster++;

                continue;
            }

            $batchCosts = $profit->averagePurchaseUnitCostByMasterProductIds([(int) $master->id]);
            $unit = $profit->resolveEffectiveUnitCost($master, $sku, $batchCosts);

            if ($unit <= 0) {
                $skippedNoUnit++;

                continue;
            }

            $rounded = round($unit, 4);
            $last = (float) ($sku->last_purchase_price ?? 0);
            $cost = (float) ($sku->cost_price ?? 0);

            if (abs($last - $rounded) < 0.0001 && abs($cost - $rounded) < 0.0001) {
                $unchanged++;

                continue;
            }

            $updated++;
            if (count($examples) < 20) {
                $examples[] = sprintf(
                    'SKU %s (id %d): %.2f → %.2f EGP | master #%d %s',
                    (string) ($sku->sku ?? '?'),
                    (int) $sku->id,
                    $last,
                    $rounded,
                    (int) $master->id,
                    (string) ($master->internal_name ?? '')
                );
            }

            if (! $dryRun) {
                $sku->update([
                    'last_purchase_price' => $rounded,
                    'cost_price' => $rounded,
                ]);
            }
        }

        $this->info(
            ($dryRun ? '[dry-run] Would update ' : 'Updated ')
            .$updated.' SKU(s); unchanged '.$unchanged
            .'; no offer/master '.$skippedNoMaster.'; no resolvable unit cost '.$skippedNoUnit.'.'
        );

        foreach ($examples as $line) {
            $this->line($line);
        }

        return self::SUCCESS;
    }
}
