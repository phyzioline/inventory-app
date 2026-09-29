<?php

namespace App\Presentation\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use App\Domain\Models\Wms\Channel;
use App\Domain\Models\Wms\InventoryLocation;
use App\Domain\Models\Wms\InventoryOrder;
use App\Domain\Models\Wms\Receipt;
use App\Domain\Models\Wms\Settlement;
use App\Domain\Models\Wms\SettlementItem;

class SettlementController extends Controller
{
    protected \App\Application\Services\SettlementService $service;

    public function __construct(\App\Application\Services\SettlementService $service)
    {
        $this->service = $service;
    }

    private function sqlCharFn(): string
    {
        // MySQL: CHAR(n) returns ASCII char; Postgres uses CHR(n).
        return DB::getDriverName() === 'pgsql' ? 'CHR' : 'CHAR';
    }

    /**
     * Display a listing of the resource.
     */
    public function index()
    {
        // Cycle period newest-first so operators can spot missing sheets in the date sequence.
        $query = Settlement::with(['channel'])
            ->orderByDesc('end_date')
            ->orderByDesc('start_date')
            ->orderByDesc('id');

        $channelIds = $this->parseChannelIdsFromRequest(request());
        if (! empty($channelIds)) {
            $query->whereIn('channel_id', $channelIds);
        } elseif (request()->filled('channel_id')) {
            $query->where('channel_id', (int) request('channel_id'));
        }

        if (request()->filled('search')) {
            $search = trim((string) request('search'));
            $this->applySearchToSettlementQuery($query, $search);
        }

        $this->applySettlementPeriodFilter($query, request());

        $perPage = min(500, max(1, (int) request()->input('per_page', 50)));

        $settlements = $query->paginate($perPage);

        return response()->json($settlements);
    }

    /**
     * Financial summary across settlement items (+ period collections incl. shop cash).
     */
    public function summary(Request $request)
    {
        $settlementQuery = Settlement::query()->select('id');

        $channelIds = $this->parseChannelIdsFromRequest($request);
        if (! empty($channelIds)) {
            $settlementQuery->whereIn('channel_id', $channelIds);
        } elseif ($request->filled('channel_id')) {
            $settlementQuery->where('channel_id', (int) $request->input('channel_id'));
        }

        if ($request->filled('search')) {
            $search = trim((string) $request->input('search'));
            $this->applySearchToSettlementQuery($settlementQuery, $search);
        }

        $this->applySettlementPeriodFilter($settlementQuery, $request);

        $itemsQuery = SettlementItem::query()
            ->whereIn('settlement_id', $settlementQuery);

        // Prefer transaction_date when filtering a period; fall back to all lines of in-range settlements.
        if ($request->filled('start_date') && $request->filled('end_date')) {
            $startAt = \Carbon\Carbon::parse((string) $request->input('start_date'))->startOfDay();
            $endAt = \Carbon\Carbon::parse((string) $request->input('end_date'))->endOfDay();
            $itemsQuery->where(function ($q) use ($startAt, $endAt) {
                $q->whereBetween('transaction_date', [$startAt, $endAt])
                    ->orWhereNull('transaction_date');
            });
        }

        $items = $itemsQuery->get([
            'transaction_type', 'transaction_status', 'description', 'amount', 'fee_amount', 'raw_data', 'line_kind',
        ]);

        $summary = [
            'total_revenue' => 0.0,
            'total_fees' => 0.0,
            'amazon_fees' => 0.0,
            'platform_fees' => 0.0,
            'shipping_fees' => 0.0,
            'advertising_fees' => 0.0,
            'total_refunds' => 0.0,
            'pending_money' => 0.0,
            'net_profit' => 0.0,
            'order_count' => 0,
            'refund_count' => 0,
            'fee_count' => 0,
            'settlements_count' => (clone $settlementQuery)->count(),
            'period' => [
                'start_date' => $request->input('start_date'),
                'end_date' => $request->input('end_date'),
            ],
            'collections' => $this->buildPeriodCollections($request),
        ];

        $classifier = app(\App\Application\Services\SettlementLineClassifier::class);

        foreach ($items as $item) {
            $amount = (float) ($item->amount ?? 0);
            $feeAmount = (float) ($item->fee_amount ?? 0);
            $lineKind = (string) ($item->line_kind ?? '');
            if ($lineKind === '') {
                $lineKind = $classifier->classify([
                    'transaction_type' => $item->transaction_type,
                    'description' => $item->description,
                    'transaction_status' => $item->transaction_status,
                    'amount' => $amount,
                    'fee_amount' => $feeAmount,
                    'raw_data' => $item->raw_data,
                ]);
            }

            $bucket = $classifier->summaryBucket($lineKind);
            $value = abs($feeAmount !== 0.0 && in_array($bucket, ['shipping_fee', 'platform_fee', 'advertising'], true)
                ? $feeAmount
                : $amount);

            if ($bucket === 'pending') {
                $summary['pending_money'] += abs($amount);

                continue;
            }

            if ($bucket === 'revenue') {
                $summary['total_revenue'] += abs($amount);
                $summary['order_count']++;

                continue;
            }

            if ($bucket === 'refund') {
                $summary['total_refunds'] += abs($amount);
                $summary['refund_count']++;

                continue;
            }

            if ($bucket === 'shipping_fee') {
                $summary['shipping_fees'] += $value;
                $summary['total_fees'] += $value;
                $summary['fee_count']++;

                continue;
            }

            if ($bucket === 'advertising') {
                $summary['advertising_fees'] += $value;
                $summary['total_fees'] += $value;
                $summary['platform_fees'] += $value;
                $summary['amazon_fees'] += $value;
                $summary['fee_count']++;

                continue;
            }

            if ($bucket === 'disbursal') {
                continue;
            }

            $summary['platform_fees'] += $value;
            $summary['amazon_fees'] += $value;
            $summary['total_fees'] += $value;
            $summary['fee_count']++;
        }

        $summary['net_profit'] = $summary['total_revenue'] - $summary['total_fees'] - $summary['total_refunds'];

        return response()->json($summary);
    }

