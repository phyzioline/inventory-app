<?php

namespace App\Application\Services;

use Carbon\Carbon;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use App\Application\Support\ChannelQuery;
use App\Application\Support\TenantContext;
use App\Domain\Models\Wms\CapitalSource;
use App\Domain\Models\Wms\Expense;
use App\Domain\Models\Wms\InventoryAdjustment;
use App\Domain\Models\Wms\InventoryOrder;
use App\Domain\Models\Wms\InventoryOrderItem;
use App\Domain\Models\Wms\InventoryReturn;
use App\Domain\Models\Wms\OrderCost;
use App\Domain\Models\Wms\PurchaseBatch;
use App\Domain\Models\Wms\Receipt;
use App\Domain\Models\Wms\Settlement;
use App\Domain\Models\Wms\SettlementItem;
use App\Domain\Models\Wms\Sku;
use App\Infrastructure\Support\InventoryMorphTypes;

class ProfitEngineService
{
    /**
     * Weighted average purchase unit cost from received (or ordered) quantities in purchase_batch_items.
     *
     * @param  array<int>  $masterProductIds
     * @return array<string, float> keyed by master_product_id
     */
    public function averagePurchaseUnitCostByMasterProductIds(array $masterProductIds): array
    {
        $masterProductIds = array_values(array_unique(array_filter(array_map('intval', $masterProductIds))));
        if ($masterProductIds === []) {
            return [];
        }

        $rows = DB::table('purchase_batch_items')
            ->whereIn('master_product_id', $masterProductIds)
            ->groupBy('master_product_id')
            ->select('master_product_id')
            ->selectRaw('SUM(CAST(total_price AS DECIMAL(18,4))) as sum_total')
            ->selectRaw('SUM(GREATEST(COALESCE(received_quantity, 0), COALESCE(quantity, 0))) as sum_qty')
            ->get();

        $out = [];
        foreach ($rows as $row) {
            $sumQty = (float) ($row->sum_qty ?? 0);
            $sumTotal = (float) ($row->sum_total ?? 0);
            $key = (string) $row->master_product_id;
            $out[$key] = ($sumQty > 0 && $sumTotal > 0) ? round($sumTotal / $sumQty, 4) : 0.0;
        }

        return $out;
    }

    /**
     * Prefer the batch-weighted average cost (true purchase history for this product);
     * fall back to master/SKU static cost fields only when no batch history exists.
     */
    public function resolveEffectiveUnitCost($master, $sku, array $batchCostsByMasterId = []): float
    {
        $mid = $master?->id;
        if ($mid) {
            $batch = (float) ($batchCostsByMasterId[(string) $mid] ?? 0.0);
            if ($batch > 0) {
                return $batch;
            }
        }

        return $this->unitCostFromMasterAndSku($master, $sku);
    }

    /**
     * Shop purchase unit cost from the master catalog (updated on purchase invoice receive).
     * Does not use per-channel SKU overrides — avoids double/conflicting costs.
     * Prefers the batch-weighted average over the static last-purchase-price snapshot.
     */
    public function resolveShopPurchaseUnitCost($master, array $batchCostsByMasterId = []): float
    {
        if ($master === null) {
            return 0.0;
        }

        $mid = $master->id ?? null;
        if ($mid) {
            $batch = (float) ($batchCostsByMasterId[(string) $mid] ?? 0.0);
            if ($batch > 0) {
                return $batch;
            }
        }

        foreach ([
            data_get($master, 'last_purchase_price'),
            data_get($master, 'avg_purchase_price'),
            data_get($master, 'cost_price'),
            data_get($master, 'specifications.cost_price'),
        ] as $value) {
            $unit = (float) $value;
            if ($unit > 0) {
                return $unit;
            }
        }

        return 0.0;
    }

    /**
     * First positive wins. Order is intentional: linked master catalog (purchase snapshots) beats
     * per-SKU listing overrides so profit matches the core product after channel mapping fixes.
     */
    private function unitCostFromMasterAndSku($master, $sku): float
    {
        $candidates = [
            data_get($master, 'last_purchase_price'),
            data_get($master, 'cost_price'),
            data_get($master, 'avg_purchase_price'),
            data_get($master, 'specifications.cost_price'),
            $sku ? data_get($sku, 'last_purchase_price') : null,
            $sku ? data_get($sku, 'cost_price') : null,
        ];
        foreach ($candidates as $v) {
            $f = (float) $v;
            if ($f > 0) {
                return $f;
            }
        }

        return 0.0;
    }

    /**
     * Adds effective_purchase_unit_cost on each order line for API consumers (profit UI, etc.).
     *
     * @param  iterable<int, InventoryOrder>  $orders
     */
    public function hydrateOrderCollectionWithEffectivePurchaseCosts(iterable $orders): void
    {
        $masterIds = [];
        foreach ($orders as $order) {
            foreach ($order->items ?? [] as $item) {
                $mid = $item->sku?->offer?->masterProduct?->id;
                if ($mid) {
                    $masterIds[] = (int) $mid;
                }
            }
        }

        $batchCosts = $this->averagePurchaseUnitCostByMasterProductIds($masterIds);

        foreach ($orders as $order) {
            foreach ($order->items ?? [] as $item) {
                $master = $item->sku?->offer?->masterProduct;
                $unit = $this->resolveEffectiveUnitCost($master, $item->sku, $batchCosts);
                $item->setAttribute('effective_purchase_unit_cost', round($unit, 4));
            }
        }
    }

    private function channelFilterCandidates($channelFilter): array
    {
        if ($channelFilter === null || $channelFilter === '') {
            return [];
        }

        $raw = trim((string) $channelFilter);
        if ($raw === '') {
            return [];
        }

        $candidates = [$raw];
        $channel = null;

        if (ctype_digit($raw)) {
            $channel = Channel::query()->find((int) $raw);
            $candidates[] = (string) ((int) $raw);
        }

        if (! $channel) {
            $channel = Channel::query()
                ->where('slug', $raw)
                ->orWhere('name', $raw)
                ->first();
        }

        if ($channel) {
            $candidates[] = (string) $channel->id;
            if (! empty($channel->slug)) {
                $candidates[] = (string) $channel->slug;
            }
            if (! empty($channel->name)) {
                $candidates[] = (string) $channel->name;
            }
        }

        return array_values(array_unique(array_filter($candidates, fn ($v) => $v !== null && $v !== '')));
    }

    private function normalizeRange(string $startDate, string $endDate): array
    {
        $start = Carbon::parse($startDate)->startOfDay()->toDateTimeString();
        $end = Carbon::parse($endDate)->endOfDay()->toDateTimeString();

        return [$start, $end];
    }

    private function applyOrderFilters($query, array $filters = [])
    {
        if (! empty($filters['channel'])) {
            $channelIds = ChannelQuery::idsMatchingFilter((string) $filters['channel']);
            if ($channelIds === []) {
                $query->whereRaw('1 = 0');
            } else {
                $query->whereIn('channel_id', $channelIds);
            }
        }

        if (! empty($filters['account_email'])) {
            $accountEmail = $filters['account_email'];
            $query->whereExists(function ($sub) use ($accountEmail) {
                $sub->select(DB::raw(1))
                    ->from('order_costs')
                    ->whereColumn('order_costs.inventory_order_id', 'inventory_orders.id')
                    ->where('order_costs.account_email', $accountEmail);
            });
        }

        return $query;
    }

    /**
     * Same normalization as settlement order-net totals (frontend ProfitEngine).
     */
    private function normalizePlatformOrderKey(?string $raw): string
    {
        $s = trim((string) ($raw ?? ''));
        $s = trim($s, "'\"");

        return (string) preg_replace('/\s+/u', '', $s);
    }

    private function normalizeSkuKey(?string $raw): string
    {
        return strtoupper((string) preg_replace('/\s+/u', '', trim((string) ($raw ?? ''))));
    }

    /**
     * @return string[]
     */
    private function collectSkuMatchKeys(?string $skuCode, ?Sku $sku): array
    {
        $keys = [];
        // Include marketplace_id so Noon payment-sheet SKUs match orders that stored partner_sku
        // (or the reverse) when the catalog links both identifiers on the same Sku row.
        foreach ([$skuCode, $sku?->sku, $sku?->marketplace_id, $sku?->code] as $candidate) {
            $k = $this->normalizeSkuKey($candidate);
            if ($k !== '') {
                $keys[$k] = true;
            }
        }

        return array_keys($keys);
    }

    /**
     * @param  string[]  $itemSkuKeys
     * @param  array<string, array{net: float, principal_qty: float}>  $orderSkuMap
     */
    private function matchSettlementSkuKey(array $itemSkuKeys, array $orderSkuMap): ?string
    {
        foreach ($itemSkuKeys as $k) {
            if (array_key_exists($k, $orderSkuMap)) {
                return $k;
            }
        }

        return null;
    }

    /**
     * Settlement net + principal qty per marketplace order id and seller SKU.
     *
     * @return array<string, array<string, array{net: float, principal_qty: float}>>
     */
    public function settlementPlatformOrderSkuNetMap(array $filters = []): array
    {
        $c = static fn (int $n) => \App\Infrastructure\Support\DatabaseSql::asciiChar($n);
        $oidNormSql = "REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(platform_order_id,'')), {$c(34)}, ''), {$c(39)}, ''), ' ', ''), {$c(9)}, ''), {$c(13)}, '')";
        $skuNormSql = "UPPER(REPLACE(REPLACE(TRIM(COALESCE(sku,'')), ' ', ''), {$c(9)}, ''))";
        $principalQtySql = "SUM(CASE WHEN LOWER(COALESCE(description,'')) LIKE '%itemprice%' AND LOWER(COALESCE(description,'')) LIKE '%principal%' THEN GREATEST(COALESCE(quantity,0), 1) ELSE 0 END)";

        $query = SettlementItem::query()
            ->whereIn('settlement_id', $this->settlementIdsSubquery($filters))
            ->whereNotNull('platform_order_id')
            ->where('platform_order_id', '!=', '')
            ->whereNotNull('sku')
            ->where('sku', '!=', '');

        $this->applyReleasedSettlementItemScope($query);
        $this->applyOrderCohortSettlementFilter($query, $filters);

        $rows = $query
            ->selectRaw("{$oidNormSql} as oid_key, {$skuNormSql} as sku_key")
            ->selectRaw('SUM(CAST(amount AS DECIMAL(18,4))) as net_total')
            ->selectRaw("{$principalQtySql} as principal_qty")
            ->groupBy(DB::raw($oidNormSql), DB::raw($skuNormSql))
            ->get();

        $map = [];
        foreach ($rows as $row) {
            $orderKey = $this->normalizePlatformOrderKey((string) ($row->oid_key ?? ''));
            $skuKey = $this->normalizeSkuKey((string) ($row->sku_key ?? ''));
            if ($orderKey === '' || $skuKey === '') {
                continue;
            }
            $map[$orderKey][$skuKey] = [
                'net' => (float) ($row->net_total ?? 0),
                'principal_qty' => (float) ($row->principal_qty ?? 0),
            ];
        }

        return $map;
    }

