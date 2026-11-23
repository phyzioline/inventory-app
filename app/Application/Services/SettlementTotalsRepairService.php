<?php

declare(strict_types=1);

namespace App\Application\Services;

use App\Domain\Models\Wms\Receipt;
use App\Domain\Models\Wms\Settlement;
use App\Domain\Models\Wms\SettlementItem;
use App\Infrastructure\Support\InventoryMorphTypes;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Corrects two importer defects that inflated payment-sheet totals and treasury:
 *
 * 1. Summary rows. Amazon flat files open with a row carrying settlement-id + total-amount and no
 *    transaction. Older imports stored it as a line, so the sheet total (and the auto receipt built from
 *    it) became lines + transfer total. Fix: remove the row, set the sheet total to the transfer total,
 *    re-book the auto receipt.
 * 2. Duplicate auto receipts. Receipts migrated from the monolith carry the legacy class name in
 *    reference_type; the upsert matched only the current one, so re-uploading a sheet booked a second
 *    auto receipt (same SET-<id> number). Fix: keep the oldest, remove the copies.
 *
 * Every change writes an InventoryAuditLog entry holding the original rows.
 */
class SettlementTotalsRepairService
{
    public function __construct(
        private readonly SettlementService $settlements,
        private readonly ReceiptApplicationService $receipts,
        private readonly InventoryAuditLogService $audit,
    ) {}

    /**
     * @return Collection<int, array{settlement: Settlement, row: SettlementItem, header_total: float, stored_total: float, lines_total: float, receipt: ?Receipt}>
     */
    public function findSummaryRows(int $userId): Collection
    {
        return SettlementItem::query()
            ->whereHas('settlement', fn ($q) => $q->where('user_id', $userId))
            ->where(fn ($q) => $q->whereNull('platform_order_id')->orWhere('platform_order_id', ''))
            ->whereRaw("COALESCE(raw_data->>'total-amount', '') <> ''")
            ->with('settlement')
            ->orderBy('settlement_id')
            ->get()
            ->filter(fn (SettlementItem $row) => is_array($row->raw_data) && $this->settlements->isSettlementSummaryRow($row->raw_data))
            ->map(function (SettlementItem $row) {
                $settlement = $row->settlement;

                return [
                    'settlement' => $settlement,
                    'row' => $row,
                    'header_total' => round((float) str_replace([',', ' '], '', (string) $row->raw_data['total-amount']), 2),
                    'stored_total' => round((float) $settlement->total_amount, 2),
                    'lines_total' => round((float) SettlementItem::query()
                        ->where('settlement_id', $settlement->id)
                        ->whereKeyNot($row->id)
                        ->sum('amount'), 2),
                    'receipt' => $this->autoReceipts((int) $settlement->id)->first(),
                ];
            })
            ->values();
    }

    /**
     * Sheets with more than one auto receipt (receipt_number SET-<id>). Manual receipts are never touched.
     *
     * @return Collection<int, array{settlement_id: int, keep: Receipt, remove: Collection<int, Receipt>}>
     */
    public function findDuplicateReceipts(int $userId): Collection
    {
        $settlementIds = Receipt::withoutGlobalScopes()
            ->whereIn('reference_type', InventoryMorphTypes::settlementReferenceTypes())
            ->whereIn('reference_id', Settlement::query()->select('id')->where('user_id', $userId))
            ->whereRaw("receipt_number = 'SET-' || reference_id")
            ->groupBy('reference_id')
            ->havingRaw('COUNT(*) > 1')
            ->pluck('reference_id');

        return $settlementIds->map(function ($sid) {
            $all = $this->autoReceipts((int) $sid);

            return ['settlement_id' => (int) $sid, 'keep' => $all->first(), 'remove' => $all->slice(1)->values()];
        })->values();
    }

    /**
     * @param  Collection<int, array<string, mixed>>  $summaryRows
     */
    public function applySummaryRows(Collection $summaryRows): int
    {
        foreach ($summaryRows as $entry) {
            DB::transaction(function () use ($entry) {
                /** @var Settlement $settlement */
                $settlement = $entry['settlement'];
                /** @var ?Receipt $receipt */
                $receipt = $entry['receipt'];

                $this->audit->record('settlement.summary_row_removed', Settlement::class, (int) $settlement->id, [
                    'report_id' => $settlement->report_id,
                    'removed_row' => $entry['row']->getAttributes(),
                    'old_total_amount' => $entry['stored_total'],
                    'new_total_amount' => $entry['header_total'],
                    'lines_total' => $entry['lines_total'],
                    'receipt_before' => $receipt?->getAttributes(),
                ]);

                $entry['row']->delete();
                $settlement->update(['total_amount' => $entry['header_total']]);
                if ($receipt !== null) {
                    $this->receipts->upsertForSettlement($settlement);
                }
            });
        }

        return $summaryRows->count();
    }

    /**
     * @param  Collection<int, array<string, mixed>>  $duplicates
     * @return int receipts removed
     */
    public function applyDuplicateReceipts(Collection $duplicates): int
    {
        $removed = 0;
        foreach ($duplicates as $entry) {
            DB::transaction(function () use ($entry, &$removed) {
                $this->audit->record('settlement.duplicate_auto_receipts_removed', Settlement::class, $entry['settlement_id'], [
                    'kept_receipt_id' => $entry['keep']->id,
                    'removed_receipts' => $entry['remove']->map(fn (Receipt $r) => $r->getAttributes())->all(),
                    'amount_removed' => round((float) $entry['remove']->sum('amount'), 2),
                ]);
                foreach ($entry['remove'] as $receipt) {
                    $receipt->delete();
                    $removed++;
                }
            });
        }

        return $removed;
    }

    /**
     * @return Collection<int, Receipt>
     */
    private function autoReceipts(int $settlementId): Collection
    {
        return Receipt::withoutGlobalScopes()
            ->whereIn('reference_type', InventoryMorphTypes::settlementReferenceTypes())
            ->where('reference_id', $settlementId)
            ->orderBy('id')
            ->get();
    }
}