    /**
     * Money actually received in the period (treasury receipts), by source — includes shop cash.
     *
     * @return array{
     *   total_received: float,
     *   marketplace: float,
     *   shop_cash: float,
     *   other: float,
     *   by_source: list<array{key: string, label: string, amount: float}>
     * }
     */
    private function buildPeriodCollections(Request $request): array
    {
        $empty = [
            'total_received' => 0.0,
            'marketplace' => 0.0,
            'shop_cash' => 0.0,
            'other' => 0.0,
            'by_source' => [],
        ];

        if (! $request->filled('start_date') || ! $request->filled('end_date')) {
            return $empty;
        }

        $startDay = \Carbon\Carbon::parse((string) $request->input('start_date'))->toDateString();
        $endDay = \Carbon\Carbon::parse((string) $request->input('end_date'))->toDateString();

        $receipts = Receipt::query()
            ->whereDate('receipt_date', '>=', $startDay)
            ->whereDate('receipt_date', '<=', $endDay)
            ->get(['id', 'amount', 'category', 'payment_method', 'reference_type', 'reference_id', 'description']);

        $settlementRefTypes = \App\Infrastructure\Support\InventoryMorphTypes::settlementReferenceTypes();
        $orderRefTypes = \App\Infrastructure\Support\InventoryMorphTypes::inventoryOrderReferenceTypes();

        $settlementIds = [];
        $orderIds = [];
        foreach ($receipts as $r) {
            $refType = (string) ($r->reference_type ?? '');
            $refId = (int) ($r->reference_id ?? 0);
            if ($refId <= 0) {
                continue;
            }
            if (in_array($refType, $settlementRefTypes, true)) {
                $settlementIds[$refId] = true;
            } elseif (in_array($refType, $orderRefTypes, true)) {
                $orderIds[$refId] = true;
            }
        }

        $settlementChannel = [];
        if ($settlementIds !== []) {
            $settlementChannel = Settlement::query()
                ->with('channel:id,name,slug,type')
                ->whereIn('id', array_keys($settlementIds))
                ->get(['id', 'channel_id'])
                ->keyBy('id');
        }

        $orderChannel = [];
        if ($orderIds !== []) {
            $orderChannel = InventoryOrder::query()
                ->with('channel:id,name,slug,type')
                ->whereIn('id', array_keys($orderIds))
                ->get(['id', 'channel_id'])
                ->keyBy('id');
        }

        $bySource = [];
        $marketplace = 0.0;
        $shopCash = 0.0;
        $other = 0.0;

        foreach ($receipts as $r) {
            $amount = (float) ($r->amount ?? 0);
            if ($amount <= 0) {
                continue;
            }

            $category = strtolower(trim((string) ($r->category ?? '')));
            $method = strtolower(trim((string) ($r->payment_method ?? '')));
            $refType = (string) ($r->reference_type ?? '');
            $refId = (int) ($r->reference_id ?? 0);

            $sourceKey = 'other';
            $sourceLabel = 'أخرى / Other';

            if (in_array($refType, $settlementRefTypes, true) || $category === 'channel_collection') {
                $marketplace += $amount;
                $ch = $settlementChannel[$refId]?->channel ?? null;
                $name = trim((string) ($ch?->name ?? ''));
                $sourceKey = 'mkt:'.($ch?->id ?: 'unknown');
                $sourceLabel = $name !== '' ? $name : 'منصة / Marketplace';
            } elseif (
                $category === 'customer_collection'
                || in_array($method, ['cash', ''], true)
                || in_array($refType, $orderRefTypes, true)
            ) {
                $ch = $orderChannel[$refId]?->channel ?? null;
                $type = strtolower(trim((string) ($ch?->type ?? '')));
                $hay = strtolower(trim((string) ($ch?->name ?? '').' '.($ch?->slug ?? '')));
                $isShop = in_array($type, ['pos', 'store', 'shop'], true)
                    || str_contains($hay, 'محل')
                    || str_contains($hay, 'shop')
                    || str_contains($hay, 'store')
                    || $category === 'customer_collection';

                if ($isShop || $method === 'cash') {
                    $shopCash += $amount;
                    $sourceKey = 'shop';
                    $sourceLabel = 'كاش المحل / Shop cash';
                } else {
                    $marketplace += $amount;
                    $name = trim((string) ($ch?->name ?? ''));
                    $sourceKey = 'mkt:'.($ch?->id ?: 'order');
                    $sourceLabel = $name !== '' ? $name : 'طلبات / Orders';
                }
            } else {
                $other += $amount;
            }

            if (! isset($bySource[$sourceKey])) {
                $bySource[$sourceKey] = [
                    'key' => $sourceKey,
                    'label' => $sourceLabel,
                    'amount' => 0.0,
                ];
            }
            $bySource[$sourceKey]['amount'] += $amount;
        }

        $sorted = array_values($bySource);
        usort($sorted, fn ($a, $b) => $b['amount'] <=> $a['amount']);
        foreach ($sorted as &$row) {
            $row['amount'] = round((float) $row['amount'], 2);
        }
        unset($row);

        return [
            'total_received' => round($marketplace + $shopCash + $other, 2),
            'marketplace' => round($marketplace, 2),
            'shop_cash' => round($shopCash, 2),
            'other' => round($other, 2),
            'by_source' => $sorted,
        ];
    }

