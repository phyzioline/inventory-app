<?php

namespace App\Application\Services;

use Carbon\Carbon;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use App\Application\Support\ChannelQuery;
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
        $this->applySettlementTransactionDateFilter($query, $filters);

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
     * @param  \Illuminate\Database\Eloquent\Builder<SettlementItem>  $query
     */
    private function applySettlementTransactionDateFilter($query, array $filters): void
    {
        if (empty($filters['start_date']) || empty($filters['end_date'])) {
            return;
        }
        [$startAt, $endAt] = $this->normalizeRange((string) $filters['start_date'], (string) $filters['end_date']);
        $query->whereBetween('transaction_date', [$startAt, $endAt]);
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
    private function settlementPlatformOrderNetMap(array $filters): array
    {
        $c = static fn (int $n) => \App\Infrastructure\Support\DatabaseSql::asciiChar($n);
        $oidNormSql = "REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(platform_order_id,'')), {$c(34)}, ''), {$c(39)}, ''), ' ', ''), {$c(9)}, ''), {$c(13)}, '')";

        $netQuery = SettlementItem::query()
            ->whereIn('settlement_id', $this->settlementIdsSubquery($filters))
            ->whereNotNull('platform_order_id')
            ->where('platform_order_id', '!=', '');

        $this->applyReleasedSettlementItemScope($netQuery);
        $this->applySettlementTransactionDateFilter($netQuery, $filters);

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

        $orderReturnMap = InventoryReturn::whereIn('inventory_order_id', $orderIds)
            ->whereNotNull('refund_amount')
            ->where('refund_amount', '>', 0)
            ->select('inventory_order_id', DB::raw('SUM(refund_amount) as refund_total'))
            ->groupBy('inventory_order_id')
            ->pluck('refund_total', 'inventory_order_id');

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

        $masterIdsForBatch = $skuModels->pluck('offer.masterProduct.id')->filter()->unique()->values()->all();
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
            if ($orderNet !== null && $orderNet <= 0) {
                continue;
            }

            $orderRevenue = (float) ($orderRevenueMap[$line->order_id] ?? 0);
            // Negative settlement lines (fees): only allocate when we are NOT using full order settlement net as revenue.
            $orderCosts = (float) ($settlementCostMap[$line->order_id] ?? 0);
            $lineRevenueList = (float) $line->revenue;
            $lineQty = (float) $line->quantity_sold;
            $skuMeta = $skuMetaMap[$line->sku_id] ?? null;
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

            if ($orderNet !== null && $orderNet > 0 && $orderSkuMap !== [] && $representativeItem) {
                $skuEconomics = $this->settlementAwareLineEconomics(
                    $representativeItem,
                    $lineQty,
                    $unitCost,
                    $orderItems,
                    $orderSkuMap,
                    $skuModels[$line->sku_id] ?? null
                );
                $lineRevenueEffective = $skuEconomics['revenue'];
                $lineCogs = $skuEconomics['cogs'];
                $allocatedCosts = 0.0;
            } elseif ($orderNet !== null && $orderNet > 0) {
                $lineRevenueEffective = $orderRevenue > 0
                    ? ($lineRevenueList / $orderRevenue) * $orderNet
                    : 0.0;
                $allocatedCosts = 0.0;
            } else {
                $lineRevenueEffective = $lineRevenueList;
                $allocatedCosts = $orderRevenue > 0 ? ($lineRevenueList / $orderRevenue) * $orderCosts : 0.0;
            }

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

        $summaryMasterIds = $ordersCollection->flatMap(function ($order) {
            return $order->items->map(fn ($i) => $i->sku?->offer?->masterProduct?->id);
        })->filter()->unique()->values()->all();

        $batchCostsForSummary = $this->averagePurchaseUnitCostByMasterProductIds($summaryMasterIds);
        $platformNetMap = $this->settlementPlatformOrderNetMap($filters);
        $platformSkuNetMap = $this->settlementPlatformOrderSkuNetMap($filters);

        $orderIds = $ordersCollection->pluck('id')->all();
        $refundsByOrderId = InventoryReturn::whereIn('inventory_order_id', $orderIds)
            ->whereNotNull('refund_amount')
            ->selectRaw('inventory_order_id, SUM(refund_amount) as total')
            ->groupBy('inventory_order_id')
            ->pluck('total', 'inventory_order_id');

        $platformOrderIds = $ordersCollection->pluck('platform_order_id')->filter()->unique()->values()->all();
        $negativeFees = $this->settlementNegativeFeesForOrders($orderIds, $platformOrderIds, $filters);

        $displayRevenue = 0.0;
        $totalCogs = 0.0;
        $totalRefunds = 0.0;
        $orderProfitSum = 0.0;

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

            $orderRefunds = (float) ($refundsByOrderId[$order->id] ?? 0.0);

            $orderNet = $this->lookupOrderSettlementNet($order->platform_order_id, $platformNetMap);

            if ($orderNet !== null && $orderNet > 0) {
                $displayRevenue += $orderNet;
                $orderProfitSum += $orderNet - $orderCogs - $orderRefunds;
            } else {
                $feeDeductions = ($negativeFees['by_order_id'][(int) $order->id] ?? 0.0)
                    + ($negativeFees['by_platform_id'][$order->platform_order_id] ?? 0.0);
                $displayRevenue += $listSum;
                $orderProfitSum += $listSum - $orderCogs - $orderRefunds - $feeDeductions;
            }

            $totalCogs += $orderCogs;
            $totalRefunds += $orderRefunds;
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
        ];
    }

    /**
     * Aggregated metrics for ROI / capital-cycle screens (no full order or purchase list load).
     *
     * @return array<string, float|array<string, float>>
     */
    public function getRoiMetrics(array $filters = []): array
    {
        $totalCapital = (float) CapitalSource::query()->sum('amount');

        $ordersQuery = InventoryOrder::query()
            ->whereIn('status', ['completed', 'processing', 'shipped', 'sold', 'delivered'])
            ->where(function ($q) {
                $q->whereNull('financial_status')
                    ->orWhere('financial_status', '<>', 'cancelled');
            });
        if (Auth::check()) {
            $ordersQuery->where('user_id', Auth::id());
        }
        if (! empty($filters['start_date']) && ! empty($filters['end_date'])) {
            [$startAt, $endAt] = $this->normalizeRange((string) $filters['start_date'], (string) $filters['end_date']);
            $ordersQuery->whereBetween('order_date', [$startAt, $endAt]);
        }
        $totalSales = (float) $ordersQuery->sum('total_amount');

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

        $expensesQuery = Expense::query();
        if (! empty($filters['start_date']) && ! empty($filters['end_date'])) {
            [$startAt, $endAt] = $this->normalizeRange((string) $filters['start_date'], (string) $filters['end_date']);
            $expensesQuery->whereBetween('expense_date', [
                Carbon::parse($startAt)->toDateString(),
                Carbon::parse($endAt)->toDateString(),
            ]);
        }
        $totalExpensesAmt = (float) $expensesQuery->sum('amount');

        $lossesQuery = InventoryAdjustment::query();
        if (! empty($filters['start_date']) && ! empty($filters['end_date'])) {
            [$startAt, $endAt] = $this->normalizeRange((string) $filters['start_date'], (string) $filters['end_date']);
            $lossesQuery->whereBetween('created_at', [$startAt, $endAt]);
        }
        $totalLosses = (float) $lossesQuery->sum('total_loss_amount');

        $refundsQuery = InventoryReturn::query()
            ->whereNotNull('refund_amount')
            ->where('refund_amount', '>', 0);
        if (! empty($filters['start_date']) && ! empty($filters['end_date'])) {
            [$startAt, $endAt] = $this->normalizeRange((string) $filters['start_date'], (string) $filters['end_date']);
            $refundsQuery->whereBetween('return_date', [
                Carbon::parse($startAt)->toDateString(),
                Carbon::parse($endAt)->toDateString(),
            ]);
        }
        $totalRefunds = (float) $refundsQuery->sum('refund_amount');

        $netProfit = $totalSales - $totalPurchases - $totalExpensesAmt - $totalLosses - $totalRefunds;
        $roi = $totalCapital > 0 ? ($netProfit / $totalCapital) * 100 : 0.0;
        $grossMargin = $totalSales > 0 ? (($totalSales - $totalPurchases) / $totalSales) * 100 : 0.0;
        $netMargin = $totalSales > 0 ? ($netProfit / $totalSales) * 100 : 0.0;
        $rotationDays = $totalSales > 0 ? (int) round(($totalPurchases / $totalSales) * 365) : 0;

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
            'total_sales' => round($totalSales, 2),
            'total_purchases' => round($totalPurchases, 2),
            'total_expenses' => round($totalExpensesAmt, 2),
            'total_losses' => round($totalLosses, 2),
            'total_refunds' => round($totalRefunds, 2),
            'net_profit' => round($netProfit, 2),
            'roi' => round($roi, 2),
            'gross_margin' => round($grossMargin, 2),
            'net_margin' => round($netMargin, 2),
            'rotation_days' => $rotationDays,
            'purchased_inventory' => round($totalPurchases, 2),
            'cash_in_hand' => round($totalCapital - $totalPurchases + $totalSales - $totalExpensesAmt, 2),
            'expenses_by_category' => $expensesByCategory,
        ];
    }

    /**
     * Cash-based period profit: all receipts (receipt_date) − COGS for receipt-linked SKUs − expenses (expense_date).
     * COGS uses master-product purchase cost × qty for SKUs tied to receipt-linked orders/settlements (not every order line in the period).
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
            if ($refType === InventoryOrder::class) {
                $directOrderIds[$refId] = true;
                $receiptAmountByOrderId[$refId] = ($receiptAmountByOrderId[$refId] ?? 0.0) + $amount;
            } elseif ($refType === Settlement::class) {
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
            'net_profit' => $netProfit,
            'receipt_count' => $receipts->count(),
            'linked_order_count' => $linkedOrderCount,
            'linked_unit_qty' => round($linkedUnitQty, 2),
            'cogs_to_receipts_pct' => $cogsToReceiptsPct,
            'unlinked_receipt_count' => $receipts->filter(function ($r) {
                $type = (string) ($r->reference_type ?? '');

                return $type !== InventoryOrder::class && $type !== Settlement::class;
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
