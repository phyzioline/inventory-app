<?php

declare(strict_types=1);

namespace App\Application\Services;

use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Finds settlement lines posted twice through overlapping statements of the same channel (Noon exports by
 * custom date range repeat the same transaction in a second sheet). The earliest sheet keeps the line; later
 * copies are duplicates. Same identity as the import guard in SettlementService::resolveDeduplicationDecision:
 * every field equal, dated, same channel.
 *
 * Only the line ledger is corrected. Sheet totals and their treasury receipts are left as booked — they mirror
 * the payout that actually reached the bank and must be checked against the bank statement, not recomputed.
 */
class SettlementCrossSheetDuplicateService
{
    /**
     * @return Collection<int, object{id: int, settlement_id: int, channel_id: int, inventory_order_id: ?int, amount: string, report_id: ?string}>
     */
    public function findDuplicates(int $userId): Collection
    {
        $identity = "s.channel_id, si.platform_order_id, LOWER(si.transaction_type), si.transaction_date,
            COALESCE(si.sku, ''), COALESCE(si.description, ''), si.amount, si.fee_amount, si.quantity,
            LOWER(COALESCE(si.transaction_status, 'released'))";

        return collect(DB::select("
            SELECT id, settlement_id, channel_id, inventory_order_id, amount, report_id FROM (
                SELECT si.id, si.settlement_id, s.channel_id, si.inventory_order_id, si.amount, s.report_id,
                       MIN(si.settlement_id) OVER (PARTITION BY {$identity}) AS first_sheet
                FROM settlement_items si
                JOIN settlements s ON s.id = si.settlement_id
                WHERE s.user_id = ?
                  AND s.channel_id IS NOT NULL
                  AND si.transaction_date IS NOT NULL
                  AND COALESCE(si.platform_order_id, '') <> ''
            ) x
            WHERE settlement_id <> first_sheet
            ORDER BY settlement_id, id
        ", [$userId]));
    }

    /**
     * Deletes the duplicate copies and recomputes statuses of the orders they touched.
     *
     * @param  Collection<int, object>  $duplicates
     * @return int rows removed
     */
    public function remove(Collection $duplicates): int
    {
        if ($duplicates->isEmpty()) {
            return 0;
        }

        $ids = $duplicates->pluck('id')->map(fn ($id) => (int) $id)->all();
        $orderIds = $duplicates->pluck('inventory_order_id')->filter()->map(fn ($id) => (int) $id)->unique()->all();

        $removed = DB::transaction(function () use ($ids, $duplicates) {
            $rows = DB::table('settlement_items')->whereIn('id', $ids)->get();

            app(InventoryAuditLogService::class)->record(
                'settlement.cross_sheet_duplicates_removed',
                null,
                null,
                [
                    'count' => count($ids),
                    'amount' => round((float) $duplicates->sum('amount'), 2),
                    'rows' => $rows->map(fn ($r) => (array) $r)->all(),
                ]
            );

            return DB::table('settlement_items')->whereIn('id', $ids)->delete();
        });

        $settlementService = app(SettlementService::class);
        foreach ($orderIds as $orderId) {
            $settlementService->recomputeOrderFinancialStatuses($orderId);
        }

        return $removed;
    }
}