    /**
     * Filter settlements whose cycle overlaps [start_date, end_date].
     */
    private function applySettlementPeriodFilter($query, Request $request): void
    {
        if (! $request->filled('start_date') || ! $request->filled('end_date')) {
            return;
        }

        $start = \Carbon\Carbon::parse((string) $request->input('start_date'))->toDateString();
        $end = \Carbon\Carbon::parse((string) $request->input('end_date'))->toDateString();

        $query->where(function ($q) use ($start, $end) {
            $q->whereBetween('end_date', [$start, $end])
                ->orWhereBetween('start_date', [$start, $end])
                ->orWhere(function ($inner) use ($start, $end) {
                    $inner->where('start_date', '<=', $start)
                        ->where('end_date', '>=', $end);
                });
        });
    }

    private function applySearchToSettlementQuery($query, string $search): void
    {
        $normalized = trim((string) preg_replace('/\s+/', '', str_replace(["'", '"'], '', $search)));

        $query->where(function ($q) use ($search, $normalized) {
            $q->where('report_id', 'like', "%{$search}%")
                ->orWhere('merchant_identifier', 'like', "%{$search}%")
                ->orWhereHas('items', function ($itemQ) use ($search, $normalized) {
                    $itemQ->where('platform_order_id', 'like', "%{$search}%");
                    if ($normalized !== '') {
                        $itemQ->orWhereRaw(
                            "REPLACE(REPLACE(TRIM(platform_order_id), {$this->sqlCharFn()}(34), ''), {$this->sqlCharFn()}(39), '') like ?",
                            ["%{$normalized}%"]
                        );
                    }
                });
        });
    }

