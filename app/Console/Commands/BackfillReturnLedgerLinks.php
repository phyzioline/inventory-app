<?php

namespace App\Console\Commands;

use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;
use App\Application\Services\PurchaseImportService;
use App\Domain\Models\Wms\InventoryReturn;
use App\Domain\Models\Wms\PurchaseReturn;

/**
 * One-off repair for returns processed before returns were linked to the
 * customer/vendor ledger: customer returns that never reduced the order's
 * remaining_amount, and purchase returns that never reduced the vendor's
 * payable balance. Safe to re-run — already-synced rows are skipped.
 */
class BackfillReturnLedgerLinks extends Command
{
    protected $signature = 'returns:backfill-ledger {--dry-run : Preview changes without writing them}';

    protected $description = 'Backfill customer/vendor balance adjustments for returns processed before the return-to-ledger link existed';

    public function handle(PurchaseImportService $purchaseImportService): int
    {
        $dryRun = (bool) $this->option('dry-run');

        $this->info('--- Customer returns ---');
        $customerReturns = InventoryReturn::with('inventoryOrder.items.sku')
            ->where('status', 'completed')
            ->where(function ($q) {
                $q->whereNull('refund_amount')->orWhere('refund_amount', 0);
            })
            ->get();

        $customerFixed = 0;
        foreach ($customerReturns as $return) {
            $credit = $return->resolveCustomerCreditAmount();
            if ($credit <= 0.0) {
                continue;
            }

            $order = $return->inventoryOrder;
            if (! $order) {
                continue;
            }

            $this->line(sprintf(
                'Return #%d (order #%d): credit %.2f, remaining_amount %.2f -> %.2f',
                $return->id,
                $order->id,
                $credit,
                (float) $order->remaining_amount,
                round((float) $order->remaining_amount - $credit, 2)
            ));

            if (! $dryRun) {
                DB::transaction(function () use ($return, $order, $credit) {
                    $order->remaining_amount = round((float) $order->remaining_amount - $credit, 2);
                    $order->save();
                    $return->refund_amount = $credit;
                    $return->save();
                });
            }
            $customerFixed++;
        }
        $this->info("Customer returns fixed: {$customerFixed}");

        $this->info('--- Purchase (vendor) returns ---');
        $purchaseReturns = PurchaseReturn::whereNull('balance_synced_at')
            ->where('refund_method', 'credit_note')
            ->get();

        $vendorFixed = 0;
        foreach ($purchaseReturns as $return) {
            if (! $return->vendor_id) {
                if (! $dryRun) {
                    $return->update(['balance_synced_at' => now()]);
                }
                continue;
            }

            $amount = (float) $return->grand_total;
            $this->line(sprintf(
                'Purchase return #%d (vendor #%d): decrement payable by %.2f',
                $return->id,
                $return->vendor_id,
                $amount
            ));

            if (! $dryRun) {
                DB::transaction(function () use ($purchaseImportService, $return, $amount) {
                    $purchaseImportService->adjustVendorPayableBalance((int) $return->vendor_id, -$amount);
                    $return->update(['balance_synced_at' => now()]);
                });
            }
            $vendorFixed++;
        }
        $this->info("Purchase returns fixed: {$vendorFixed}");

        if ($dryRun) {
            $this->warn('Dry run — no changes were written.');
        }

        return self::SUCCESS;
    }
}
