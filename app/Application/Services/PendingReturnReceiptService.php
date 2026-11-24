<?php

declare(strict_types=1);

namespace App\Application\Services;

use App\Domain\Models\Wms\InventoryReturn;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Returns the platform refunded (payment-sheet claim marker, STL-*) that never reached stock.
 *
 * Refund without a stock-ledger IN keeps the unit's full cost in COGS, and the unit shows as 0 on the
 * shelf if it actually came back. This is the worklist that closes that gap: each row is waiting for the
 * FBA Returns report (or a manual receive) to say sellable / damaged.
 *
 * Linking: when the same order already has a received return for the same SKU (processed by hand or by an
 * earlier report), the claim marker is that unit's refund, not a second unit — it is closed as merged.
 * Matching is per unit: two refunded units and one received unit leave one still waiting.
 */
class PendingReturnReceiptService
{
    public const OVERDUE_DAYS = 14;

    public function __construct(private readonly InventoryAuditLogService $audit) {}

    /**
     * @return Builder<InventoryReturn>
     */
    public function awaitingQuery(int $userId): Builder
    {
        return InventoryReturn::query()
            ->where('inventory_returns.user_id', $userId)
            ->where(fn ($q) => $q->whereNull('inventory_returns.status')->orWhereNotIn('inventory_returns.status', ['void', 'completed']))
            ->where(fn ($q) => $q->where('inventory_returns.external_status', 'refund_from_payment_sheet')
                ->orWhere('inventory_returns.platform_return_id', 'like', 'STL-%'))
            ->whereRaw("COALESCE(inventory_returns.metadata->>'fba_row_hash', '') = ''")
            ->whereRaw("COALESCE(inventory_returns.metadata->>'fba_license_plate', '') = ''")
            ->whereNotExists(fn ($q) => $q->select(DB::raw(1))
                ->from('inventory_transactions as t')
                ->where('t.reference_type', 'Return')
                ->where('t.type', 'IN')
                ->whereRaw('t.reference_id = CAST(inventory_returns.id AS VARCHAR)'));
    }

    /**
     * @return array{count: int, units: int, refund_total: float, overdue: int, overdue_days: int, by_month: list<array{month: string, count: int, refund_total: float}>}
     */
    public function summary(int $userId): array
    {
        $base = $this->awaitingQuery($userId);
        $overdueBefore = now()->subDays(self::OVERDUE_DAYS);

        $totals = (clone $base)->selectRaw(
            'COUNT(*) AS c, COALESCE(SUM(return_quantity), 0) AS u, COALESCE(SUM(refund_amount), 0) AS r,
             COUNT(*) FILTER (WHERE COALESCE(return_date, created_at) < ?) AS o',
            [$overdueBefore]
        )->first();

        $byMonth = (clone $base)
            ->selectRaw("to_char(COALESCE(return_date, created_at), 'YYYY-MM') AS m, COUNT(*) AS c, COALESCE(SUM(refund_amount), 0) AS r")
            ->groupBy('m')
            ->orderBy('m')
            ->get()
            ->map(fn ($row) => ['month' => (string) $row->m, 'count' => (int) $row->c, 'refund_total' => round((float) $row->r, 2)])
            ->all();

        return [
            'count' => (int) ($totals->c ?? 0),
            'units' => (int) ($totals->u ?? 0),
            'refund_total' => round((float) ($totals->r ?? 0), 2),
            'overdue' => (int) ($totals->o ?? 0),
            'overdue_days' => self::OVERDUE_DAYS,
            'by_month' => $byMonth,
        ];
    }