    /**
     * @param  \Illuminate\Database\Eloquent\Builder<SettlementItem>  $query
     */
    private function applyReleasedSettlementItemScope($query): void
    {
        $query->where(function ($q) {
            $q->whereNull('transaction_status')
                ->orWhereRaw("TRIM(transaction_status) = ''")
                ->orWhere(function ($q2) {
                    $q2->whereRaw("LOWER(TRIM(COALESCE(transaction_status, ''))) NOT IN ('deferred', 'pending', 'reversed')")
                        ->whereRaw("COALESCE(transaction_status, '') NOT LIKE '%تأجيل%'")
                        ->where(function ($q3) {
                            $q3->whereRaw("LOWER(COALESCE(transaction_status, '')) NOT LIKE '%defer%'")
                                ->orWhereRaw("LOWER(COALESCE(transaction_status, '')) LIKE '%secure%'")
                                ->orWhereRaw("LOWER(COALESCE(transaction_status, '')) LIKE '%reserved%'")
                                ->orWhereRaw("COALESCE(transaction_status, '') LIKE '%تأمين%'");
                        });
                });
        });
    }

    /**
     * Order-cohort scope for settlement lines: every line of an order placed in the period, whatever
     * date the platform booked it. P&L selects orders by order_date, so the lines must follow the order —
     * refunds and late payouts post weeks after the sale, and filtering them by transaction_date dropped
     * them from both months (~300k EGP/month of lines landed outside their order's month).
     *
     * @param  \Illuminate\Database\Eloquent\Builder<SettlementItem>  $query
     */
    private function applyOrderCohortSettlementFilter($query, array $filters): void
    {
        if (empty($filters['start_date']) || empty($filters['end_date'])) {
            return;
        }
        [$startAt, $endAt] = $this->normalizeRange((string) $filters['start_date'], (string) $filters['end_date']);

        $cohortKeys = InventoryOrder::query()
            ->whereBetween('order_date', [$startAt, $endAt])
            ->whereNotNull('platform_order_id')
            ->selectRaw($this->compactPlatformOrderIdSql('platform_order_id').' as k');

        $query->whereIn(DB::raw($this->compactPlatformOrderIdSql('platform_order_id')), $cohortKeys);
    }

    /** Platform order id with quotes, whitespace and dashes removed — join key between orders and sheets. */
    private function compactPlatformOrderIdSql(string $column): string
    {
        $c = static fn (int $n) => \App\Infrastructure\Support\DatabaseSql::asciiChar($n);

        return "REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(COALESCE({$column},'')), {$c(34)}, ''), {$c(39)}, ''), ' ', ''), {$c(9)}, ''), {$c(13)}, ''), '-', '')";
    }

    /**
     * @param  iterable<int, InventoryOrderItem>  $orderItems
     * @param  array<string, array{net: float, principal_qty: float}>  $orderSkuMap
     * @return array{total_cogs: float, total_settlement_revenue: float}
     */
    private function settlementAwareOrderCogsAndRevenue(
        iterable $orderItems,
        array $orderSkuMap,
        array $batchCostsByMasterId,
        $skuModelsById = null,
        bool $shopPurchaseCostOnly = false
    ): array {
        $groupInvoiceQty = [];
        $lineMeta = [];

        foreach ($orderItems as $item) {
            $skuModel = $skuModelsById[$item->sku_id ?? 0] ?? $item->sku ?? null;
            $matchKey = $this->matchSettlementSkuKey(
                $this->collectSkuMatchKeys($item->sku_code, $skuModel instanceof Sku ? $skuModel : null),
                $orderSkuMap
            );
            if ($matchKey === null) {
                continue;
            }

            $qty = (float) $item->quantity;
            $groupInvoiceQty[$matchKey] = ($groupInvoiceQty[$matchKey] ?? 0.0) + $qty;
            $lineMeta[] = ['item' => $item, 'matchKey' => $matchKey, 'qty' => $qty, 'skuModel' => $skuModel];
        }

        $totalCogs = 0.0;
        $totalSettlementRevenue = 0.0;

        foreach ($lineMeta as $meta) {
            $matchKey = $meta['matchKey'];
            $skuNet = (float) ($orderSkuMap[$matchKey]['net'] ?? 0.0);
            $principalQty = (float) ($orderSkuMap[$matchKey]['principal_qty'] ?? 0.0);
            $totalInvoiceQty = (float) ($groupInvoiceQty[$matchKey] ?? 0.0);
            if ($totalInvoiceQty <= 0) {
                continue;
            }

            $effectiveQty = $principalQty > 0
                ? min($totalInvoiceQty, $principalQty)
                : ($skuNet > 0 ? min($totalInvoiceQty, 1.0) : 0.0);
            $qtyScale = $effectiveQty / $totalInvoiceQty;

            /** @var InventoryOrderItem $item */
            $item = $meta['item'];
            $skuModel = $meta['skuModel'];
            $master = ($skuModel instanceof Sku ? $skuModel : null)?->offer?->masterProduct;
            $unitCost = $shopPurchaseCostOnly
                ? $this->resolveShopPurchaseUnitCost($master, $batchCostsByMasterId)
                : $this->resolveEffectiveUnitCost($master, $skuModel instanceof Sku ? $skuModel : null, $batchCostsByMasterId);

            $totalCogs += (float) $meta['qty'] * $unitCost * $qtyScale;
            $totalSettlementRevenue += ((float) $meta['qty'] / $totalInvoiceQty) * $skuNet;
        }

        return [
            'total_cogs' => $totalCogs,
            'total_settlement_revenue' => $totalSettlementRevenue,
        ];
    }

    /**
     * @param  iterable<int, InventoryOrderItem>  $orderItems
     * @param  array<string, array{net: float, principal_qty: float}>  $orderSkuMap
     * @return array{revenue: float, cogs: float}
     */
    private function settlementAwareLineEconomics(
        InventoryOrderItem $lineItem,
        float $lineQty,
        float $unitCost,
        iterable $orderItems,
        array $orderSkuMap,
        ?Sku $skuModel = null
    ): array {
        $matchKey = $this->matchSettlementSkuKey(
            $this->collectSkuMatchKeys($lineItem->sku_code ?? null, $skuModel),
            $orderSkuMap
        );

        if ($matchKey === null) {
            return ['revenue' => 0.0, 'cogs' => 0.0];
        }

        $totalInvoiceQty = 0.0;
        foreach ($orderItems as $item) {
            $itemSku = $item->relationLoaded('sku') ? $item->sku : null;
            $itemMatch = $this->matchSettlementSkuKey(
                $this->collectSkuMatchKeys($item->sku_code, $itemSku instanceof Sku ? $itemSku : null),
                $orderSkuMap
            );
            if ($itemMatch === $matchKey) {
                $totalInvoiceQty += (float) $item->quantity;
            }
        }

        if ($totalInvoiceQty <= 0 || $lineQty <= 0) {
            return ['revenue' => 0.0, 'cogs' => 0.0];
        }

        $skuNet = (float) ($orderSkuMap[$matchKey]['net'] ?? 0.0);
        $principalQty = (float) ($orderSkuMap[$matchKey]['principal_qty'] ?? 0.0);
        $effectiveQty = $principalQty > 0
            ? min($totalInvoiceQty, $principalQty)
            : ($skuNet > 0 ? min($totalInvoiceQty, 1.0) : 0.0);
        $qtyScale = $effectiveQty / $totalInvoiceQty;

        return [
            'revenue' => ($lineQty / $totalInvoiceQty) * $skuNet,
            'cogs' => $lineQty * $unitCost * $qtyScale,
        ];
    }

    /** @return \Illuminate\Database\Query\Builder|\Illuminate\Database\Eloquent\Builder */
    private function settlementIdsSubquery(array $filters)
    {
        $settlementIdsSub = Settlement::query()->select('id');

        if (! empty($filters['channel'])) {
            $channelIds = ChannelQuery::idsMatchingFilter((string) $filters['channel']);
            if ($channelIds !== []) {
                $settlementIdsSub->whereIn('channel_id', $channelIds);
            } else {
                $settlementIdsSub->whereRaw('1 = 0');
            }
        }

        return $settlementIdsSub;
    }

    /**
     * Sum settlement line `amount` per platform order id (cash impact; fees already in amount).
     * Aligned with SettlementController::orderNetTotals — do not add fee_amount (XML fees are stored twice).
     *
     * @return array<string, float> normalized platform_order_id => net sum
     */
    public function settlementPlatformOrderNetMap(array $filters): array
    {
        $c = static fn (int $n) => \App\Infrastructure\Support\DatabaseSql::asciiChar($n);
        $oidNormSql = "REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(platform_order_id,'')), {$c(34)}, ''), {$c(39)}, ''), ' ', ''), {$c(9)}, ''), {$c(13)}, '')";

        $netQuery = SettlementItem::query()
            ->whereIn('settlement_id', $this->settlementIdsSubquery($filters))
            ->whereNotNull('platform_order_id')
            ->where('platform_order_id', '!=', '');

        $this->applyReleasedSettlementItemScope($netQuery);
        $this->applyOrderCohortSettlementFilter($netQuery, $filters);

        $rows = $netQuery
            ->selectRaw("{$oidNormSql} as oid_key, SUM(CAST(amount AS DECIMAL(18,4))) as net_total")
            ->groupBy(DB::raw($oidNormSql))
            ->get();

        $byOrderId = [];
        foreach ($rows as $row) {
            $key = $this->normalizePlatformOrderKey((string) ($row->oid_key ?? ''));
            if ($key === '') {
                continue;
            }
            $byOrderId[$key] = (float) ($row->net_total ?? 0);
        }

        return $byOrderId;
    }