    /**
     * Match platform_order_id values from DB/XML to order keys used in the API and profit UI.
     */
    private function normalizeSettlementPlatformOrderId(?string $raw): string
    {
        $s = trim((string) ($raw ?? ''));
        $s = trim($s, "'\"");

        return (string) preg_replace('/\s+/u', '', $s);
    }

    private function parseChannelIdsFromRequest(Request $request): array
    {
        if (! $request->filled('channel_ids')) {
            return [];
        }

        $raw = $request->input('channel_ids');
        if (is_array($raw)) {
            $values = $raw;
        } else {
            $values = explode(',', (string) $raw);
        }

        return array_values(array_unique(array_filter(array_map(function ($value) {
            $id = (int) trim((string) $value);

            return $id > 0 ? $id : null;
        }, $values))));
    }

    private function extractNumericFromRaw(array $raw, array $keys): float
    {
        foreach ($keys as $key) {
            if (! array_key_exists($key, $raw)) {
                continue;
            }
            $value = $raw[$key];
            if ($value === null) {
                continue;
            }
            if (is_numeric($value)) {
                return (float) $value;
            }
            $normalized = str_replace([',', ' '], '', (string) $value);
            if (is_numeric($normalized)) {
                return (float) $normalized;
            }
        }

        return 0.0;
    }

    /**
     * Store a newly created resource in storage.
     */
    public function store(Request $request)
    {
        $validated = $request->validate([
            'channel_id' => 'required|exists:channels,id',
            'report_id' => 'nullable|string',
            'start_date' => 'required|date',
            'end_date' => 'required|date',
            'total_amount' => 'required|numeric',
        ]);

        if (empty($validated['report_id'])) {
            $validated['report_id'] = 'MANUAL-'.date('Ymd-His').'-'.substr(sha1((string) microtime(true)), 0, 8);
        }

        $settlement = Settlement::create($validated);

        return response()->json($settlement, 201);
    }

    /**
     * Import settlement from CSV.
     */
    public function import(Request $request)
    {
        $request->validate([
            'channel_id' => 'required|exists:channels,id',
            'file' => 'required|file|mimes:xml,csv,txt',
        ]);

        $file = $request->file('file');

        try {
            $payload = DB::transaction(function () use ($request, $file) {
                $stats = $this->service->importAmazonSettlement(
                    $request->channel_id,
                    $file->getRealPath()
                );

                $matchedOrders = 0;
                $reconciliation = null;
                if (! empty($stats['settlement_id'])) {
                    $settlementId = (int) $stats['settlement_id'];
                    $settlement = Settlement::find($settlementId);
                    if (! $settlement && Auth::check()) {
                        // Fallback for older rows (or edge-cases) where user_id was null,
                        // causing tenant isolation to hide the settlement.
                        $settlement = Settlement::withoutGlobalScopes()->find($settlementId);
                        if ($settlement && empty($settlement->user_id)) {
                            $settlement->user_id = Auth::id();
                            $settlement->save();
                        }
                    }
                    if ($settlement) {
                        $matchedOrders = $this->service->reconcile($settlement);
                        $this->upsertSettlementReceipt($settlement);
                        $reconciliation = $this->service->buildReconciliationSummary($settlement->fresh());
                    }
                }

                return [
                    'message' => 'Settlement imported successfully',
                    'stats' => $stats,
                    'new_lines' => (int) ($stats['new_lines'] ?? 0),
                    'updated_lines' => (int) ($stats['updated_lines'] ?? 0),
                    'skipped_duplicates' => (int) ($stats['skipped_duplicates'] ?? 0),
                    'matched_orders' => $matchedOrders,
                    'reconciliation' => $reconciliation ?? null,
                    'summary_message_ar' => $reconciliation['summary_message_ar'] ?? null,
                    'summary_message_en' => $reconciliation['summary_message_en'] ?? null,
                ];
            });

            return response()->json($payload);
        } catch (\Exception $e) {
            return response()->json(['message' => 'Import failed: '.$e->getMessage()], 500);
        }
    }

