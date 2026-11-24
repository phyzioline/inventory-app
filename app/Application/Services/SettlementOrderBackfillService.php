<?php

declare(strict_types=1);

namespace App\Application\Services;

use App\Domain\Models\Wms\Channel;
use App\Domain\Models\Wms\InventoryOrder;
use App\Domain\Models\Wms\InventoryOrderItem;
use App\Domain\Models\Wms\Settlement;
use App\Domain\Models\Wms\Sku;
use Illuminate\Support\Carbon;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Amazon paid for orders whose order report was never uploaded (2,867 orders / 1.35M in 2026): the sale
 * is in the payment sheet but not in P&L, and returns cannot be tracked. This rebuilds each such order
 * from its own sheet lines — order id, SKU, quantity and price of every "ItemPrice: Principal" line — and
 * re-runs reconcile so the lines, refunds and claim markers attach to it.
 *
 * Only from the channel's start date (stock_tracking_starts_at) — earlier history is archived.
 * Stock is NOT deducted: these units left months ago and the shelf has been counted since; the plan
 * lists the units per SKU so the owner can decide on a separate, audited adjustment.
 */
class SettlementOrderBackfillService
{
    /** Created orders are traceable through the audit log entry order.created_from_payment_sheet (order_ids). */

    public function __construct(
        private readonly SettlementService $settlements,
        private readonly InventoryAuditLogService $audit,
    ) {}

    /**
     * @return array{
     *   orders: list<array{channel_id: int, platform_order_id: string, order_date: string, total: float, items: list<array{sku_code: string, sku_id: int|null, quantity: int, unit_price: float}>, settlement_ids: list<int>}>,
     *   skipped_no_sale_line: int,
     *   channels_without_start: list<string>
     * }
     */
    public function plan(int $userId, ?string $since = null): array
    {
        $channels = Channel::query()->where('user_id', $userId)->get(['id', 'name', 'type', 'stock_tracking_starts_at']);
        $amazon = $channels->filter(fn ($c) => str_starts_with(strtolower((string) $c->type), 'amazon'));
        // $since stands in only for channels with no start date of their own.
        $withoutStart = $since ? [] : $amazon->whereNull('stock_tracking_starts_at')->pluck('name')->values()->all();
        $eligible = ($since ? $amazon : $amazon->whereNotNull('stock_tracking_starts_at'))->keyBy('id');
        if ($eligible->isEmpty()) {
            return ['orders' => [], 'skipped_no_sale_line' => 0, 'channels_without_start' => $withoutStart];
        }

        $key = fn (string $col) => "REPLACE(REGEXP_REPLACE(TRIM(COALESCE({$col}, '')), '[[:space:]\"'']', '', 'g'), '-', '')";

        $rows = DB::table('settlement_items as si')
            ->join('settlements as s', 's.id', '=', 'si.settlement_id')
            ->join('channels as ch', 'ch.id', '=', 's.channel_id')
            ->where('s.user_id', $userId)
            ->whereIn('s.channel_id', $eligible->keys()->all())
            ->whereNull('si.inventory_order_id')
            ->whereRaw($key('si.platform_order_id')." <> ''")
            ->whereRaw('COALESCE(si.transaction_date, s.end_date) >= COALESCE(ch.stock_tracking_starts_at, ?)', [$since ? Carbon::parse($since)->startOfDay() : null])
            ->whereRaw('NOT EXISTS (SELECT 1 FROM inventory_orders o WHERE o.user_id = s.user_id AND '.$key('o.platform_order_id').' = '.$key('si.platform_order_id').')')
            ->orderBy('si.id')
            ->get(['si.settlement_id', 's.channel_id', 'si.platform_order_id', 'si.sku', 'si.description', 'si.amount', 'si.quantity', 'si.transaction_date', 'si.transaction_status']);

        $orders = [];
        $skipped = 0;
        foreach ($rows->groupBy(fn ($r) => $r->channel_id.'|'.str_replace('-', '', preg_replace('/\s+/u', '', trim((string) $r->platform_order_id)))) as $lines) {
            $sales = $lines->filter(fn ($l) => $this->isSaleLine($l));
            if ($sales->isEmpty()) {
                // Only fees/refunds on file: the sale sits in a sheet that is missing — nothing to price it with.
                $skipped++;

                continue;
            }
            $channelId = (int) $lines->first()->channel_id;
            $items = [];
            foreach ($sales->groupBy(fn ($l) => trim((string) $l->sku)) as $skuCode => $skuLines) {
                $qty = (int) max(1, $skuLines->sum(fn ($l) => max(1, (int) $l->quantity)));
                $amount = round((float) $skuLines->sum('amount'), 2);
                $items[] = [
                    'sku_code' => (string) $skuCode,
                    'sku_id' => $this->resolveSkuId((string) $skuCode, $channelId, $userId),
                    'quantity' => $qty,
                    'unit_price' => round($amount / $qty, 2),
                ];
            }
            $orders[] = [
                'channel_id' => $channelId,
                'platform_order_id' => trim((string) $lines->first()->platform_order_id),
                'order_date' => Carbon::parse($lines->min('transaction_date') ?? now())->toDateTimeString(),
                'total' => round((float) $sales->sum('amount'), 2),
                'items' => $items,
                'settlement_ids' => $lines->pluck('settlement_id')->map(fn ($v) => (int) $v)->unique()->values()->all(),
            ];
        }

        return ['orders' => $orders, 'skipped_no_sale_line' => $skipped, 'channels_without_start' => $withoutStart];
    }