    /**
     * Refund amounts that are NOT already embedded in settlement payment sheets.
     * Amazon/Noon deduct product returns on a later settlement — that cash hit lives in
     * SUM(settlement_items.amount). Claiming InventoryReturn rows created from those sheets
     * must not be subtracted again from official P&L.
     *
     * @param  list<int>  $orderIds
     * @return \Illuminate\Support\Collection<int|string, float>
     */
    private function nonSettlementRefundsByOrderId(array $orderIds)
    {
        $orderIds = array_values(array_unique(array_filter(array_map('intval', $orderIds))));
        if ($orderIds === []) {
            return collect();
        }

        return InventoryReturn::query()
            ->whereIn('inventory_order_id', $orderIds)
            ->whereNotNull('refund_amount')
            ->where('refund_amount', '>', 0)
            ->where(function ($q) {
                $q->where(function ($w) {
                    $w->whereNull('external_status')
                        ->orWhere('external_status', '<>', 'refund_from_payment_sheet');
                })->where(function ($w) {
                    $w->whereNull('metadata')
                        ->orWhereRaw("NULLIF(TRIM(COALESCE(metadata->>'settlement_item_id', '')), '') IS NULL");
                });
            })
            ->selectRaw('inventory_order_id, SUM(refund_amount) as total')
            ->groupBy('inventory_order_id')
            ->pluck('total', 'inventory_order_id');
    }

    /**
     * @param  array<string, float>  $netMap
     */
    private function lookupOrderSettlementNet(?string $platformOrderId, array $netMap): ?float
    {
        $k = $this->normalizePlatformOrderKey($platformOrderId);
        if ($k === '') {
            return null;
        }
        if (array_key_exists($k, $netMap)) {
            return (float) $netMap[$k];
        }
        $compact = str_replace('-', '', $k);
        if ($compact !== '' && array_key_exists($compact, $netMap)) {
            return (float) $netMap[$compact];
        }

        return null;
    }

    /**
     * ABS sum of negative settlement lines (fees) tied to a batch of orders, keyed for lookup —
     * one query for the whole order collection instead of one per order. Each settlement item is
     * attributed to exactly one order (by inventory_order_id when it matches one of ours, else
     * platform_order_id) so summing both maps per order can't double-count a row.
     *
     * @return array{by_order_id: array<int, float>, by_platform_id: array<string, float>}
     */
    private function settlementNegativeFeesForOrders(array $inventoryOrderIds, array $platformOrderIds, array $filters): array
    {
        $byOrderId = [];
        $byPlatformId = [];
        if ($inventoryOrderIds === [] && $platformOrderIds === []) {
            return ['by_order_id' => $byOrderId, 'by_platform_id' => $byPlatformId];
        }

        $settlementIdsSub = Settlement::query()->select('id');
        if (! empty($filters['channel'])) {
            $channelIds = ChannelQuery::idsMatchingFilter((string) $filters['channel']);
            if ($channelIds !== []) {
                $settlementIdsSub->whereIn('channel_id', $channelIds);
            } else {
                $settlementIdsSub->whereRaw('1 = 0');
            }
        }

        $orderIdSet = array_flip($inventoryOrderIds);

        $rows = SettlementItem::query()
            ->whereIn('settlement_id', $settlementIdsSub)
            ->where('amount', '<', 0)
            ->where(function ($w) use ($inventoryOrderIds, $platformOrderIds) {
                $w->whereIn('inventory_order_id', $inventoryOrderIds);
                if ($platformOrderIds !== []) {
                    $w->orWhereIn('platform_order_id', $platformOrderIds);
                }
            })
            ->get(['inventory_order_id', 'platform_order_id', 'amount']);

        foreach ($rows as $row) {
            $abs = abs((float) $row->amount);
            $orderId = $row->inventory_order_id ? (int) $row->inventory_order_id : null;
            if ($orderId !== null && isset($orderIdSet[$orderId])) {
                $byOrderId[$orderId] = ($byOrderId[$orderId] ?? 0.0) + $abs;
            } elseif ($row->platform_order_id) {
                $byPlatformId[$row->platform_order_id] = ($byPlatformId[$row->platform_order_id] ?? 0.0) + $abs;
            }
        }

        return ['by_order_id' => $byOrderId, 'by_platform_id' => $byPlatformId];
    }

