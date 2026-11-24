<?php

declare(strict_types=1);

namespace App\Application\Services;

use App\Domain\Models\Wms\InventoryOrder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Orders imported 2026-04-15 … 05-16 with an unreadable date were stored as 1970-01-01, so they sit
 * outside every P&L period. The real date is rebuilt from evidence, best first:
 *  1. the order's own payment-sheet lines (earliest posting — the day Amazon booked the sale);
 *  2. the other orders of the same import (same channel, created within two minutes) — median date;
 *  3. the day the sheet was uploaded.
 */
class OrderEpochDateRepairService
{
    public const BROKEN_BEFORE = '2000-01-01';

    public function __construct(private readonly InventoryAuditLogService $audit) {}

    /**
     * @return Collection<int, array{order: InventoryOrder, new_date: string, source: string}>
     */
    public function plan(int $userId): Collection
    {
        return InventoryOrder::query()
            ->where('user_id', $userId)
            ->where('order_date', '<', self::BROKEN_BEFORE)
            ->orderBy('id')
            ->get()
            ->map(function (InventoryOrder $order) {
                [$date, $source] = $this->resolveDate($order);

                return ['order' => $order, 'new_date' => $date, 'source' => $source];
            });
    }

    /**
     * @param  Collection<int, array{order: InventoryOrder, new_date: string, source: string}>  $plan
     */
    public function apply(Collection $plan): int
    {
        DB::transaction(function () use ($plan) {
            $this->audit->record('order.epoch_date_repaired', null, null, [
                'count' => $plan->count(),
                'rows' => $plan->map(fn ($p) => [
                    'order_id' => $p['order']->id,
                    'platform_order_id' => $p['order']->platform_order_id,
                    'original_order_date' => (string) $p['order']->getRawOriginal('order_date'),
                    'new_order_date' => $p['new_date'],
                    'source' => $p['source'],
                ])->values()->all(),
            ]);
            foreach ($plan as $p) {
                InventoryOrder::query()->whereKey($p['order']->id)->update(['order_date' => $p['new_date']]);
            }
        });

        return $plan->count();
    }

    /**
     * @return array{0: string, 1: string}
     */
    private function resolveDate(InventoryOrder $order): array
    {
        $key = $this->orderKey((string) $order->platform_order_id);
        $fromSheet = DB::table('settlement_items as si')
            ->join('settlements as s', 's.id', '=', 'si.settlement_id')
            ->where('s.user_id', $order->user_id)
            ->whereNotNull('si.transaction_date')
            ->where('si.transaction_date', '>=', self::BROKEN_BEFORE)
            ->where(fn ($q) => $q->where('si.inventory_order_id', $order->id)
                ->orWhereRaw("REPLACE(REGEXP_REPLACE(TRIM(COALESCE(si.platform_order_id, '')), '[[:space:]]', '', 'g'), '-', '') = ?", [$key]))
            ->min('si.transaction_date');
        if ($fromSheet) {
            return [Carbon::parse($fromSheet)->toDateTimeString(), 'payment_sheet'];
        }

        $created = Carbon::parse($order->created_at);
        $neighbours = InventoryOrder::query()
            ->where('user_id', $order->user_id)
            ->where('channel_id', $order->channel_id)
            ->where('order_date', '>=', self::BROKEN_BEFORE)
            ->whereBetween('created_at', [$created->copy()->subMinutes(2), $created->copy()->addMinutes(2)])
            ->orderBy('order_date')
            ->pluck('order_date');
        if ($neighbours->isNotEmpty()) {
            $median = $neighbours->values()[intdiv($neighbours->count(), 2)];

            return [Carbon::parse($median)->toDateTimeString(), 'same_import_median'];
        }

        return [$created->copy()->startOfDay()->toDateTimeString(), 'upload_day'];
    }

    private function orderKey(string $platformOrderId): string
    {
        return str_replace('-', '', (string) preg_replace('/\s+/u', '', trim($platformOrderId)));
    }
}