    /**
     * @param  array{orders: list<array<string, mixed>>}  $plan
     * @return array{created: int, reconciled_sheets: int}
     */
    public function apply(array $plan, int $userId): array
    {
        $createdIds = [];
        $sheetIds = [];
        foreach (array_chunk($plan['orders'], 200) as $chunk) {
            DB::transaction(function () use ($chunk, $userId, &$createdIds, &$sheetIds) {
                foreach ($chunk as $o) {
                    // Re-check inside the transaction: a sheet upload may have created it meanwhile.
                    if (InventoryOrder::query()->where('user_id', $userId)->where('platform_order_id', $o['platform_order_id'])->exists()) {
                        continue;
                    }
                    $order = InventoryOrder::query()->create([
                        'platform_order_id' => $o['platform_order_id'],
                        'channel_id' => $o['channel_id'],
                        'status' => 'shipped',
                        'order_date' => $o['order_date'],
                        'customer_name' => 'Guest',
                        'currency' => 'EGP',
                        'total_amount' => $o['total'],
                        'payment_type' => 'credit',
                        'paid_amount' => 0,
                        'remaining_amount' => $o['total'],
                        'financial_status' => 'pending',
                        'settlement_status' => 'pending',
                    ]);
                    InventoryOrder::query()->whereKey($order->id)->update(['user_id' => $userId]);
                    foreach ($o['items'] as $i) {
                        $item = InventoryOrderItem::query()->create([
                            'inventory_order_id' => $order->id,
                            'sku_id' => $i['sku_id'],
                            'sku_code' => $i['sku_code'],
                            'product_name' => $i['sku_code'] !== '' ? $i['sku_code'] : 'UNKNOWN',
                            'quantity' => $i['quantity'],
                            'unit_price' => $i['unit_price'],
                            'total_price' => round($i['unit_price'] * $i['quantity'], 2),
                            // Not deducted on purpose (see class doc) — and never picked up by the shortage retry.
                            'stock_deduction_status' => 'not_applicable',
                        ]);
                        InventoryOrderItem::query()->whereKey($item->id)->update(['user_id' => $userId]);
                    }
                    $createdIds[] = (int) $order->id;
                    foreach ($o['settlement_ids'] as $sid) {
                        $sheetIds[$sid] = true;
                    }
                }
            });
        }

        $this->audit->record('order.created_from_payment_sheet', null, null, [
            'count' => count($createdIds),
            'order_ids' => $createdIds,
            'settlement_ids' => array_keys($sheetIds),
            'stock_deducted' => false,
        ]);

        // Attach the sheet lines (sale, fees, refunds) to the new orders and refresh their statuses.
        foreach (array_keys($sheetIds) as $sid) {
            $settlement = Settlement::query()->find($sid);
            if ($settlement) {
                $this->settlements->reconcile($settlement);
            }
        }

        return ['created' => count($createdIds), 'reconciled_sheets' => count($sheetIds)];
    }

    private function isSaleLine(object $line): bool
    {
        $desc = strtolower(trim((string) $line->description));

        return (float) $line->amount > 0
            && str_contains($desc, 'principal')
            && ! str_contains($desc, 'refund')
            && ! in_array(strtolower(trim((string) $line->transaction_status)), ['deferred', 'pending', 'reversed'], true);
    }

    private function resolveSkuId(string $code, int $channelId, int $userId): ?int
    {
        if ($code === '') {
            return null;
        }
        $match = fn ($q) => $q->where('sku', $code)->orWhere('marketplace_id', $code);
        $onChannel = Sku::query()->where('user_id', $userId)->where('channel_id', $channelId)->where($match)->orderByDesc('id')->value('id');
        if ($onChannel) {
            return (int) $onChannel;
        }
        $any = Sku::query()->where('user_id', $userId)->where($match)->pluck('id');

        // Only when the code is unambiguous — a wrong product would put the wrong cost on the order.
        return $any->count() === 1 ? (int) $any->first() : null;
    }
}