    /**
     * Calculate profit by SKU for a given period.
     */
    public function getProfitBySku($startDate, $endDate, $limit = 20, array $filters = [])
    {
        $filters['start_date'] = $startDate;
        $filters['end_date'] = $endDate;
        [$startAt, $endAt] = $this->normalizeRange((string) $startDate, (string) $endDate);
        $lineSalesQuery = InventoryOrderItem::join('inventory_orders', 'inventory_orders.id', '=', 'inventory_order_items.inventory_order_id')
            ->leftJoin('channels', 'channels.id', '=', 'inventory_orders.channel_id')
            ->whereBetween('inventory_orders.order_date', [$startAt, $endAt])
            ->whereIn('inventory_orders.status', ['completed', 'processing', 'shipped', 'sold', 'delivered'])
            ->where(function ($q) {
                $q->whereNull('inventory_orders.financial_status')
                    ->orWhere('inventory_orders.financial_status', '<>', 'cancelled');
            })
            ->when(Auth::check(), fn ($q) => $q->where('inventory_orders.user_id', Auth::id()))
            ->select(
                'inventory_order_items.inventory_order_id as order_id',
                'inventory_order_items.sku_id',
                'inventory_order_items.sku_code',
                'inventory_order_items.product_name',
                DB::raw("COALESCE(channels.name, 'Direct / Manual') as channel_name"),
                DB::raw('SUM(inventory_order_items.total_price) as revenue'),
                DB::raw('SUM(inventory_order_items.quantity) as quantity_sold')
            );

        if (! empty($filters['channel'])) {
            $channelIds = ChannelQuery::idsMatchingFilter((string) $filters['channel']);
            if ($channelIds === []) {
                $lineSalesQuery->whereRaw('1 = 0');
            } else {
                $lineSalesQuery->whereIn('inventory_orders.channel_id', $channelIds);
            }
        }

        if (! empty($filters['account_email'])) {
            $accountEmail = $filters['account_email'];
            $lineSalesQuery->whereExists(function ($sub) use ($accountEmail) {
                $sub->select(DB::raw(1))
                    ->from('order_costs')
                    ->whereColumn('order_costs.inventory_order_id', 'inventory_orders.id')
                    ->where('order_costs.account_email', $accountEmail);
            });
        }

        $lineSales = $lineSalesQuery
            ->groupBy(
                'inventory_order_items.inventory_order_id',
                'inventory_order_items.sku_id',
                'inventory_order_items.sku_code',
                'inventory_order_items.product_name',
                'channels.name'
            )
            ->get();

        if ($lineSales->isEmpty()) {
            return collect();
        }

        $orderRevenueMap = $lineSales
            ->groupBy('order_id')
            ->map(fn ($rows) => (float) $rows->sum('revenue'));

        $orderIds = $lineSales->pluck('order_id')->unique()->values();

        // Exclude payment-sheet claim returns — those amounts already sit inside settlement net.
        $orderReturnMap = $this->nonSettlementRefundsByOrderId($orderIds->all());

        // Include settlement deductions (negative amounts) as additional order costs.
        $settlementCostMap = SettlementItem::whereIn('inventory_order_id', $orderIds)
            ->where('amount', '<', 0)
            ->when(! empty($filters['channel']), function ($q) use ($filters) {
                $channelIds = ChannelQuery::idsMatchingFilter((string) $filters['channel']);
                if ($channelIds === []) {
                    $q->whereRaw('1 = 0');
                } else {
                    $q->whereHas('settlement', fn ($s) => $s->whereIn('channel_id', $channelIds));
                }
            })
            ->select('inventory_order_id', DB::raw('SUM(ABS(amount)) as settlement_cost'))
            ->groupBy('inventory_order_id')
            ->pluck('settlement_cost', 'inventory_order_id');

        $orderAccountMap = OrderCost::whereIn('inventory_order_id', $orderIds)
            ->select('inventory_order_id', DB::raw('MAX(account_email) as account_email'))
            ->groupBy('inventory_order_id')
            ->pluck('account_email', 'inventory_order_id');

        $skuIds = $lineSales->pluck('sku_id')->filter()->unique()->values();
        $skuModels = Sku::with(['offer.masterProduct'])
            ->whereIn('id', $skuIds)
            ->get()
            ->keyBy('id');

        // Lines imported before their SKU existed: cost them through the SKU owning the same code.
        $costingSkusByCode = $this->costingSkusByCode(
            $lineSales->filter(fn ($l) => empty($l->sku_id))->pluck('sku_code')->all()
        );

        $masterIdsForBatch = $skuModels->pluck('offer.masterProduct.id')
            ->merge(collect($costingSkusByCode)->map(fn ($sku) => $sku->offer?->masterProduct?->id))
            ->filter()->unique()->values()->all();
        $batchCostsForSkuReport = $this->averagePurchaseUnitCostByMasterProductIds($masterIdsForBatch);

        $skuMetaMap = $skuModels->mapWithKeys(function ($sku) use ($batchCostsForSkuReport) {
            $master = $sku->offer?->masterProduct;
            $unitCost = $this->resolveEffectiveUnitCost($master, $sku, $batchCostsForSkuReport);

            return [$sku->id => [
                'unit_cost' => $unitCost,
                'master_product_id' => $master?->id,
                'master_product_name' => $master?->internal_name,
            ]];
        });

        $aggregated = [];

        $restockedUnitsByOrder = $this->refundedRestockedUnitsByOrder($orderIds->all());

        $inventoryOrders = InventoryOrder::whereIn('id', $orderIds)->get(['id', 'platform_order_id'])->keyBy('id');
        $platformNetMap = $this->settlementPlatformOrderNetMap($filters);
        $platformSkuNetMap = $this->settlementPlatformOrderSkuNetMap($filters);
        $orderItemsByOrderId = InventoryOrderItem::query()
            ->whereIn('inventory_order_id', $orderIds)
            ->with('sku')
            ->get()
            ->groupBy('inventory_order_id');

        foreach ($lineSales as $line) {
            $invOrder = $inventoryOrders[$line->order_id] ?? null;
            $orderNet = $invOrder ? $this->lookupOrderSettlementNet($invOrder->platform_order_id, $platformNetMap) : null;

            $orderRevenue = (float) ($orderRevenueMap[$line->order_id] ?? 0);
            // Negative settlement lines (fees): only allocate when we are NOT using full order settlement net as revenue.
            $orderCosts = (float) ($settlementCostMap[$line->order_id] ?? 0);
            $lineRevenueList = (float) $line->revenue;
            $lineQty = (float) $line->quantity_sold;
            $lineSkuModel = $line->sku_id
                ? ($skuModels[$line->sku_id] ?? null)
                : ($costingSkusByCode[trim((string) $line->sku_code)] ?? null);
            $skuMeta = $line->sku_id ? ($skuMetaMap[$line->sku_id] ?? null) : null;
            if ($skuMeta === null && $lineSkuModel) {
                $costingMaster = $lineSkuModel->offer?->masterProduct;
                $skuMeta = [
                    'unit_cost' => $this->resolveEffectiveUnitCost($costingMaster, $lineSkuModel, $batchCostsForSkuReport),
                    'master_product_id' => $costingMaster?->id,
                    'master_product_name' => $costingMaster?->internal_name,
                ];
            }
            $unitCost = (float) data_get($skuMeta, 'unit_cost', 0);
            $lineCogs = $lineQty * $unitCost;
            $orderKey = $invOrder ? $this->normalizePlatformOrderKey($invOrder->platform_order_id) : '';
            $orderSkuMap = ($orderKey !== '' && isset($platformSkuNetMap[$orderKey]))
                ? $platformSkuNetMap[$orderKey]
                : [];
            $orderItems = $orderItemsByOrderId[$line->order_id] ?? collect();
            $representativeItem = $orderItems->first(
                fn ($oi) => (int) $oi->sku_id === (int) $line->sku_id
                    && $this->normalizeSkuKey($oi->sku_code) === $this->normalizeSkuKey($line->sku_code)
            ) ?? $orderItems->first(fn ($oi) => (int) $oi->sku_id === (int) $line->sku_id);

            if ($orderNet !== null && $orderSkuMap !== [] && $representativeItem) {
                $skuEconomics = $this->settlementAwareLineEconomics(
                    $representativeItem,
                    $lineQty,
                    $unitCost,
                    $orderItems,
                    $orderSkuMap,
                    $lineSkuModel
                );
                $lineRevenueEffective = $skuEconomics['revenue'];
                $lineCogs = $skuEconomics['cogs'];
                $allocatedCosts = 0.0;
            } elseif ($orderNet !== null) {
                $lineRevenueEffective = $orderRevenue > 0
                    ? ($lineRevenueList / $orderRevenue) * $orderNet
                    : 0.0;
                $allocatedCosts = 0.0;
            } else {
                $lineRevenueEffective = $lineRevenueList;
                $allocatedCosts = $orderRevenue > 0 ? ($lineRevenueList / $orderRevenue) * $orderCosts : 0.0;
            }

            // Refunded units back in stock are inventory again (same rule as getProfitSummary).
            $restocked = $restockedUnitsByOrder[(int) $line->order_id] ?? [];
            if ($restocked !== [] && $unitCost > 0) {
                $restockedUnits = $orderItems->count() === 1
                    ? array_sum($restocked)
                    : (float) ($restocked[$this->normalizeSkuKey($line->sku_code)] ?? 0.0);
                $lineCogs = max(0.0, $lineCogs - min($lineQty, $restockedUnits) * $unitCost);
            }

            // Payment-sheet claim returns are already inside settlement net; map excludes them.
            $orderRefund = (float) ($orderReturnMap[$line->order_id] ?? 0);
            $allocatedRefund = $orderRevenue > 0 ? ($lineRevenueList / $orderRevenue) * $orderRefund : 0.0;
            $grossProfit = $lineRevenueEffective - $lineCogs;
            $netProfit = $grossProfit - $allocatedCosts - $allocatedRefund;
            $accountEmail = $orderAccountMap[$line->order_id] ?? null;
            $key = ($line->sku_code ?: 'NO-SKU').'||'.($line->channel_name ?: 'Direct / Manual').'||'.($accountEmail ?: 'no-account');

            if (! isset($aggregated[$key])) {
                $aggregated[$key] = [
                    'sku_id' => $line->sku_id,
                    'sku_code' => $line->sku_code,
                    'product_name' => $line->product_name,
                    'master_product_id' => data_get($skuMeta, 'master_product_id'),
                    'master_product_name' => data_get($skuMeta, 'master_product_name'),
                    'channel_name' => $line->channel_name ?: 'Direct / Manual',
                    'account_email' => $accountEmail,
                    'quantity_sold' => 0.0,
                    'revenue' => 0.0,
                    'cogs' => 0.0,
                    'returns_amount' => 0.0,
                    'additional_costs' => 0.0,
                    'gross_profit' => 0.0,
                    'net_profit' => 0.0,
                ];
            }

            $aggregated[$key]['quantity_sold'] += $lineQty;
            $aggregated[$key]['revenue'] += $lineRevenueEffective;
            $aggregated[$key]['cogs'] += $lineCogs;
            $aggregated[$key]['returns_amount'] += $allocatedRefund;
            $aggregated[$key]['additional_costs'] += $allocatedCosts;
            $aggregated[$key]['gross_profit'] += $grossProfit;
            $aggregated[$key]['net_profit'] += $netProfit;
        }

        return collect(array_values($aggregated))
            ->map(function ($item) {
                $qty = (float) $item['quantity_sold'];
                $rev = (float) $item['revenue'];
                $cogs = (float) $item['cogs'];
                $returnsAmount = (float) $item['returns_amount'];
                $additional = (float) $item['additional_costs'];
                $gross = (float) $item['gross_profit'];
                $net = (float) $item['net_profit'];

                return [
                    'sku_id' => $item['sku_id'],
                    'sku_code' => $item['sku_code'],
                    'product_name' => $item['product_name'],
                    'master_product_id' => $item['master_product_id'] ?? null,
                    'master_product_name' => $item['master_product_name'] ?? null,
                    'channel_name' => $item['channel_name'],
                    'account_email' => $item['account_email'],
                    'quantity_sold' => round($qty, 2),
                    'avg_selling_price' => $qty > 0 ? round($rev / $qty, 2) : 0,
                    'revenue' => round($rev, 2),
                    'cogs' => round($cogs, 2),
                    'returns_amount' => round($returnsAmount, 2),
                    'additional_costs' => round($additional, 2),
                    'gross_profit' => round($gross, 2),
                    'net_profit' => round($net, 2),
                    'profit_per_unit' => $qty > 0 ? round($net / $qty, 4) : 0.0,
                    'margin' => $rev > 0 ? round(($net / $rev) * 100, 2) : 0,
                ];
            })
            ->sortByDesc('net_profit')
            ->values()
            ->take($limit);
    }