    /**
     * Reconcile settlement.
     */
    public function reconcile($id)
    {
        $settlement = Settlement::findOrFail($id);

        try {
            $payload = DB::transaction(function () use ($settlement) {
                $matched = $this->service->reconcile($settlement);
                $this->upsertSettlementReceipt($settlement);

                $summary = $this->service->buildReconciliationSummary($settlement->fresh());

                return array_merge([
                    'message' => 'Settlement reconciliation complete',
                    'matched_orders' => $matched,
                    'status' => $settlement->status,
                ], $summary);
            });

            return response()->json($payload);
        } catch (\Exception $e) {
            return response()->json(['message' => 'Reconciliation failed: '.$e->getMessage()], 500);
        }
    }

    /**
     * Create or update incoming receipt row for settled payout.
     * Uses morph reference (Settlement) to avoid duplicate receipts for same report.
     */
    private function upsertSettlementReceipt(Settlement $settlement): void
    {
        $settlement = $settlement->fresh() ?? $settlement;

        $amount = (float) ($settlement->total_amount ?? 0);
        if ($amount <= 0) {
            return;
        }

        $settlement->loadMissing('channel');
        $channelName = (string) ($settlement->channel->name ?? 'Channel');
        $reportId = (string) ($settlement->report_id ?? ('SET-'.$settlement->id));
        $date = $settlement->end_date ?: $settlement->start_date ?: now();
        $warehouseId = InventoryLocation::query()
            ->where('channel_id', (int) $settlement->channel_id)
            ->value('id');

        $payload = [
            'type' => 'settlement',
            'category' => 'channel_collection',
            'amount' => $amount,
            'description' => "Auto receipt from payment sheet settlement #{$reportId}",
            'receipt_date' => $date,
            'payment_method' => 'bank_transfer',
            'payer_name' => $channelName,
            'external_reference' => $reportId,
            'warehouse_id' => $warehouseId,
            'user_id' => $settlement->user_id ?: Auth::id(),
            'receipt_number' => 'SET-'.$settlement->id,
        ];

        // Match by morph only so a pre-linked manual receipt is upgraded instead of duplicating rows.
        Receipt::updateOrCreate(
            [
                'reference_type' => Settlement::class,
                'reference_id' => $settlement->id,
            ],
            $payload
        );
    }

    /**
     * Display the specified resource.
     */
    public function show($id)
    {
        $settlement = Settlement::with(['channel', 'items.inventoryOrder'])->findOrFail($id);

        return response()->json($settlement);
    }