    /**
     * Pending claim markers whose unit is already received on another return of the same order.
     *
     * @return Collection<int, array{pending: InventoryReturn, received_id: int}>
     */
    public function findLinkable(int $userId): Collection
    {
        $pending = $this->awaitingQuery($userId)
            ->with('inventoryOrder.items')
            ->orderByRaw('COALESCE(return_date, created_at)')
            ->get()
            ->groupBy('inventory_order_id');

        $links = collect();
        foreach ($pending as $orderId => $rows) {
            if (! $orderId) {
                continue;
            }
            $received = $this->receivedReturnsForOrder((int) $orderId, $userId);
            if ($received->isEmpty()) {
                continue;
            }
            $singleLine = ($rows->first()->inventoryOrder?->items?->count() ?? 0) === 1;

            // Capacity: received units per SKU key, minus claim markers already merged into them.
            $capacity = [];
            foreach ($received as $r) {
                $key = $singleLine ? '*' : $this->skuKey($r->sku_code);
                $capacity[$key][] = ['id' => (int) $r->id, 'left' => max(0, (int) $r->units - (int) $r->already_linked)];
            }

            // Largest refund first: a received unit belongs to the full-price refund, not to a small partial
            // refund (price adjustment) on the same order — otherwise the real refund stays "awaiting".
            $ordered = $rows->sortBy([
                fn ($a, $b) => (float) $b->refund_amount <=> (float) $a->refund_amount,
                fn ($a, $b) => (int) $a->id <=> (int) $b->id,
            ]);
            foreach ($ordered as $p) {
                $key = $singleLine ? '*' : $this->skuKey($p->sku_code);
                foreach ($capacity[$key] ?? [] as $i => $slot) {
                    $need = max(1, (int) $p->return_quantity);
                    if ($slot['left'] >= $need) {
                        $capacity[$key][$i]['left'] -= $need;
                        $links->push(['pending' => $p, 'received_id' => $slot['id']]);
                        break;
                    }
                }
            }
        }

        return $links;
    }

    /**
     * @param  Collection<int, array{pending: InventoryReturn, received_id: int}>  $links
     */
    public function applyLinks(Collection $links): int
    {
        foreach ($links->chunk(200) as $chunk) {
            DB::transaction(function () use ($chunk) {
                $this->audit->record('return.claim_marker_linked_to_received', null, null, [
                    'count' => $chunk->count(),
                    'links' => $chunk->map(fn ($l) => [
                        'pending_return' => $l['pending']->getAttributes(),
                        'received_return_id' => $l['received_id'],
                    ])->values()->all(),
                ]);
                foreach ($chunk as $l) {
                    /** @var InventoryReturn $p */
                    $p = $l['pending'];
                    $meta = is_array($p->metadata) ? $p->metadata : [];
                    $meta['void_reason'] = 'linked_to_received_return';
                    $meta['voided_at'] = now()->toIso8601String();
                    $meta['merged_into_return_id'] = $l['received_id'];
                    $p->update(['status' => 'void', 'metadata' => $meta]);
                }
            });
        }

        return $links->count();
    }

    /**
     * Non-void returns of the order with stock-ledger IN or FBA-report evidence, with their units and
     * how many claim markers were already merged into each.
     */
    private function receivedReturnsForOrder(int $orderId, int $userId): Collection
    {
        return DB::table('inventory_returns as r')
            ->where('r.inventory_order_id', $orderId)
            ->where('r.user_id', $userId)
            ->where(fn ($q) => $q->whereNull('r.status')->orWhere('r.status', '<>', 'void'))
            ->where(fn ($q) => $q
                ->whereExists(fn ($s) => $s->select(DB::raw(1))->from('inventory_transactions as t')
                    ->where('t.reference_type', 'Return')->where('t.type', 'IN')
                    ->whereRaw('t.reference_id = CAST(r.id AS VARCHAR)'))
                ->orWhereRaw("COALESCE(r.metadata->>'fba_row_hash', '') <> ''")
                ->orWhereRaw("COALESCE(r.metadata->>'fba_license_plate', '') <> ''"))
            ->selectRaw("r.id, r.sku_code, GREATEST(COALESCE(r.return_quantity, 1), 1) AS units,
                (SELECT COUNT(*) FROM inventory_returns m WHERE m.metadata->>'merged_into_return_id' = CAST(r.id AS VARCHAR)) AS already_linked")
            ->orderBy('r.id')
            ->get();
    }

    private function skuKey(?string $sku): string
    {
        return strtolower(preg_replace('/\s+/', '', (string) $sku) ?? '');
    }
}