    /**
     * Get overall profit summary (aligned with settlement net & SKU report — no double-counting settlement fees).
     */
    public function getProfitSummary($startDate, $endDate, array $filters = [])
    {
        $filters['start_date'] = $startDate;
        $filters['end_date'] = $endDate;
        [$startAt, $endAt] = $this->normalizeRange((string) $startDate, (string) $endDate);

        $ordersQuery = InventoryOrder::query()
            ->with(['items.sku.offer.masterProduct'])
            ->whereBetween('order_date', [$startAt, $endAt])
            ->whereIn('status', ['completed', 'processing', 'shipped', 'sold', 'delivered'])
            ->where(function ($q) {
                $q->whereNull('financial_status')
                    ->orWhere('financial_status', '<>', 'cancelled');
            });
        $ordersQuery = $this->applyOrderFilters($ordersQuery, $filters);

        $ordersCollection = $ordersQuery->get();

        $expenses = (float) Expense::whereBetween('expense_date', [$startAt, $endAt])->sum('amount');

        if ($ordersCollection->isEmpty()) {
            $netProfit = -$expenses;

            return [
                'period_start' => $startDate,
                'period_end' => $endDate,
                'revenue' => 0.0,
                'cogs' => 0.0,
                'order_costs' => 0.0,
                'expenses' => $expenses,
                'refunds' => 0.0,
                'net_profit' => $netProfit,
                'margin' => 0.0,
                'total_revenue' => 0.0,
                'total_cogs' => 0.0,
                'total_expenses' => $expenses,
            ];
        }

        $this->attachCostingSkusToUnlinkedLines($ordersCollection->flatMap(fn ($order) => $order->items));

        $summaryMasterIds = $ordersCollection->flatMap(function ($order) {
            return $order->items->map(fn ($i) => $i->sku?->offer?->masterProduct?->id);
        })->filter()->unique()->values()->all();

        $batchCostsForSummary = $this->averagePurchaseUnitCostByMasterProductIds($summaryMasterIds);
        $platformNetMap = $this->settlementPlatformOrderNetMap($filters);
        $platformSkuNetMap = $this->settlementPlatformOrderSkuNetMap($filters);

        $orderIds = $ordersCollection->pluck('id')->all();
        // Manual / FBA-sheet returns only. Payment-sheet claim returns are inside settlement net.
        $refundsByOrderId = $this->nonSettlementRefundsByOrderId($orderIds);

        $platformOrderIds = $ordersCollection->pluck('platform_order_id')->filter()->unique()->values()->all();
        $negativeFees = $this->settlementNegativeFeesForOrders($orderIds, $platformOrderIds, $filters);
        $restockedUnitsByOrder = $this->refundedRestockedUnitsByOrder($orderIds);

        $displayRevenue = 0.0;
        $totalCogs = 0.0;
        $totalCogsReversed = 0.0;
        $totalRefunds = 0.0;
        $orderProfitSum = 0.0;
        $uncostedLines = 0;
        $uncostedRevenue = 0.0;

        foreach ($ordersCollection as $order) {
            $listSum = (float) $order->items->sum(fn ($i) => (float) $i->total_price);
            $orderKey = $this->normalizePlatformOrderKey($order->platform_order_id);
            $orderSkuMap = ($orderKey !== '' && isset($platformSkuNetMap[$orderKey]))
                ? $platformSkuNetMap[$orderKey]
                : [];

            $orderCogs = 0.0;
            if ($orderSkuMap !== []) {
                $settlementEconomics = $this->settlementAwareOrderCogsAndRevenue(
                    $order->items,
                    $orderSkuMap,
                    $batchCostsForSummary
                );
                $orderCogs = (float) $settlementEconomics['total_cogs'];
            } else {
                foreach ($order->items as $item) {
                    $master = $item->sku?->offer?->masterProduct;
                    $unitCost = $this->resolveEffectiveUnitCost($master, $item->sku, $batchCostsForSummary);
                    $orderCogs += $item->quantity * $unitCost;
                }
            }

            $unitCostByItemId = [];
            foreach ($order->items as $item) {
                $unitCost = $this->resolveEffectiveUnitCost($item->sku?->offer?->masterProduct, $item->sku, $batchCostsForSummary);
                $unitCostByItemId[$item->id] = $unitCost;
                if ($unitCost <= 0 && (float) $item->quantity > 0) {
                    $uncostedLines++;
                    $uncostedRevenue += (float) $item->total_price;
                }
            }

            // A refunded unit that physically came back to stock is inventory again, not cost of goods sold.
            $cogsReversal = $this->restockedReturnCogsReversal(
                $order->items,
                $restockedUnitsByOrder[(int) $order->id] ?? [],
                $unitCostByItemId
            );
            $cogsReversal = min($cogsReversal, $orderCogs);
            $orderCogs -= $cogsReversal;
            $totalCogsReversed += $cogsReversal;

            $nonSettlementRefunds = (float) ($refundsByOrderId[$order->id] ?? 0.0);

            $orderNet = $this->lookupOrderSettlementNet($order->platform_order_id, $platformNetMap);

            if ($orderNet !== null) {
                // Settlement net (incl. later-sheet refunds) is cash truth — even when ≤ 0 after returns.
                $displayRevenue += $orderNet;
                $orderProfitSum += $orderNet - $orderCogs - $nonSettlementRefunds;
                $totalRefunds += $nonSettlementRefunds;
            } else {
                $feeDeductions = ($negativeFees['by_order_id'][(int) $order->id] ?? 0.0)
                    + ($negativeFees['by_platform_id'][$order->platform_order_id] ?? 0.0);
                $displayRevenue += $listSum;
                $orderProfitSum += $listSum - $orderCogs - $nonSettlementRefunds - $feeDeductions;
                $totalRefunds += $nonSettlementRefunds;
            }

            $totalCogs += $orderCogs;
        }

        $netProfit = $orderProfitSum - $expenses;

        return [
            'period_start' => $startDate,
            'period_end' => $endDate,
            'revenue' => round($displayRevenue, 2),
            'cogs' => round((float) $totalCogs, 2),
            'order_costs' => 0.0,
            'expenses' => round($expenses, 2),
            'refunds' => round((float) $totalRefunds, 2),
            'net_profit' => round((float) $netProfit, 2),
            'margin' => $displayRevenue > 0 ? round(($netProfit / $displayRevenue) * 100, 2) : 0,
            'total_revenue' => round($displayRevenue, 2),
            'total_cogs' => round((float) $totalCogs, 2),
            'total_expenses' => round($expenses, 2),
            // Cost of refunded units that came back to stock (ledger IN + refund evidence) — not COGS.
            'cogs_reversed_restocked_returns' => round($totalCogsReversed, 2),
            // Lines with no purchase cost on file. Their revenue is NOT profit; the P&L is incomplete by this much.
            'uncosted_lines' => $uncostedLines,
            'uncosted_revenue' => round($uncostedRevenue, 2),
        ];
    }

    /**
     * Order lines imported before their SKU existed have sku_id = NULL, so their cost resolved to 0 and
     * the whole sale was booked as profit (Feb–Mar 2026: ~1.25M EGP of sales with ~3k cost). For costing
     * only, resolve such lines to the SKU that owns the same code — when exactly one live SKU does.
     * The relation is set in memory; sku_id is not written (that would make stock tools treat the
     * historical line as deductible).
     *
     * @param  iterable<int, InventoryOrderItem>  $items
     */
    private function attachCostingSkusToUnlinkedLines(iterable $items): void
    {
        $unlinked = [];
        foreach ($items as $item) {
            if (empty($item->sku_id) && trim((string) $item->sku_code) !== '') {
                $unlinked[] = $item;
            }
        }
        if ($unlinked === []) {
            return;
        }

        $byCode = $this->costingSkusByCode(array_map(fn ($i) => (string) $i->sku_code, $unlinked));
        foreach ($unlinked as $item) {
            $sku = $byCode[trim((string) $item->sku_code)] ?? null;
            if ($sku) {
                $item->setRelation('sku', $sku);
            }
        }
    }

    /**
     * @param  list<string>  $codes
     * @return array<string, Sku> code => the single live SKU owning it (ambiguous codes are left out)
     */
    private function costingSkusByCode(array $codes): array
    {
        $codes = array_values(array_unique(array_filter(array_map(fn ($c) => trim((string) $c), $codes))));
        if ($codes === []) {
            return [];
        }

        $candidates = Sku::query()
            ->with('offer.masterProduct')
            ->where(function ($q) use ($codes) {
                $q->whereIn('sku', $codes)->orWhereIn('marketplace_id', $codes);
            })
            ->get();

        $byCode = [];
        foreach ($candidates as $sku) {
            foreach (array_unique(array_filter([trim((string) $sku->sku), trim((string) $sku->marketplace_id)])) as $code) {
                $byCode[$code][$sku->id] = $sku;
            }
        }

        $out = [];
        foreach ($byCode as $code => $matches) {
            if (count($matches) === 1) {
                $out[$code] = reset($matches);
            }
        }

        return $out;
    }

    /**
     * Units per order and SKU code that were refunded AND physically restocked. Both proofs are required:
     * a stock-ledger IN for the return (goods back) and a refund on the order (sale reversed). Status flags
     * and auto-filled credit amounts are not trusted — in Apr 2026 ~900 returns carried a credit amount
     * with no refund on any payment sheet.
     *
     * @param  list<int>  $orderIds
     * @return array<int, array<string, float>> order id => normalized sku code => units
     */
    private function refundedRestockedUnitsByOrder(array $orderIds): array
    {
        $orderIds = array_values(array_unique(array_filter(array_map('intval', $orderIds))));
        if ($orderIds === []) {
            return [];
        }

        $rows = DB::table('inventory_returns as r')
            ->join('inventory_transactions as t', function ($j) {
                $j->whereRaw('t.reference_id = CAST(r.id AS VARCHAR)')
                    ->where('t.reference_type', 'Return')
                    ->where('t.type', 'IN');
            })
            ->whereIn('r.inventory_order_id', $orderIds)
            // Voided returns (e.g. restocked beyond the sold quantity, then reversed) never came back.
            ->where(fn ($q) => $q->whereNull('r.status')->orWhere('r.status', '<>', 'void'))
            ->where(function ($q) {
                // refund_amount is auto-filled as a credit note when a return is restocked, so it only proves
                // a refund for orders no platform settles (shop). Platform orders need the refund on the sheet.
                $q->where(function ($shop) {
                    $shop->where('r.refund_amount', '>', 0)
                        ->whereNotExists(function ($sub) {
                            $sub->select(DB::raw(1))
                                ->from('settlement_items as si_any')
                                ->whereColumn('si_any.inventory_order_id', 'r.inventory_order_id');
                        });
                })
                    ->orWhereExists(function ($sub) {
                        $sub->select(DB::raw(1))
                            ->from('settlement_items as si')
                            ->whereColumn('si.inventory_order_id', 'r.inventory_order_id')
                            ->where('si.amount', '<', 0)
                            ->where(function ($w) {
                                $w->where('si.line_kind', 'refund_principal')
                                    ->orWhereRaw("LOWER(COALESCE(si.transaction_type, '')) LIKE '%refund%'")
                                    ->orWhereRaw("LOWER(COALESCE(si.description, '')) LIKE 'refund%'");
                            });
                    });
            })
            ->groupBy('r.inventory_order_id', 'r.sku_code')
            ->selectRaw('r.inventory_order_id as order_id, r.sku_code, SUM(t.quantity) as qty')
            ->get();

        $out = [];
        foreach ($rows as $row) {
            $key = $this->normalizeSkuKey((string) $row->sku_code);
            $out[(int) $row->order_id][$key] = ($out[(int) $row->order_id][$key] ?? 0.0) + (float) $row->qty;
        }

        return $out;
    }