    /**
     * Sum settlement line amounts (Amazon "الإجمالي" equivalents) per marketplace order id.
     * Includes all rows for the same order across sheets/dates (e.g. shipping fee + order amount).
     * Excludes deferred/pending/reversed lines so totals match cash received when issued.
     */
    public function orderNetTotals(Request $request)
    {
        $settlementIdsSub = Settlement::query()->select('id');

        $channelIds = $this->parseChannelIdsFromRequest($request);
        if (! empty($channelIds)) {
            $settlementIdsSub->whereIn('channel_id', $channelIds);
        } elseif ($request->filled('channel_id')) {
            $settlementIdsSub->where('channel_id', (int) $request->input('channel_id'));
        }

        // Group by normalized order id so keys match inventory orders after XML import
        // (trim, strip quotes, remove whitespace — same idea as the profit UI).
        $charFn = $this->sqlCharFn();
        $oidNormSql = "REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(platform_order_id,'')), {$charFn}(34), ''), {$charFn}(39), ''), ' ', ''), {$charFn}(9), ''), {$charFn}(13), '')";

        $netQuery = SettlementItem::query()
            ->whereIn('settlement_id', $settlementIdsSub)
            ->whereNotNull('platform_order_id')
            ->where('platform_order_id', '!=', '');

        if ($request->filled('start_date') && $request->filled('end_date')) {
            $startAt = \Carbon\Carbon::parse((string) $request->input('start_date'))->startOfDay();
            $endAt = \Carbon\Carbon::parse((string) $request->input('end_date'))->endOfDay();
            $netQuery->whereBetween('transaction_date', [$startAt, $endAt]);
        }

        $netQuery->where(function ($q) {
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

        $rows = $netQuery
            ->selectRaw("{$oidNormSql} as oid_key, SUM(CAST(amount AS DECIMAL(18,4))) as net_total")
            ->groupBy(DB::raw($oidNormSql))
            ->get();

        $byOrderId = [];
        foreach ($rows as $row) {
            $key = $this->normalizeSettlementPlatformOrderId((string) ($row->oid_key ?? ''));
            if ($key === '') {
                continue;
            }
            $byOrderId[$key] = (float) ($row->net_total ?? 0);
        }

        return response()->json(['by_order_id' => $byOrderId]);
    }

    /**
     * Settlement net + principal qty per marketplace order id and seller SKU.
     * Used by profit-by-period to allocate cash to invoice lines that match settlement SKUs only.
     */
    public function orderSkuNetTotals(Request $request)
    {
        $filters = $this->profitSettlementFiltersFromRequest($request);

        $byOrderId = app(\App\Application\Services\ProfitEngineService::class)
            ->settlementPlatformOrderSkuNetMap($filters);

        return response()->json(['by_order_id' => $byOrderId]);
    }

    /**
     * @return array<string, string>
     */
    private function profitSettlementFiltersFromRequest(Request $request): array
    {
        $filters = [];
        if ($request->filled('channel_id')) {
            $filters['channel'] = (string) $request->input('channel_id');
        }
        if ($request->filled('start_date')) {
            $filters['start_date'] = (string) $request->input('start_date');
        }
        if ($request->filled('end_date')) {
            $filters['end_date'] = (string) $request->input('end_date');
        }

        return $filters;
    }

    /**
     * Get all settlement transactions linked to an order id (across sheets/dates).
     */
    public function orderTransactions(Request $request)
    {
        $validated = $request->validate([
            'order_id' => 'required|string',
            'channel_id' => 'nullable|integer|exists:channels,id',
            'inventory_order_id' => 'nullable|integer|min:1',
        ]);

        $orderId = trim((string) $validated['order_id']);
        $internalOrderId = isset($validated['inventory_order_id']) ? (int) $validated['inventory_order_id'] : 0;
        if ($internalOrderId > 0 && ! InventoryOrder::query()->where('id', $internalOrderId)->where('user_id', Auth::id())->exists()) {
            $internalOrderId = 0;
        }

        $orderIdAlt = trim($orderId, " \t\n\r\0\x0B'\"");
        $orderIdCompact = preg_replace('/\s+/', '', $orderId);
        $candidates = array_values(array_unique(array_filter([$orderId, $orderIdAlt, $orderIdCompact])));
        foreach ($candidates as $c) {
            if (preg_match('/\b\d{3}-\d{7}-\d{7}\b/', (string) $c, $m)) {
                $candidates[] = $m[0];
            }
        }

        if ($internalOrderId > 0) {
            $inv = InventoryOrder::query()
                ->where('id', $internalOrderId)
                ->where('user_id', Auth::id())
                ->first();
            if ($inv) {
                $extra = trim((string) ($inv->platform_order_id ?? ''));
                if ($extra !== '' && $extra !== '#'.$inv->id) {
                    $candidates[] = $extra;
                    $extraCompact = preg_replace('/\s+/', '', $extra);
                    if ($extraCompact !== '') {
                        $candidates[] = $extraCompact;
                    }
                    if (preg_match('/\b\d{3}-\d{7}-\d{7}\b/', $extra, $m)) {
                        $candidates[] = $m[0];
                    }
                }
            }
        }

        $candidates = array_values(array_unique(array_filter($candidates)));

        $normalizedCandidates = array_values(array_unique(array_filter(array_map(
            fn ($value) => trim((string) preg_replace('/\s+/', '', str_replace(["'", '"'], '', (string) $value))),
            $candidates
        ))));

        $hasPlatformLookup = $candidates !== [] || $normalizedCandidates !== [];
        if ($internalOrderId <= 0 && ! $hasPlatformLookup) {
            return response()->json([
                'order_id' => $orderId,
                'inventory_order_id' => null,
                'count' => 0,
                'items' => [],
                'totals' => ['amount' => 0.0, 'fees' => 0.0, 'net' => 0.0],
            ]);
        }

        $query = SettlementItem::query()
            ->with(['settlement.channel'])
            ->where(function ($q) use ($candidates, $normalizedCandidates, $internalOrderId, $hasPlatformLookup) {
                if ($internalOrderId > 0) {
                    $q->where('inventory_order_id', $internalOrderId);
                }
                if ($hasPlatformLookup) {
                    $attach = $internalOrderId > 0 ? 'orWhere' : 'where';
                    $q->{$attach}(function ($qq) use ($candidates, $normalizedCandidates) {
                        if ($candidates !== []) {
                            $qq->whereIn('platform_order_id', $candidates);
                        }
                        $firstNorm = $candidates === [];
                        foreach ($normalizedCandidates as $normalized) {
                            if ($firstNorm) {
                                $qq->whereRaw(
                                    "REPLACE(REPLACE(TRIM(platform_order_id), {$this->sqlCharFn()}(34), ''), {$this->sqlCharFn()}(39), '') = ?",
                                    [$normalized]
                                );
                                $firstNorm = false;
                            } else {
                                $qq->orWhereRaw(
                                    "REPLACE(REPLACE(TRIM(platform_order_id), {$this->sqlCharFn()}(34), ''), {$this->sqlCharFn()}(39), '') = ?",
                                    [$normalized]
                                );
                            }
                        }
                    });
                }
            })
            ->orderBy('transaction_date')
            ->orderBy('id');

        // Restrict to settlements visible to this tenant (Settlement user scope). Optional channel filter for legacy callers.
        if (! empty($validated['channel_id'])) {
            $channelId = (int) $validated['channel_id'];
            $query->whereHas('settlement', function ($q) use ($channelId) {
                $q->where('channel_id', $channelId);
            });
        } else {
            $query->whereHas('settlement');
        }

        $items = $query->get()->unique('id')->values();

        return response()->json([
            'order_id' => $orderId,
            'inventory_order_id' => $internalOrderId > 0 ? $internalOrderId : null,
            'count' => $items->count(),
            'items' => $items,
            'totals' => [
                'amount' => (float) $items->sum(fn ($i) => (float) ($i->amount ?? 0)),
                'fees' => (float) $items->sum(fn ($i) => (float) ($i->fee_amount ?? 0)),
                'net' => (float) $items->sum(fn ($i) => (float) ($i->amount ?? 0)),
            ],
        ]);
    }

    /**
     * Delete a settlement + its accounting side-effects (auto receipt) safely.
     */
    public function destroy($id)
    {
        $settlement = Settlement::with(['items'])->findOrFail($id);
        $this->authorize('delete-settlement', $settlement);

        DB::beginTransaction();
        try {
            $affectedOrderIds = $settlement->items
                ->pluck('inventory_order_id')
                ->filter()
                ->unique()
                ->map(fn ($v) => (int) $v)
                ->filter(fn ($v) => $v > 0)
                ->values()
                ->all();

            // Delete the auto-created receipt linked by morph reference.
            Receipt::withoutGlobalScopes()
                ->where('reference_type', Settlement::class)
                ->where('reference_id', $settlement->id)
                ->delete();

            // Delete settlement items then settlement itself (keeps report_id unique clean).
            SettlementItem::withoutGlobalScopes()
                ->where('settlement_id', $settlement->id)
                ->delete();

            $settlement->delete();

            // Recompute affected order statuses based on remaining settlement_items across all sheets.
            foreach ($affectedOrderIds as $orderId) {
                $this->service->recomputeOrderFinancialStatuses((int) $orderId);
            }

            DB::commit();

            app(\App\Application\Services\InventoryAuditLogService::class)->record(
                'settlement.delete',
                Settlement::class,
                (int) $id,
                ['affected_orders' => count($affectedOrderIds)],
            );

            return response()->json([
                'message' => 'Settlement deleted successfully',
                'affected_orders' => count($affectedOrderIds),
            ]);
        } catch (\Throwable $e) {
            DB::rollBack();

            return response()->json([
                'message' => 'Failed to delete settlement',
                'error' => $e->getMessage(),
            ], 500);
        }
    }
}