    /**
     * Cost to take back out of COGS for restocked refunded units, capped at each line's sold quantity
     * (some historical returns booked more units back than were sold).
     *
     * @param  iterable<int, InventoryOrderItem>  $orderItems
     * @param  array<string, float>  $restockedBySku
     * @param  array<int, float>  $unitCostByItemId
     */
    private function restockedReturnCogsReversal(iterable $orderItems, array $restockedBySku, array $unitCostByItemId): float
    {
        if ($restockedBySku === []) {
            return 0.0;
        }

        $items = collect($orderItems)->values();
        if ($items->count() === 1) {
            // Single-line order: the return can only be this line, whatever code the return sheet used.
            $restockedBySku = ['*' => array_sum($restockedBySku)];
        }

        $reversal = 0.0;
        foreach ($items as $item) {
            $keys = $items->count() === 1
                ? ['*']
                : $this->collectSkuMatchKeys($item->sku_code, $item->sku instanceof Sku ? $item->sku : null);
            $need = (float) $item->quantity;
            foreach ($keys as $k) {
                $take = min($need, (float) ($restockedBySku[$k] ?? 0.0));
                if ($take <= 0) {
                    continue;
                }
                $restockedBySku[$k] -= $take;
                $need -= $take;
                $reversal += $take * (float) ($unitCostByItemId[$item->id] ?? 0.0);
            }
        }

        return $reversal;
    }

    /**
     * ROI / capital-cycle metrics.
     * Accrual P&L (revenue, COGS, refunds, expenses, net_profit) comes from getProfitSummary —
     * the same source as the dashboard. Purchase invoice totals are money-flow only and never enter net_profit.
     *
     * @return array<string, float|int|array<string, float>>
     */
    public function getRoiMetrics(array $filters = []): array
    {
        $totalCapital = (float) CapitalSource::query()->sum('amount');

        $startDate = ! empty($filters['start_date']) ? (string) $filters['start_date'] : '2000-01-01';
        $endDate = ! empty($filters['end_date']) ? (string) $filters['end_date'] : now()->toDateString();

        $summary = $this->getProfitSummary($startDate, $endDate, array_merge($filters, [
            'start_date' => $startDate,
            'end_date' => $endDate,
        ]));

        $revenue = (float) ($summary['revenue'] ?? $summary['total_revenue'] ?? 0);
        $cogs = (float) ($summary['cogs'] ?? $summary['total_cogs'] ?? 0);
        $expensesAmt = (float) ($summary['expenses'] ?? $summary['total_expenses'] ?? 0);
        $refunds = (float) ($summary['refunds'] ?? 0);
        $netProfit = (float) ($summary['net_profit'] ?? 0);

        // Purchases = inventory investment in the period (not COGS).
        $purchasesQuery = PurchaseBatch::query()
            ->whereRaw("LOWER(COALESCE(status, '')) <> 'cancelled'");
        if (! empty($filters['start_date']) && ! empty($filters['end_date'])) {
            [$startAt, $endAt] = $this->normalizeRange((string) $filters['start_date'], (string) $filters['end_date']);
            $purchasesQuery->whereBetween('invoice_date', [
                Carbon::parse($startAt)->toDateString(),
                Carbon::parse($endAt)->toDateString(),
            ]);
        }
        $totalPurchases = (float) $purchasesQuery->sum(DB::raw('COALESCE(grand_total, subtotal, 0)'));

        $lossesQuery = InventoryAdjustment::query();
        if (! empty($filters['start_date']) && ! empty($filters['end_date'])) {
            [$startAt, $endAt] = $this->normalizeRange((string) $filters['start_date'], (string) $filters['end_date']);
            $lossesQuery->whereBetween('created_at', [$startAt, $endAt]);
        }
        $totalLosses = (float) $lossesQuery->sum('total_loss_amount');

        $roi = $totalCapital > 0 ? ($netProfit / $totalCapital) * 100 : 0.0;
        $grossMargin = $revenue > 0 ? (($revenue - $cogs) / $revenue) * 100 : 0.0;
        $netMargin = $revenue > 0 ? ($netProfit / $revenue) * 100 : 0.0;

        // Days of inventory on hand = stock at cost ÷ average daily COGS over the period.
        // (Purchases ÷ revenue is not a turnover measure: it mixes cost with selling price and
        // grows whenever stock is built up.)
        $inventoryAtCost = (float) (app(InventoryValuationService::class)->warehouseTotals()['total_cost'] ?? 0);
        $periodDays = $this->roiPeriodDays($startDate, $endDate, $filters);
        $dailyCogs = $periodDays > 0 ? $cogs / $periodDays : 0.0;
        $rotationDays = $dailyCogs > 0 ? (int) round($inventoryAtCost / $dailyCogs) : 0;

        // Cash in hand is the treasury ledger position (receipts − payments − expenses), the same number
        // as the Bank Accounts screen. Capital is already a receipt there, so it is not added again.
        $tenantUserId = (int) (TenantContext::id() ?? Auth::id() ?? 0);
        $cashInHand = app(TreasurySpendGuard::class)->availableCashForUser($tenantUserId);

        $expensesByCategory = Expense::query()
            ->when(! empty($filters['start_date']) && ! empty($filters['end_date']), function ($q) use ($filters) {
                [$startAt, $endAt] = $this->normalizeRange((string) $filters['start_date'], (string) $filters['end_date']);
                $q->whereBetween('expense_date', [
                    Carbon::parse($startAt)->toDateString(),
                    Carbon::parse($endAt)->toDateString(),
                ]);
            })
            ->select('category', DB::raw('SUM(amount) as total'))
            ->groupBy('category')
            ->pluck('total', 'category')
            ->map(fn ($v) => (float) $v)
            ->all();

        return [
            'total_capital' => round($totalCapital, 2),
            // Accrual P&L (canonical — matches /reports/profit-summary)
            'revenue' => round($revenue, 2),
            'total_sales' => round($revenue, 2), // UI compat
            'cogs' => round($cogs, 2),
            'total_cogs' => round($cogs, 2),
            'total_expenses' => round($expensesAmt, 2),
            'total_refunds' => round($refunds, 2),
            'net_profit' => round($netProfit, 2),
            'margin' => $revenue > 0 ? round(($netProfit / $revenue) * 100, 2) : 0.0,
            'roi' => round($roi, 2),
            'gross_margin' => round($grossMargin, 2),
            'net_margin' => round($netMargin, 2),
            // Money-flow / inventory investment (not used in net_profit)
            'total_purchases' => round($totalPurchases, 2),
            'purchased_inventory' => round($totalPurchases, 2),
            'total_losses' => round($totalLosses, 2),
            'rotation_days' => $rotationDays,
            'inventory_at_cost' => round($inventoryAtCost, 2),
            'cash_in_hand' => round($cashInHand, 2),
            'expenses_by_category' => $expensesByCategory,
            'period_start' => $startDate,
            'period_end' => $endDate,
        ];
    }

    /**
     * Calendar days the ROI period really covers. An open "all time" start (2000-01-01) is clamped to
     * the first order date so averages are not diluted by years with no trading.
     */
    private function roiPeriodDays(string $startDate, string $endDate, array $filters): int
    {
        [$startAt, $endAt] = $this->normalizeRange($startDate, $endDate);
        $firstOrderAt = $this->applyOrderFilters(InventoryOrder::query(), $filters)
            ->whereBetween('order_date', [$startAt, $endAt])
            ->min('order_date');

        $from = Carbon::parse($firstOrderAt ?: $startAt)->startOfDay();
        $to = Carbon::parse($endAt)->startOfDay();
        if ($to->isFuture()) {
            $to = now()->startOfDay();
        }

        return max(1, (int) $from->diffInDays($to) + 1);
    }

    /**
     * Cash-based period result: receipts − receipt-linked COGS − expenses.
     * Not the official net profit — use getProfitSummary for accrual P&L.
     */
    public function getCashProfitSnapshot(string $startDate, string $endDate): array
    {
        [$startAt, $endAt] = $this->normalizeRange($startDate, $endDate);
        $startDay = Carbon::parse($startAt)->toDateString();
        $endDay = Carbon::parse($endAt)->toDateString();

        $receipts = Receipt::query()
            ->whereDate('receipt_date', '>=', $startDay)
            ->whereDate('receipt_date', '<=', $endDay)
            ->get(['id', 'amount', 'reference_type', 'reference_id', 'category', 'receipt_date']);

        $totalReceipts = round((float) $receipts->sum('amount'), 2);

        $orderReferenceTypes = InventoryMorphTypes::inventoryOrderReferenceTypes();
        $settlementReferenceTypes = InventoryMorphTypes::settlementReferenceTypes();

        $directOrderIds = [];
        $settlementIds = [];
        /** @var array<int, float> */
        $receiptAmountByOrderId = [];
        /** @var array<int, float> */
        $receiptAmountBySettlementId = [];

        foreach ($receipts as $receipt) {
            $refType = (string) ($receipt->reference_type ?? '');
            $refId = (int) ($receipt->reference_id ?? 0);
            $amount = (float) ($receipt->amount ?? 0);
            if ($refId <= 0) {
                continue;
            }
            if (in_array($refType, $orderReferenceTypes, true)) {
                $directOrderIds[$refId] = true;
                $receiptAmountByOrderId[$refId] = ($receiptAmountByOrderId[$refId] ?? 0.0) + $amount;
            } elseif (in_array($refType, $settlementReferenceTypes, true)) {
                $settlementIds[$refId] = true;
                $receiptAmountBySettlementId[$refId] = ($receiptAmountBySettlementId[$refId] ?? 0.0) + $amount;
            }
        }

        $settlementIdList = array_keys($settlementIds);
        $totalCogs = 0.0;
        $linkedOrderCount = 0;
        $linkedUnitQty = 0.0;

        if ($settlementIdList !== []) {
            $fromSettlements = $this->cashProfitCogsFromSettlementSheets(
                $settlementIdList,
                $receiptAmountBySettlementId
            );
            $totalCogs += (float) ($fromSettlements['cogs'] ?? 0);
            $linkedOrderCount += (int) ($fromSettlements['order_count'] ?? 0);
            $linkedUnitQty += (float) ($fromSettlements['units'] ?? 0);
        }

        $directOrderIdList = array_keys($directOrderIds);
        if ($directOrderIdList !== []) {
            $orders = InventoryOrder::query()
                ->with(['items.sku.offer.masterProduct'])
                ->whereIn('id', $directOrderIdList)
                ->whereIn('status', ['completed', 'processing', 'shipped', 'sold', 'delivered'])
                ->where(function ($q) {
                    $q->whereNull('financial_status')
                        ->orWhere('financial_status', '<>', 'cancelled');
                })
                ->get();

            $masterIds = [];
            foreach ($orders as $order) {
                foreach ($order->items ?? [] as $item) {
                    $mid = $item->sku?->offer?->masterProduct?->id;
                    if ($mid) {
                        $masterIds[] = (int) $mid;
                    }
                }
            }
            $batchCosts = $this->averagePurchaseUnitCostByMasterProductIds($masterIds);

            foreach ($orders as $order) {
                if ($this->isOrderCancelledForProfit($order)) {
                    continue;
                }
                $orderId = (int) $order->id;
                if (! isset($directOrderIds[$orderId])) {
                    continue;
                }

                $fullOrderCogs = $this->directOrderPurchaseCost($order->items ?? [], $batchCosts, true);
                $collected = (float) ($receiptAmountByOrderId[$orderId] ?? 0.0);
                $ratio = $this->orderReceiptCollectionRatio($order, $collected);
                $orderCogs = $fullOrderCogs * $ratio;
                if ($orderCogs > 0) {
                    $totalCogs += $orderCogs;
                    $linkedOrderCount++;
                    foreach ($order->items ?? [] as $item) {
                        $linkedUnitQty += (float) ($item->quantity ?? 0) * $ratio;
                    }
                }
            }
        }

        $totalCogs = round($totalCogs, 2);
        $cogsToReceiptsPct = $totalReceipts > 0
            ? round(($totalCogs / $totalReceipts) * 100, 1)
            : null;

        $totalExpenses = round((float) Expense::query()
            ->whereDate('expense_date', '>=', $startDay)
            ->whereDate('expense_date', '<=', $endDay)
            ->sum('amount'), 2);

        $netProfit = round($totalReceipts - $totalCogs - $totalExpenses, 2);

        return [
            'start_date' => $startDay,
            'end_date' => $endDay,
            'total_receipts' => $totalReceipts,
            'total_cogs' => $totalCogs,
            'total_expenses' => $totalExpenses,
            // Canonical name for cash-basis result (not official accrual net profit).
            'cash_period_result' => $netProfit,
            // Deprecated alias — same value as cash_period_result; prefer cash_period_result in new UI.
            'net_profit' => $netProfit,
            'receipt_count' => $receipts->count(),
            'linked_order_count' => $linkedOrderCount,
            'linked_unit_qty' => round($linkedUnitQty, 2),
            'cogs_to_receipts_pct' => $cogsToReceiptsPct,
            'unlinked_receipt_count' => $receipts->filter(function ($r) use ($orderReferenceTypes, $settlementReferenceTypes) {
                $type = (string) ($r->reference_type ?? '');

                return ! in_array($type, $orderReferenceTypes, true) && ! in_array($type, $settlementReferenceTypes, true);
            })->count(),
        ];
    }

    /**
     * Share of order value collected via receipts in this period (caps at 1 — no COGS duplication on split payments).
     */
    private function orderReceiptCollectionRatio(InventoryOrder $order, float $collectedInPeriod): float
    {
        if ($collectedInPeriod <= 0) {
            return 0.0;
        }

        $total = (float) ($order->total_amount ?? 0);
        if ($total <= 0) {
            foreach ($order->items ?? [] as $item) {
                $lineTotal = (float) ($item->total_price ?? 0);
                if ($lineTotal <= 0) {
                    $lineTotal = (float) ($item->quantity ?? 0) * (float) ($item->unit_price ?? 0);
                }
                $total += $lineTotal;
            }
        }

        if ($total <= 0) {
            return 1.0;
        }

        return min(1.0, max(0.0, $collectedInPeriod / $total));
    }

    /**
     * COGS for settlement-linked receipts: principal qty per order/SKU (same SQL as period-profit) × shop purchase cost.
     * Prorates by receipt amount vs settlement net when payouts are split across multiple receipts.
     *
     * @param  int[]  $settlementIds
     * @param  array<int, float>  $receiptAmountBySettlementId
     * @return array{cogs: float, order_count: int, units: float}
     */
    private function cashProfitCogsFromSettlementSheets(
        array $settlementIds,
        array $receiptAmountBySettlementId = []
    ): array {
        $settlementIds = array_values(array_unique(array_filter(array_map('intval', $settlementIds))));
        if ($settlementIds === []) {
            return ['cogs' => 0.0, 'order_count' => 0, 'units' => 0.0];
        }

        $cogs = 0.0;
        $units = 0.0;
        $orderKeys = [];

        foreach ($settlementIds as $settlementId) {
            $skuNetMap = $this->settlementSkuNetMapForSettlementIds([$settlementId]);
            if ($skuNetMap === []) {
                continue;
            }

            $sheet = $this->settlementCogsFromSkuNetMapPreferOrders($skuNetMap, $settlementId);
            $collected = (float) ($receiptAmountBySettlementId[$settlementId] ?? 0.0);
            $sheetNet = $this->settlementSheetNetTotal($settlementId, $skuNetMap);
            $ratio = $this->settlementReceiptCollectionRatio($sheetNet, $collected);

            $cogs += (float) ($sheet['cogs'] ?? 0.0) * $ratio;
            $units += (float) ($sheet['units'] ?? 0.0) * $ratio;
            foreach (array_keys($skuNetMap) as $orderKey) {
                if ($orderKey !== '') {
                    $orderKeys[$orderKey] = true;
                }
            }
        }

        return [
            'cogs' => $cogs,
            'order_count' => count($orderKeys),
            'units' => $units,
        ];
    }

    /**
     * Settlement COGS aligned with Orders page: order line qty × shop purchase cost when the order exists;
     * capped by settlement principal qty (same as period-profit table). Sheet-only lines use SKU fallback.
     *
     * @param  array<string, array<string, array{net: float, principal_qty: float}>>  $skuNetMap
     * @return array{cogs: float, units: float}
     */
    private function settlementCogsFromSkuNetMapPreferOrders(array $skuNetMap, int $settlementId): array
    {
        if ($skuNetMap === []) {
            return ['cogs' => 0.0, 'units' => 0.0];
        }

        $rawPlatformIds = SettlementItem::query()
            ->where('settlement_id', $settlementId)
            ->whereNotNull('platform_order_id')
            ->where('platform_order_id', '!=', '')
            ->distinct()
            ->pluck('platform_order_id')
            ->all();

        $orders = $rawPlatformIds === []
            ? collect()
            : InventoryOrder::query()
                ->with(['items.sku.offer.masterProduct'])
                ->whereIn('platform_order_id', $rawPlatformIds)
                ->whereIn('status', ['completed', 'processing', 'shipped', 'sold', 'delivered'])
                ->where(function ($q) {
                    $q->whereNull('financial_status')
                        ->orWhere('financial_status', '<>', 'cancelled');
                })
                ->get();

        $masterIds = [];
        foreach ($orders as $order) {
            foreach ($order->items ?? [] as $item) {
                $mid = $item->sku?->offer?->masterProduct?->id;
                if ($mid) {
                    $masterIds[] = (int) $mid;
                }
            }
        }
        $batchCosts = $this->averagePurchaseUnitCostByMasterProductIds($masterIds);

        $cogs = 0.0;
        $units = 0.0;
        $matchedMapKeys = [];

        foreach ($orders as $order) {
            if ($this->isOrderCancelledForProfit($order)) {
                continue;
            }

            $orderKey = $this->resolveSettlementMapOrderKey($order->platform_order_id, $skuNetMap);
            if ($orderKey === null) {
                continue;
            }

            $matchedMapKeys[$orderKey] = true;
            $orderSkuMap = $skuNetMap[$orderKey];
            $economics = $this->settlementAwareOrderCogsAndRevenue(
                $order->items ?? [],
                $orderSkuMap,
                $batchCosts,
                null,
                true
            );
            $cogs += (float) ($economics['total_cogs'] ?? 0);
            $units += $this->settlementAwareSoldUnits($order->items ?? [], $orderSkuMap);
        }

        $orphanMap = [];
        foreach ($skuNetMap as $orderKey => $skuMap) {
            if (! isset($matchedMapKeys[$orderKey])) {
                $orphanMap[$orderKey] = $skuMap;
            }
        }

        if ($orphanMap !== []) {
            $fallback = $this->cogsAndUnitsFromSettlementSkuNetMapOrphans($orphanMap, $settlementId);
            $cogs += (float) ($fallback['cogs'] ?? 0);
            $units += (float) ($fallback['units'] ?? 0);
        }

        return ['cogs' => $cogs, 'units' => $units];
    }

    /**
     * @param  array<string, array<string, array{net: float, principal_qty: float}>>  $skuNetMap
     */
    private function resolveSettlementMapOrderKey(?string $platformOrderId, array $skuNetMap): ?string
    {
        $k = $this->normalizePlatformOrderKey($platformOrderId);
        if ($k !== '' && isset($skuNetMap[$k])) {
            return $k;
        }

        $compact = str_replace('-', '', $k);
        if ($compact === '') {
            return null;
        }

        foreach (array_keys($skuNetMap) as $mapKey) {
            if ($mapKey === $k || str_replace('-', '', $mapKey) === $compact) {
                return $mapKey;
            }
        }

        return null;
    }

    /**
     * Effective sold units for settlement COGS (mirrors settlementAwareOrderCogsAndRevenue qty scale).
     *
     * @param  iterable<int, InventoryOrderItem>  $orderItems
     * @param  array<string, array{net: float, principal_qty: float}>  $orderSkuMap
     */
    private function settlementAwareSoldUnits(iterable $orderItems, array $orderSkuMap): float
    {
        $groupInvoiceQty = [];
        $lineMeta = [];

        foreach ($orderItems as $item) {
            $skuModel = $item->sku ?? null;
            $matchKey = $this->matchSettlementSkuKey(
                $this->collectSkuMatchKeys($item->sku_code, $skuModel instanceof Sku ? $skuModel : null),
                $orderSkuMap
            );
            if ($matchKey === null) {
                continue;
            }

            $qty = (float) $item->quantity;
            $groupInvoiceQty[$matchKey] = ($groupInvoiceQty[$matchKey] ?? 0.0) + $qty;
            $lineMeta[] = ['matchKey' => $matchKey, 'qty' => $qty];
        }

        $units = 0.0;
        foreach ($lineMeta as $meta) {
            $matchKey = $meta['matchKey'];
            $skuNet = (float) ($orderSkuMap[$matchKey]['net'] ?? 0.0);
            $principalQty = (float) ($orderSkuMap[$matchKey]['principal_qty'] ?? 0.0);
            $totalInvoiceQty = (float) ($groupInvoiceQty[$matchKey] ?? 0.0);
            if ($totalInvoiceQty <= 0) {
                continue;
            }

            $effectiveQty = $principalQty > 0
                ? min($totalInvoiceQty, $principalQty)
                : ($skuNet > 0 ? min($totalInvoiceQty, 1.0) : 0.0);
            $qtyScale = $effectiveQty / $totalInvoiceQty;
            $units += (float) $meta['qty'] * $qtyScale;
        }

        return $units;
    }

    /**
     * Sheet lines with no matching inventory order (SKU-only fallback).
     *
     * @param  array<string, array<string, array{net: float, principal_qty: float}>>  $skuNetMap
     * @return array{cogs: float, units: float}
     */
    private function cogsAndUnitsFromSettlementSkuNetMapOrphans(array $skuNetMap, int $settlementId): array
    {
        if ($skuNetMap === []) {
            return ['cogs' => 0.0, 'units' => 0.0];
        }

        $rawSkuRows = SettlementItem::query()
            ->where('settlement_id', $settlementId)
            ->whereNotNull('sku')
            ->where('sku', '!=', '')
            ->distinct()
            ->pluck('sku')
            ->all();

        $mastersBySkuKey = $this->masterProductsByNormalizedSkuKeys($rawSkuRows);
        $masterIds = [];
        foreach ($mastersBySkuKey as $master) {
            if ($master?->id) {
                $masterIds[] = (int) $master->id;
            }
        }
        $batchCosts = $this->averagePurchaseUnitCostByMasterProductIds($masterIds);

        $cogs = 0.0;
        $units = 0.0;
        foreach ($skuNetMap as $skuMap) {
            foreach ($skuMap as $skuKey => $data) {
                $net = (float) ($data['net'] ?? 0);
                if ($net <= 0) {
                    continue;
                }

                $principalQty = (float) ($data['principal_qty'] ?? 0);
                $effectiveQty = $principalQty > 0 ? $principalQty : 1.0;

                $master = $mastersBySkuKey[$skuKey] ?? null;
                $unit = $this->resolveShopPurchaseUnitCost($master, $batchCosts);
                $cogs += $effectiveQty * $unit;
                $units += $effectiveQty;
            }
        }

        return ['cogs' => $cogs, 'units' => $units];
    }

    /**
     * @param  array<string, array<string, array{net: float, principal_qty: float}>>  $skuNetMap
     */
    private function settlementSheetNetTotal(int $settlementId, array $skuNetMap): float
    {
        $fromMap = 0.0;
        foreach ($skuNetMap as $skuMap) {
            foreach ($skuMap as $data) {
                $fromMap += (float) ($data['net'] ?? 0);
            }
        }
        if ($fromMap > 0) {
            return $fromMap;
        }

        $stored = (float) (Settlement::query()->whereKey($settlementId)->value('total_amount') ?? 0);
        if ($stored > 0) {
            return $stored;
        }

        $q = SettlementItem::query()->where('settlement_id', $settlementId);
        $this->applyReleasedSettlementItemScope($q);

        return max(0.0, (float) $q->sum('amount'));
    }

    private function settlementReceiptCollectionRatio(float $sheetNet, float $collectedInPeriod): float
    {
        if ($collectedInPeriod <= 0) {
            return 0.0;
        }
        if ($sheetNet <= 0) {
            return 1.0;
        }

        return min(1.0, max(0.0, $collectedInPeriod / $sheetNet));
    }

    /**
     * @param  string[]  $skuCodes
     * @return array<string, \App\Domain\Models\Wms\MasterProduct|null>
     */
    private function masterProductsByNormalizedSkuKeys(array $skuCodes): array
    {
        $skuCodes = array_values(array_unique(array_filter(array_map('trim', $skuCodes))));
        if ($skuCodes === []) {
            return [];
        }

        $skus = Sku::query()
            ->with(['offer.masterProduct'])
            ->whereIn('sku', $skuCodes)
            ->get();

        $out = [];
        foreach ($skus as $sku) {
            $key = $this->normalizeSkuKey($sku->sku);
            if ($key !== '' && ! array_key_exists($key, $out)) {
                $out[$key] = $sku->offer?->masterProduct;
            }
        }

        return $out;
    }

    private function settlementLineSoldQuantity(SettlementItem $item): float
    {
        $desc = strtolower((string) ($item->description ?? ''));
        if (str_contains($desc, 'itemprice') && str_contains($desc, 'principal')) {
            return max((float) ($item->quantity ?? 0), 1.0);
        }

        $qty = abs((float) ($item->quantity ?? 0));
        if ($qty > 0) {
            return $qty;
        }

        return 1.0;
    }

    private function isSettlementProductSaleLine(SettlementItem $item): bool
    {
        $type = strtolower((string) ($item->transaction_type ?? ''));
        $desc = strtolower((string) ($item->description ?? ''));
        $amount = (float) ($item->amount ?? 0);

        if ($amount <= 0) {
            return false;
        }
        if (str_contains($type, 'refund') || str_contains($desc, 'refund') || str_contains($desc, 'return')) {
            return false;
        }
        if (
            str_contains($type, 'fee')
            || str_contains($type, 'commission')
            || str_contains($type, 'shipping')
            || str_contains($type, 'service')
            || str_contains($type, 'storage')
            || str_contains($type, 'handling')
            || str_contains($desc, 'fee')
            || str_contains($desc, 'commission')
            || str_contains($desc, 'shipping')
            || str_contains($desc, 'fba')
        ) {
            return false;
        }

        $descCompact = str_replace([' ', "\t", '_', '-'], '', $desc);

        return str_contains($type, 'order')
            || str_contains($type, 'payment')
            || str_contains($desc, 'itemprice')
            || (str_contains($type, 'item') && (str_contains($type, 'price') || str_contains($type, 'charg')))
            || str_contains($descCompact, 'itemprice');
    }

    private function isReleasedSettlementItem(SettlementItem $item): bool
    {
        $status = strtolower(trim((string) ($item->transaction_status ?? '')));
        if ($status === '') {
            return true;
        }

        return ! in_array($status, ['deferred', 'pending', 'reversed'], true);
    }

    /**
     * Settlement net + principal qty per platform order id and SKU for specific settlement sheets (receipt-linked).
     *
     * @param  int[]  $settlementIds
     * @return array<string, array<string, array{net: float, principal_qty: float}>>
     */
    private function settlementSkuNetMapForSettlementIds(array $settlementIds): array
    {
        if ($settlementIds === []) {
            return [];
        }

        $c = static fn (int $n) => \App\Infrastructure\Support\DatabaseSql::asciiChar($n);
        $oidNormSql = "REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(platform_order_id,'')), {$c(34)}, ''), {$c(39)}, ''), ' ', ''), {$c(9)}, ''), {$c(13)}, '')";
        $skuNormSql = "UPPER(REPLACE(REPLACE(TRIM(COALESCE(sku,'')), ' ', ''), {$c(9)}, ''))";
        $principalQtySql = "SUM(CASE WHEN LOWER(COALESCE(description,'')) LIKE '%itemprice%' AND LOWER(COALESCE(description,'')) LIKE '%principal%' THEN GREATEST(COALESCE(quantity,0), 1) ELSE 0 END)";

        $query = SettlementItem::query()
            ->whereIn('settlement_id', $settlementIds)
            ->whereNotNull('platform_order_id')
            ->where('platform_order_id', '!=', '')
            ->whereNotNull('sku')
            ->where('sku', '!=', '');

        $this->applyReleasedSettlementItemScope($query);

        $rows = $query
            ->selectRaw("{$oidNormSql} as oid_key, {$skuNormSql} as sku_key")
            ->selectRaw('SUM(CAST(amount AS DECIMAL(18,4))) as net_total')
            ->selectRaw("{$principalQtySql} as principal_qty")
            ->groupBy(DB::raw($oidNormSql), DB::raw($skuNormSql))
            ->get();

        $map = [];
        foreach ($rows as $row) {
            $orderKey = $this->normalizePlatformOrderKey((string) ($row->oid_key ?? ''));
            $skuKey = $this->normalizeSkuKey((string) ($row->sku_key ?? ''));
            if ($orderKey === '' || $skuKey === '') {
                continue;
            }
            $net = (float) ($row->net_total ?? 0);
            if ($net <= 0) {
                continue;
            }
            $map[$orderKey][$skuKey] = [
                'net' => $net,
                'principal_qty' => (float) ($row->principal_qty ?? 0),
            ];
        }

        return $map;
    }

    /**
     * @param  iterable<int, InventoryOrderItem>  $orderItems
     */
    private function directOrderPurchaseCost(iterable $orderItems, array $batchCostsByMasterId, bool $shopPurchaseCostOnly = false): float
    {
        $total = 0.0;
        foreach ($orderItems as $item) {
            $qty = (float) ($item->quantity ?? 0);
            if ($qty <= 0) {
                continue;
            }
            $master = $item->sku?->offer?->masterProduct;
            $unit = $shopPurchaseCostOnly
                ? $this->resolveShopPurchaseUnitCost($master, $batchCostsByMasterId)
                : $this->resolveEffectiveUnitCost($master, $item->sku, $batchCostsByMasterId);
            $total += $qty * $unit;
        }

        return $total;
    }

    private function isOrderCancelledForProfit(InventoryOrder $order): bool
    {
        $status = strtolower((string) ($order->status ?? ''));
        $financial = strtolower((string) ($order->financial_status ?? ''));

        return $status === 'cancelled' || $financial === 'cancelled';
    }
}
