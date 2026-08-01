<?php

namespace App\Presentation\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Presentation\Http\Requests\TransferStockRequest;
use Illuminate\Database\QueryException;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use App\Domain\Models\Wms\InventoryLocation;
use App\Domain\Models\Wms\InventoryOrder;
use App\Domain\Models\Wms\InventoryTransaction;
use App\Domain\Models\Wms\PurchaseBatch;
use App\Domain\Models\Wms\PurchaseBatchItem;
use App\Domain\Models\Wms\Sku;
use App\Domain\Models\Wms\SkuInventory;
use App\Infrastructure\Support\StockUpdateBroadcaster;

class InventoryTransactionController extends Controller
{
    /**
     * Fetch (or create) a sku_inventory row and lock it for update.
     * Prevents race conditions when multiple transfers hit same SKU+location.
     * Merges legacy rows (user_id NULL) into the authenticated user's canonical row.
     */
    private function lockedInventoryRow(int $skuId, int $locationId): SkuInventory
    {
        $userId = auth()->id();

        if (! $userId) {
            $row = SkuInventory::withoutGlobalScope('user_isolation')
                ->where('sku_id', $skuId)
                ->where('location_id', $locationId)
                ->lockForUpdate()
                ->first();

            if ($row) {
                return $row;
            }

            return SkuInventory::withoutGlobalScope('user_isolation')->create([
                'sku_id' => $skuId,
                'location_id' => $locationId,
                'quantity' => 0,
                'reserved' => 0,
            ]);
        }

        $rows = SkuInventory::withoutGlobalScope('user_isolation')
            ->where('sku_id', $skuId)
            ->where('location_id', $locationId)
            ->where(function ($q) use ($userId) {
                $q->where('user_id', $userId)->orWhereNull('user_id');
            })
            ->orderBy('id')
            ->lockForUpdate()
            ->get();

        if ($rows->isEmpty()) {
            try {
                return SkuInventory::query()->create([
                    'sku_id' => $skuId,
                    'location_id' => $locationId,
                    'quantity' => 0,
                    'reserved' => 0,
                    'user_id' => $userId,
                ]);
            } catch (QueryException $e) {
                if (! $this->isUniqueConstraintViolation($e)) {
                    throw $e;
                }

                return SkuInventory::query()
                    ->where('sku_id', $skuId)
                    ->where('location_id', $locationId)
                    ->lockForUpdate()
                    ->firstOrFail();
            }
        }

        $canonical = $rows->first(fn (SkuInventory $r) => (int) $r->user_id === (int) $userId)
            ?? $rows->first();

        if ($canonical->user_id === null) {
            try {
                $canonical->forceFill(['user_id' => $userId])->save();
                $canonical->refresh();
            } catch (QueryException $e) {
                if (! $this->isUniqueConstraintViolation($e)) {
                    throw $e;
                }

                $canonical = SkuInventory::query()
                    ->where('sku_id', $skuId)
                    ->where('location_id', $locationId)
                    ->lockForUpdate()
                    ->firstOrFail();
            }
        }

        foreach ($rows as $row) {
            if ((int) $row->id === (int) $canonical->id) {
                continue;
            }

            $canonical->increment('quantity', (int) $row->quantity);
            $canonical->increment('reserved', (int) ($row->reserved ?? 0));
            $row->delete();
        }

        return $canonical->fresh() ?? $canonical;
    }

    private function isUniqueConstraintViolation(QueryException $e): bool
    {
        $code = (string) $e->getCode();
        $sqlState = $e->errorInfo[0] ?? '';

        return $code === '23505' || $sqlState === '23505' || str_contains(strtolower($e->getMessage()), 'unique');
    }

    /**
     * Broadcast stock updates without failing the HTTP response (transfer already committed).
     */
    private function safeBroadcastTransferPairs(array $pairs): void
    {
        try {
            StockUpdateBroadcaster::broadcastTransferPairs($pairs);
        } catch (\Throwable $e) {
            report($e);
        }
    }

    private function extractCrossSkuSuffix(?string $notes): string
    {
        $raw = (string) ($notes ?? '');
        $pos = strpos($raw, '[cross-SKU:');
        if ($pos === false) {
            return '';
        }

        return trim(substr($raw, $pos));
    }

    private function buildTransferNotes(string $direction, int $otherLocationId, ?string $userNotes, string $crossSuffix = '', ?int $sheetQty = null): string
    {
        $suffix = trim((string) ($userNotes ?? ''));
        $suffix = $suffix !== '' ? (' '.$suffix) : '';
        $cross = $crossSuffix !== '' ? (' '.trim($crossSuffix)) : '';
        $sheet = ($sheetQty !== null && $sheetQty >= 0) ? (' | SheetQty:'.$sheetQty.' |') : '';
        if ($direction === 'out') {
            return 'Transfer OUT to Location #'.$otherLocationId.'.'.$suffix.$sheet.$cross;
        }

        return 'Transfer IN from Location #'.$otherLocationId.'.'.$suffix.$sheet.$cross;
    }

    /**
     * Extract Amazon FBA shipment id from batch notes or fba:{id}:{msku} client ids.
     */
    private function extractFbaShipmentIdFromBatch(?string $userNotes, array $items): string
    {
        $notes = (string) ($userNotes ?? '');
        if (preg_match('/FBA\s+Shipment\s+([^|]+)/i', $notes, $m)) {
            return trim($m[1]);
        }

        foreach ($items as $row) {
            $clientId = trim((string) ($row['client_transfer_id'] ?? ''));
            if (preg_match('/^fba:([^:]+):/i', $clientId, $m)) {
                return trim($m[1]);
            }
        }

        return '';
    }

    /**
     * @return array{exists: bool, shipment_id?: string, transferred_at?: string|null, line_count?: int, total_units?: int}
     */
    private function findPriorFbaShipmentTransfer(string $shipmentId): array
    {
        $shipmentId = trim($shipmentId);
        if ($shipmentId === '') {
            return ['exists' => false];
        }

        $prefix = 'transfer_out:fba:'.$shipmentId.':';
        $base = InventoryTransaction::query()
            ->where('type', 'TRANSFER')
            ->where('reference_type', 'like', $prefix.'%');

        $lineCount = (clone $base)->count();
        if ($lineCount === 0) {
            return ['exists' => false, 'shipment_id' => $shipmentId];
        }

        $totalUnits = (int) (clone $base)->sum('quantity');
        $first = (clone $base)->orderBy('created_at')->first(['created_at']);

        return [
            'exists' => true,
            'shipment_id' => $shipmentId,
            'transferred_at' => $first?->created_at?->toIso8601String(),
            'line_count' => $lineCount,
            'total_units' => $totalUnits,
        ];
    }

    private function validateTransferConstraints(Sku $fromSku, Sku $toSku, InventoryLocation $fromLocation, InventoryLocation $toLocation)
    {
        if ($fromLocation->is_active === false || $toLocation->is_active === false) {
            return response()->json([
                'message' => 'Cannot transfer using inactive location.',
            ], 422);
        }

        if ($toSku->id !== $fromSku->id) {
            $fromMaster = (int) ($fromSku->offer?->master_product_id ?? 0);
            $toMaster = (int) ($toSku->offer?->master_product_id ?? 0);
            if ($fromMaster <= 0 || $toMaster <= 0 || $fromMaster !== $toMaster) {
                return response()->json([
                    'message' => 'Cross-SKU transfers require both listings to be linked to the same master product.',
                ], 422);
            }
        }

        $fromSkuChannelId = (int) ($fromSku->channel_id ?? 0);
        $toSkuChannelId = (int) ($toSku->channel_id ?? 0);
        $fromChannelId = (int) ($fromLocation->channel_id ?? 0);
        $toChannelId = (int) ($toLocation->channel_id ?? 0);

        if ($fromChannelId > 0 && $fromSkuChannelId > 0 && $fromChannelId !== $fromSkuChannelId) {
            return response()->json([
                'message' => 'Source location channel does not match SKU channel.',
            ], 422);
        }

        // Stock lands on the *destination* listing SKU — match location channel to that SKU (e.g. FBA listing).
        if ($toChannelId > 0) {
            if ($toSkuChannelId <= 0) {
                return response()->json([
                    'message' => 'Destination SKU must be linked to the destination channel before transferring into this location.',
                ], 422);
            }
            if ($toChannelId !== $toSkuChannelId) {
                return response()->json([
                    'message' => 'Destination location channel does not match destination SKU channel.',
                ], 422);
            }
        }

        return null;
    }

    /**
     * Display a listing of the resource.
     */
    public function index(Request $request)
    {
        $relations = ['sku', 'location'];
        $typeFilter = $request->has('type') ? strtoupper((string) $request->type) : null;
        if ($typeFilter === 'TRANSFER') {
            // Include both legs: OUT (type=TRANSFER) and matching IN receipts.
            $relations = ['sku.offer.masterProduct', 'sku.channel', 'location'];
        }

        $query = InventoryTransaction::with($relations);

        if ($request->has('sku_id')) {
            $query->where('sku_id', $request->sku_id);
        }
        if ($request->has('location_id')) {
            $query->where('location_id', $request->location_id);
        }
        if ($typeFilter === 'TRANSFER') {
            $query->where(function ($q) {
                $q->where('type', 'TRANSFER')
                    ->orWhere(function ($q2) {
                        $q2->where('type', 'IN')
                            ->where(function ($q3) {
                                $q3->where('notes', 'ilike', 'Transfer IN%')
                                    ->orWhere('reference_type', 'ilike', 'transfer_in%');
                            });
                    });
            });
        } elseif ($request->has('type')) {
            $query->where('type', $request->type);
        }

        $query->orderBy('created_at', 'desc');

        $page = max(0, (int) $request->query('page', 0));
        $paginate = $request->boolean('paginate', false) || $page > 0;
        $perPage = max(1, min((int) $request->query('per_page', 50), 200));

        if ($paginate) {
            $paginator = $query->paginate($perPage, ['*'], 'page', max(1, $page ?: 1));

            return response()->json([
                'data' => $paginator->items(),
                'current_page' => $paginator->currentPage(),
                'last_page' => $paginator->lastPage(),
                'per_page' => $paginator->perPage(),
                'total' => $paginator->total(),
            ]);
        }

        return response()->json($query->get());
    }

    /**
     * SKU movement tracker: warehouse transfers, sales, returns, imports — with from/to labels.
     *
     * - sku_id alone → that listing only (include_related defaults to false).
     * - sku_id + include_related=1 → sibling SKUs on the same offer (opt-in).
     * - master_product_id → every SKU under that master product.
     */
    public function skuTracker(Request $request)
    {
        $validated = $request->validate([
            'sku_id' => ['nullable', 'integer', Rule::exists('skus', 'id')->where('user_id', auth()->id())],
            'master_product_id' => ['nullable', 'integer', Rule::exists('master_products', 'id')->where('user_id', auth()->id())],
            'include_related' => 'nullable|boolean',
            'limit' => 'nullable|integer|min:1|max:2000',
        ]);

        if (empty($validated['sku_id']) && empty($validated['master_product_id'])) {
            return response()->json(['message' => 'Provide sku_id or master_product_id'], 422);
        }

        $masterProductId = ! empty($validated['master_product_id']) ? (int) $validated['master_product_id'] : null;
        $defaultLimit = $masterProductId ? 1000 : 500;
        $limit = (int) ($validated['limit'] ?? $defaultLimit);

        $skuIds = $this->resolveSkuTrackerSkuIds(
            ! empty($validated['sku_id']) ? (int) $validated['sku_id'] : null,
            $masterProductId,
            $request->boolean('include_related', false),
        );

        $relatedBatchIds = $masterProductId
            ? PurchaseBatchItem::query()
                ->where('master_product_id', $masterProductId)
                ->pluck('purchase_batch_id')
                ->map(fn ($id) => (int) $id)
                ->unique()
                ->values()
                ->all()
            : [];

        if ($skuIds === [] && $relatedBatchIds === []) {
            return response()->json([
                'sku_ids_resolved' => [],
                'movements' => [],
                'current_balances' => [],
                'total_count' => 0,
                'truncated' => false,
            ]);
        }

        $baseQuery = InventoryTransaction::query()
            ->where(function ($q) use ($skuIds, $relatedBatchIds) {
                $hasSkuFilter = $skuIds !== [];
                $hasBatchFilter = $relatedBatchIds !== [];

                if ($hasSkuFilter) {
                    $q->whereIn('sku_id', $skuIds);
                }
                if ($hasBatchFilter) {
                    $batchClause = function ($q2) use ($relatedBatchIds) {
                        $q2->where('reference_type', PurchaseBatch::class)
                            ->whereIn('reference_id', $relatedBatchIds);
                    };
                    $hasSkuFilter ? $q->orWhere($batchClause) : $q->where($batchClause);
                }
            });

        $totalCount = (clone $baseQuery)->count();

        $transactions = (clone $baseQuery)
            ->with([
                'sku.channel',
                'sku.offer.masterProduct',
                'location.channel',
            ])
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->limit($limit)
            ->get();

        $extraLocationIds = [];
        foreach ($transactions as $tx) {
            $notes = (string) ($tx->notes ?? '');
            if (preg_match('/Transfer OUT to Location #(\d+)/i', $notes, $m)) {
                $extraLocationIds[] = (int) $m[1];
            }
            if (preg_match('/Transfer IN from Location #(\d+)/i', $notes, $m)) {
                $extraLocationIds[] = (int) $m[1];
            }
        }
        $extraLocationIds = array_values(array_unique(array_filter($extraLocationIds)));
        $locationMap = [];
        if ($extraLocationIds !== []) {
            $locationMap = InventoryLocation::query()
                ->with('channel')
                ->whereIn('id', $extraLocationIds)
                ->get()
                ->keyBy('id');
        }

        $orderIds = [];
        $purchaseBatchIds = [];
        foreach ($transactions as $tx) {
            $rt = (string) ($tx->reference_type ?? '');
            $rid = (string) ($tx->reference_id ?? '');
            if ($rid === '') {
                continue;
            }
            if (in_array($rt, ['Order', 'ImportedOrder', 'OrderEdit'], true)) {
                $orderIds[] = (int) $rid;
            }
            if ($this->skuTrackerReferencesPurchaseBatch($rt)) {
                $purchaseBatchIds[] = (int) $rid;
            }
        }
        $orderIds = array_values(array_unique(array_filter($orderIds)));
        $purchaseBatchIds = array_values(array_unique(array_filter($purchaseBatchIds)));

        $ordersById = $orderIds === [] ? collect() : InventoryOrder::query()
            ->whereIn('id', $orderIds)
            ->get(['id', 'platform_order_id'])
            ->keyBy('id');

        $batchesById = $purchaseBatchIds === [] ? collect() : PurchaseBatch::query()
            ->with(['vendor:id,name', 'items:id,purchase_batch_id,sku_id,master_product_id,unit_price,raw_description'])
            ->whereIn('id', $purchaseBatchIds)
            ->get()
            ->keyBy('id');

        $movements = [];
        foreach ($transactions as $tx) {
            $movements[] = $this->formatSkuTrackerRow($tx, $locationMap, $ordersById, $batchesById);
        }

        $balanceSkuIds = array_values(array_unique(array_merge(
            $skuIds,
            $transactions->pluck('sku_id')->map(fn ($id) => (int) $id)->all(),
        )));

        $currentBalances = [];
        foreach ($balanceSkuIds as $sid) {
            $totalQty = SkuInventory::query()->where('sku_id', $sid)->sum('quantity');
            $sku = Sku::query()->select(['id', 'sku', 'channel_id'])->with('channel:id,name')->find($sid);
            $currentBalances[] = [
                'sku_id' => $sid,
                'sku_code' => (string) ($sku?->sku ?? ''),
                'channel_name' => $sku?->channel?->name,
                'current_quantity' => (int) $totalQty,
            ];
        }

        return response()->json([
            'sku_ids_resolved' => $skuIds,
            'movements' => $movements,
            'current_balances' => $currentBalances,
            'total_count' => $totalCount,
            'truncated' => $totalCount > $limit,
        ]);
    }

    /**
     * @return list<int>
     */
    private function resolveSkuTrackerSkuIds(?int $skuId, ?int $masterProductId, bool $includeRelated): array
    {
        if ($masterProductId) {
            $fromOffers = Sku::query()
                ->whereHas('offer', function ($q) use ($masterProductId) {
                    $q->where('master_product_id', $masterProductId);
                })
                ->pluck('id')
                ->map(fn ($id) => (int) $id)
                ->all();

            $fromPurchaseItems = PurchaseBatchItem::query()
                ->where('master_product_id', $masterProductId)
                ->whereNotNull('sku_id')
                ->pluck('sku_id')
                ->map(fn ($id) => (int) $id)
                ->all();

            return array_values(array_unique(array_merge($fromOffers, $fromPurchaseItems)));
        }

        if (! $skuId) {
            return [];
        }

        $skuIds = [$skuId];
        if ($includeRelated) {
            $sku = Sku::query()->select(['id', 'offer_id'])->find($skuId);
            if ($sku && $sku->offer_id) {
                $skuIds = Sku::query()
                    ->where('offer_id', $sku->offer_id)
                    ->pluck('id')
                    ->map(fn ($id) => (int) $id)
                    ->unique()
                    ->values()
                    ->all();
            }
        }

        return $skuIds;
    }

    private function skuTrackerReferencesPurchaseBatch(?string $refType): bool
    {
        $t = (string) ($refType ?? '');

        return str_contains($t, 'PurchaseBatch') || str_contains($t, 'Purchase');
    }

    private function formatSkuTrackerRow(InventoryTransaction $tx, $locationMap, $ordersById, $batchesById): array
    {
        $loc = $tx->relationLoaded('location') ? $tx->location : $tx->location()->with('channel')->first();
        $atLocation = $this->skuTrackerLocationPayload($loc);
        $notes = (string) ($tx->notes ?? '');
        $typeUpper = strtoupper((string) $tx->type);
        $fromLoc = null;
        $toLoc = null;

        if (($typeUpper === 'TRANSFER' || ($typeUpper === 'OUT' && str_contains($notes, 'Transfer OUT')))
            && preg_match('/Transfer OUT to Location #(\d+)/i', $notes, $m)) {
            $toId = (int) $m[1];
            $toLoc = $this->skuTrackerLocationFromMap($locationMap, $toId);
            $fromLoc = $atLocation;
        }
        if ($typeUpper === 'IN' && preg_match('/Transfer IN from Location #(\d+)/i', $notes, $m)) {
            $fromId = (int) $m[1];
            $fromLoc = $this->skuTrackerLocationFromMap($locationMap, $fromId);
            $toLoc = $atLocation;
        }

        $refType = (string) ($tx->reference_type ?? '');
        $refId = (string) ($tx->reference_id ?? '');
        $orderNumber = null;
        if ($refId !== '' && in_array($refType, ['Order', 'ImportedOrder', 'OrderEdit'], true)) {
            $order = $ordersById->get((int) $refId);
            $orderNumber = $order?->platform_order_id;
        }

        [$kind, $labelAr, $labelEn] = $this->skuTrackerClassify($refType, $typeUpper, $notes);

        $sku = $tx->relationLoaded('sku') ? $tx->sku : $tx->sku()->with(['channel', 'offer.masterProduct'])->first();
        $master = $sku?->offer?->masterProduct;

        $qty = (int) $tx->quantity;

        $purchaseUnitPrice = null;
        $purchaseSupplierName = null;
        $purchaseInvoiceNumber = null;
        if ($this->skuTrackerReferencesPurchaseBatch($refType) && $refId !== '' && $typeUpper === 'IN') {
            $batch = $batchesById->get((int) $refId);
            if ($batch) {
                $purchaseInvoiceNumber = (string) ($batch->invoice_number ?: $batch->batch_number ?: '');
                $purchaseSupplierName = (string) ($batch->vendor?->name ?: $batch->supplier_name_raw ?: '');
                $batchItem = $batch->items->first(
                    fn ($item) => (int) ($item->sku_id ?? 0) === (int) $tx->sku_id
                );
                if (! $batchItem && $master) {
                    $batchItem = $batch->items->first(
                        fn ($item) => (int) ($item->master_product_id ?? 0) === (int) $master->id
                    );
                }
                if ($batchItem) {
                    $purchaseUnitPrice = (float) ($batchItem->unit_price ?? 0);
                }
            }
        }

        return [
            'id' => (int) $tx->id,
            'created_at' => $tx->created_at?->toIso8601String(),
            'sku_id' => (int) $tx->sku_id,
            'sku_code' => (string) ($sku->sku ?? ''),
            'listing_channel' => $sku?->channel?->name,
            'master_product_id' => $master ? (int) $master->id : null,
            'master_product_name' => $master?->internal_name,
            'type' => (string) $tx->type,
            'movement_kind' => $kind,
            'quantity' => $qty,
            'at_location' => $atLocation,
            'from_location' => $fromLoc,
            'to_location' => $toLoc,
            'reference_type' => $refType !== '' ? $refType : null,
            'reference_id' => $refId !== '' ? $refId : null,
            'order_number' => $orderNumber,
            'purchase_unit_price' => $purchaseUnitPrice,
            'purchase_supplier_name' => $purchaseSupplierName !== '' ? $purchaseSupplierName : null,
            'purchase_invoice_number' => $purchaseInvoiceNumber !== '' ? $purchaseInvoiceNumber : null,
            'label_ar' => $labelAr,
            'label_en' => $labelEn,
            'notes' => $notes !== '' ? $notes : null,
            'summary_ar' => $this->skuTrackerSummaryAr(
                $kind,
                $qty,
                $fromLoc,
                $toLoc,
                $atLocation,
                $orderNumber,
                (string) ($sku->sku ?? ''),
                $purchaseUnitPrice,
                $purchaseSupplierName,
            ),
        ];
    }

    private function skuTrackerLocationPayload(?InventoryLocation $loc): ?array
    {
        if (! $loc) {
            return null;
        }
        $ch = $loc->relationLoaded('channel') ? $loc->channel : $loc->channel()->first();

        return [
            'id' => (int) $loc->id,
            'name' => (string) ($loc->name ?? ''),
            'channel_id' => $loc->channel_id ? (int) $loc->channel_id : null,
            'channel_name' => $ch?->name,
        ];
    }

    private function skuTrackerLocationFromMap($locationMap, int $id): ?array
    {
        $loc = $locationMap->get($id);
        if (! $loc) {
            $loc = InventoryLocation::query()->with('channel')->find($id);
        }

        return $this->skuTrackerLocationPayload($loc);
    }

    /**
     * @return array{0: string, 1: string, 2: string}
     */
    private function skuTrackerClassify(string $refType, string $typeUpper, string $notes): array
    {
        $rt = strtolower($refType);
        if (str_starts_with($rt, 'transfer_out') || ($typeUpper === 'TRANSFER' && str_contains($notes, 'Transfer OUT'))) {
            return ['transfer_out', 'تحويل صادر', 'Transfer out'];
        }
        if (str_starts_with($rt, 'transfer_in') || ($typeUpper === 'IN' && str_contains($notes, 'Transfer IN'))) {
            return ['transfer_in', 'تحويل وارد', 'Transfer in'];
        }
        if ($refType === 'ImportedOrder' && $typeUpper === 'OUT') {
            return ['import_sale', 'بيع (استيراد شيت)', 'Sale (imported order)'];
        }
        if (($refType === 'Order' || $refType === 'OrderEdit') && $typeUpper === 'OUT') {
            return ['sale', 'بيع', 'Sale'];
        }
        if ($refType === 'AutoTransferBeforeSale') {
            return ['auto_transfer', 'تحويل تلقائي قبل البيع', 'Auto-transfer before sale'];
        }
        if ($refType === 'Return' && $typeUpper === 'IN') {
            return ['return_in', 'مرتجع (إرجاع للمخزون)', 'Return (restock)'];
        }
        if ($this->skuTrackerReferencesPurchaseBatch($refType)) {
            if ($typeUpper === 'IN') {
                return ['purchase', 'استلام شراء', 'Purchase receipt'];
            }
            if ($typeUpper === 'OUT') {
                return ['out', 'صادر (تعديل شراء)', 'Purchase adjustment out'];
            }
        }
        if ($refType === 'Adjustment' || $typeUpper === 'SET') {
            return ['adjustment', 'تسوية / تعديل', 'Adjustment'];
        }
        if ($typeUpper === 'IN') {
            return ['in', 'وارد', 'Inbound'];
        }
        if ($typeUpper === 'OUT') {
            return ['out', 'صادر', 'Outbound'];
        }

        return ['other', 'حركة', 'Movement'];
    }

    private function skuTrackerSummaryAr(
        string $kind,
        int $qty,
        ?array $fromLoc,
        ?array $toLoc,
        ?array $atLoc,
        ?string $orderNumber,
        string $skuCode,
        ?float $purchaseUnitPrice = null,
        ?string $purchaseSupplierName = null,
    ): string {
        $fromName = $fromLoc['name'] ?? ($atLoc['name'] ?? '—');
        $toName = $toLoc['name'] ?? '—';
        if ($kind === 'transfer_out' || $kind === 'transfer_in') {
            return "{$qty} قطعة: من «{$fromName}» إلى «{$toName}» — SKU {$skuCode}";
        }
        if ($kind === 'sale' || $kind === 'import_sale') {
            $ord = $orderNumber ? "طلب {$orderNumber}" : 'طلب';

            return "خصم {$qty} من «{$fromName}» ({$ord}) — SKU {$skuCode}";
        }
        if ($kind === 'return_in') {
            return "إرجاع {$qty} إلى «".($toLoc['name'] ?? $atLoc['name'] ?? '—')."» — SKU {$skuCode}";
        }
        if ($kind === 'purchase' || $kind === 'in') {
            $pricePart = $purchaseUnitPrice !== null && $purchaseUnitPrice > 0
                ? ' بسعر '.number_format($purchaseUnitPrice, 2).' ج.م'
                : '';
            $supplierPart = $purchaseSupplierName
                ? " من «{$purchaseSupplierName}»"
                : '';

            return "إضافة {$qty} إلى «".($toLoc['name'] ?? $atLoc['name'] ?? '—')."»{$pricePart}{$supplierPart} — SKU {$skuCode}";
        }

        return "{$qty} قطعة — «".($atLoc['name'] ?? '—')."» — SKU {$skuCode}";
    }

    /**
     * Store a newly created resource in storage.
     * Handles stock adjustments, transfers, etc.
     */
    /**
     * Store a newly created resource in storage.
     * Handles stock adjustments, transfers, etc.
     */
    public function store(Request $request)
    {
        $validated = $request->validate([
            'sku_id' => 'required|exists:skus,id',
            'location_id' => 'required|exists:inventory_locations,id',
            'quantity' => 'required|integer',
            'type' => 'required|string|in:IN,OUT,TRANSFER,ADJUSTMENT,SET',
        ]);

        // Validate stock for OUT/TRANSFER
        if (in_array($validated['type'], ['OUT', 'TRANSFER'])) {
            $currentStock = SkuInventory::where('sku_id', $validated['sku_id'])
                ->where('location_id', $validated['location_id'])
                ->value('quantity') ?? 0;

            if ($currentStock < $validated['quantity']) {
                return response()->json([
                    'message' => 'Insufficient stock',
                    'current_stock' => $currentStock,
                    'requested' => $validated['quantity'],
                ], 422);
            }
        }

        DB::beginTransaction();
        try {
            $transaction = InventoryTransaction::create([
                'sku_id' => $validated['sku_id'],
                'location_id' => $validated['location_id'],
                'type' => $validated['type'],
                'quantity' => $validated['quantity'],
                'reference_type' => $request->reference_type,
                'reference_id' => $request->reference_id,
                'notes' => $request->notes,
            ]);

            // Update sku_inventory based on transaction type
            $inventory = SkuInventory::firstOrCreate(
                ['sku_id' => $validated['sku_id'], 'location_id' => $validated['location_id']],
                ['quantity' => 0]
            );

            if ($validated['type'] === 'SET') {
                $inventory->quantity = $validated['quantity'];
            } elseif (in_array($validated['type'], ['OUT', 'TRANSFER'])) { // Logic for single transaction TRANSFER is OUT
                $inventory->quantity -= $validated['quantity'];
            } else {
                $inventory->quantity += $validated['quantity'];
            }
            $inventory->save();

            DB::commit();

            return response()->json($transaction->load(['sku', 'location']), 201);
        } catch (\Exception $e) {
            DB::rollBack();
            report($e);

            return response()->json(['error' => $e->getMessage()], 500);
        }
    }

    /**
     * Transfer stock between locations
     */
    public function transfer(TransferStockRequest $request)
    {
        $validated = $request->validated();

        DB::beginTransaction();
        try {
            $fromSku = Sku::query()->with('offer')->findOrFail((int) $validated['sku_id']);
            $toSkuId = isset($validated['to_sku_id']) && (int) $validated['to_sku_id'] > 0
                ? (int) $validated['to_sku_id']
                : $fromSku->id;
            $toSku = $toSkuId === (int) $fromSku->id
                ? $fromSku
                : Sku::query()->with('offer')->findOrFail($toSkuId);

            if ($toSku->id !== $fromSku->id) {
                $fromMaster = (int) ($fromSku->offer?->master_product_id ?? 0);
                $toMaster = (int) ($toSku->offer?->master_product_id ?? 0);
                if ($fromMaster <= 0 || $toMaster <= 0 || $fromMaster !== $toMaster) {
                    return response()->json([
                        'message' => 'Cross-SKU transfers require both listings to be linked to the same master product.',
                    ], 422);
                }
            }

            $fromLocation = InventoryLocation::query()->findOrFail((int) $validated['from_location_id']);
            $toLocation = InventoryLocation::query()->findOrFail((int) $validated['to_location_id']);

            if ($fromLocation->is_active === false || $toLocation->is_active === false) {
                return response()->json([
                    'message' => 'Cannot transfer using inactive location.',
                ], 422);
            }

            $fromSkuChannelId = (int) ($fromSku->channel_id ?? 0);
            $toSkuChannelId = (int) ($toSku->channel_id ?? 0);
            $fromChannelId = (int) ($fromLocation->channel_id ?? 0);
            $toChannelId = (int) ($toLocation->channel_id ?? 0);

            if ($fromChannelId > 0 && $fromSkuChannelId > 0 && $fromChannelId !== $fromSkuChannelId) {
                return response()->json([
                    'message' => 'Source location channel does not match SKU channel.',
                ], 422);
            }

            // Stock lands on the *destination* listing SKU — match location channel to that SKU (e.g. FBA listing).
            if ($toChannelId > 0) {
                if ($toSkuChannelId <= 0) {
                    return response()->json([
                        'message' => 'Destination SKU must be linked to the destination channel before transferring into this location.',
                    ], 422);
                }
                if ($toChannelId !== $toSkuChannelId) {
                    return response()->json([
                        'message' => 'Destination location channel does not match destination SKU channel.',
                    ], 422);
                }
            }

            // 1. Check Source Stock (locked) — also acts as a mutex for idempotency.
            $sourceInventory = $this->lockedInventoryRow((int) $fromSku->id, (int) $validated['from_location_id']);

            $clientId = trim((string) ($validated['client_transfer_id'] ?? ''));
            if ($clientId !== '') {
                // If a prior transfer with the same client id exists, return it (do NOT apply again).
                $clientRefType = 'transfer_out:'.$clientId;
                $existingOut = InventoryTransaction::query()
                    ->where('type', 'TRANSFER')
                    ->where('reference_type', $clientRefType)
                    ->where('sku_id', (int) $fromSku->id)
                    ->where('location_id', (int) $validated['from_location_id'])
                    ->where('quantity', (int) $validated['quantity'])
                    ->lockForUpdate()
                    ->first();

                if ($existingOut) {
                    $existingIn = null;
                    if (! empty($existingOut->reference_id)) {
                        $existingIn = InventoryTransaction::query()->find((string) $existingOut->reference_id);
                    }
                    DB::commit();

                    return response()->json([
                        'message' => 'Transfer already processed',
                        'out_transaction' => $existingOut,
                        'in_transaction' => $existingIn,
                        'from_sku_id' => (int) $existingOut->sku_id,
                        'to_sku_id' => $existingIn ? (int) $existingIn->sku_id : null,
                        'idempotent' => true,
                    ], 200);
                }
            }

            if ((int) $sourceInventory->quantity < (int) $validated['quantity']) {
                return response()->json([
                    'message' => 'Insufficient stock at source location',
                    'current_stock' => $sourceInventory->quantity,
                    'requested' => $validated['quantity'],
                ], 422);
            }

            $crossSuffix = $toSku->id !== $fromSku->id
                ? (' [cross-SKU: '.$fromSku->id.' → '.$toSku->id.']')
                : '';
            $notesSuffix = trim((string) ($request->notes ?? ''));
            // Keep client id out of notes so Transfers UI can group multi-item transfers into a single batch.
            // Idempotency is tracked via reference_type when client_transfer_id is provided.
            $notesOut = 'Transfer OUT to Location #'.$validated['to_location_id'].'. '.$notesSuffix.$crossSuffix;
            $notesIn = 'Transfer IN from Location #'.$validated['from_location_id'].'. '.$notesSuffix.$crossSuffix;
            $refTypeOut = $clientId !== '' ? ('transfer_out:'.$clientId) : 'transfer_out';
            $refTypeIn = $clientId !== '' ? ('transfer_in:'.$clientId) : 'transfer_in';

            // Atomic decrement while row is locked.
            $sourceInventory->decrement('quantity', (int) $validated['quantity']);
            $sourceInventory->refresh();
            if ((int) $sourceInventory->quantity < 0) {
                throw new \RuntimeException('Source inventory became negative after transfer decrement.');
            }

            // 2. Create OUT Transaction (Source) — after decrement so balance_after is accurate.
            $outTx = InventoryTransaction::create([
                'sku_id' => $fromSku->id,
                'location_id' => $validated['from_location_id'],
                'type' => 'TRANSFER',
                'quantity' => $validated['quantity'],
                'balance_after' => (float) $sourceInventory->quantity,
                'notes' => $notesOut,
                'reference_type' => $refTypeOut,
                'reference_id' => null,
            ]);

            // Destination inventory (locked + atomic increment).
            $destInventory = $this->lockedInventoryRow((int) $toSku->id, (int) $validated['to_location_id']);
            $destInventory->increment('quantity', (int) $validated['quantity']);
            $destInventory->refresh();

            // 3. Create IN Transaction (Destination)
            $inTx = InventoryTransaction::create([
                'sku_id' => $toSku->id,
                'location_id' => $validated['to_location_id'],
                'type' => 'IN',
                'quantity' => $validated['quantity'],
                'balance_after' => (float) $destInventory->quantity,
                'notes' => $notesIn,
                'reference_type' => $refTypeIn,
                'reference_id' => $outTx->id,
            ]);

            // Update OUT transaction to link to IN
            $outTx->update(['reference_id' => $inTx->id]);

            DB::commit();

            $this->safeBroadcastTransferPairs([
                ['sku_id' => (int) $fromSku->id, 'location_id' => (int) $validated['from_location_id']],
                ['sku_id' => (int) $toSku->id, 'location_id' => (int) $validated['to_location_id']],
            ]);

            app(\App\Application\Services\InventoryAuditLogService::class)->record(
                'inventory.transfer',
                InventoryTransaction::class,
                (int) $outTx->id,
                [
                    'quantity' => (int) $validated['quantity'],
                    'from_location_id' => (int) $validated['from_location_id'],
                    'to_location_id' => (int) $validated['to_location_id'],
                    'from_sku_id' => (int) $fromSku->id,
                    'to_sku_id' => (int) $toSku->id,
                    'in_transaction_id' => (int) $inTx->id,
                ],
            );

            return response()->json([
                'message' => 'Transfer successful',
                'out_transaction' => $outTx,
                'in_transaction' => $inTx,
                'from_sku_id' => $fromSku->id,
                'to_sku_id' => $toSku->id,
            ], 201);

        } catch (\Exception $e) {
            DB::rollBack();
            report($e);

            return response()->json(['error' => $e->getMessage()], 500);
        }
    }

    /**
     * Batch transfer (atomic): either all rows apply or none.
     * Returns 422 with per-row issues when validation fails.
     */
    public function transferBatch(Request $request)
    {
        $validated = $request->validate([
            'from_location_id' => 'required|exists:inventory_locations,id',
            'to_location_id' => 'required|exists:inventory_locations,id|different:from_location_id',
            'notes' => 'nullable|string',
            'items' => 'required|array|min:1',
            'items.*.sku_id' => 'required|exists:skus,id',
            'items.*.to_sku_id' => 'nullable|exists:skus,id',
            'items.*.quantity' => 'required|integer|min:1',
            'items.*.file_quantity' => 'nullable|integer|min:0',
            'items.*.client_transfer_id' => 'nullable|string|max:80',
        ]);

        $fromLocation = InventoryLocation::query()->findOrFail((int) $validated['from_location_id']);
        $toLocation = InventoryLocation::query()->findOrFail((int) $validated['to_location_id']);

        DB::beginTransaction();
        try {
            $items = $validated['items'];
            $userNotes = $validated['notes'] ?? null;

            // 0) Resolve idempotent rows first (retry-safe) — do not require stock again for these.
            $alreadyProcessed = [];
            $toApply = [];
            foreach ($items as $idx => $row) {
                $clientId = trim((string) ($row['client_transfer_id'] ?? ''));
                if ($clientId === '') {
                    $toApply[] = ['idx' => $idx, 'row' => $row];

                    continue;
                }

                $clientRefType = 'transfer_out:'.$clientId;
                $existingOut = InventoryTransaction::query()
                    ->where('type', 'TRANSFER')
                    ->where('reference_type', $clientRefType)
                    ->where('sku_id', (int) $row['sku_id'])
                    ->where('location_id', (int) $validated['from_location_id'])
                    ->where('quantity', (int) $row['quantity'])
                    ->lockForUpdate()
                    ->first();

                if ($existingOut) {
                    $existingIn = null;
                    if (! empty($existingOut->reference_id)) {
                        $existingIn = InventoryTransaction::query()->find((string) $existingOut->reference_id);
                    }
                    $alreadyProcessed[] = [
                        'index' => $idx,
                        'idempotent' => true,
                        'out_transaction_id' => (string) $existingOut->id,
                        'in_transaction_id' => $existingIn ? (string) $existingIn->id : null,
                    ];

                    continue;
                }
                $toApply[] = ['idx' => $idx, 'row' => $row];
            }

            // Block re-upload of the same Amazon FBA shipment when new lines would be applied.
            if ($toApply !== []) {
                $shipmentId = $this->extractFbaShipmentIdFromBatch(is_string($userNotes) ? $userNotes : null, $items);
                if ($shipmentId !== '') {
                    $prior = $this->findPriorFbaShipmentTransfer($shipmentId);
                    if (! empty($prior['exists'])) {
                        DB::rollBack();
                        $when = $prior['transferred_at'] ?? null;
                        $units = $prior['total_units'] ?? 0;
                        $lines = $prior['line_count'] ?? 0;

                        return response()->json([
                            'message' => 'This FBA shipment was already transferred'
                                .($when ? (' on '.$when) : '')
                                .". Prior transfer: {$lines} line(s), {$units} unit(s)."
                                .' Re-uploading the same shipment is blocked to prevent double stock moves.',
                            'prior_transfer' => $prior,
                            'error' => 'fba_shipment_already_transferred',
                        ], 422);
                    }
                }
            }

            // 1) Validate per-row constraints + collect SKUs to load.
            $skuIds = [];
            foreach ($toApply as $x) {
                $row = $x['row'];
                $skuIds[] = (int) $row['sku_id'];
                if (! empty($row['to_sku_id'])) {
                    $skuIds[] = (int) $row['to_sku_id'];
                }
            }
            $skuIds = array_values(array_unique(array_filter($skuIds)));

            $skusById = Sku::query()
                ->with('offer')
                ->whereIn('id', $skuIds)
                ->get()
                ->keyBy('id');

            $rowIssues = [];
            foreach ($toApply as $x) {
                $idx = (int) $x['idx'];
                $row = $x['row'];

                $fromSku = $skusById->get((int) $row['sku_id']);
                $toSkuId = ! empty($row['to_sku_id']) ? (int) $row['to_sku_id'] : (int) $row['sku_id'];
                $toSku = $skusById->get($toSkuId);

                if (! $fromSku || ! $toSku) {
                    $rowIssues[] = [
                        'index' => $idx,
                        'message' => 'SKU not found for this transfer row.',
                    ];

                    continue;
                }

                $constraint = $this->validateTransferConstraints($fromSku, $toSku, $fromLocation, $toLocation);
                if ($constraint) {
                    $payload = $constraint->getData(true);
                    $rowIssues[] = [
                        'index' => $idx,
                        'message' => (string) ($payload['message'] ?? 'Invalid transfer constraints.'),
                    ];
                }
            }

            if (! empty($rowIssues)) {
                DB::rollBack();

                return response()->json([
                    'message' => 'One or more transfer rows are invalid.',
                    'issues' => $rowIssues,
                ], 422);
            }

            // 2) Stock check grouped by source SKU (locked).
            $requestedBySku = [];
            foreach ($toApply as $x) {
                $row = $x['row'];
                $sid = (int) $row['sku_id'];
                if (! isset($requestedBySku[$sid])) {
                    $requestedBySku[$sid] = 0;
                }
                $requestedBySku[$sid] += (int) $row['quantity'];
            }

            $insufficient = [];
            $lockedSource = [];
            foreach ($requestedBySku as $sid => $qty) {
                $inv = $this->lockedInventoryRow((int) $sid, (int) $validated['from_location_id']);
                $lockedSource[(int) $sid] = $inv;
                if ((int) $inv->quantity < (int) $qty) {
                    $insufficient[] = [
                        'sku_id' => (int) $sid,
                        'current_stock' => (int) $inv->quantity,
                        'requested' => (int) $qty,
                    ];
                }
            }
            if (! empty($insufficient)) {
                DB::rollBack();

                return response()->json([
                    'message' => 'Insufficient stock for one or more items',
                    'insufficient' => $insufficient,
                ], 422);
            }

            // 3) Apply all rows (still locked). We keep the per-row OUT lock anyway (safety for retries).
            $applied = [];
            foreach ($toApply as $x) {
                $idx = (int) $x['idx'];
                $row = $x['row'];
                $fromSku = $skusById->get((int) $row['sku_id']);
                $toSkuId = ! empty($row['to_sku_id']) ? (int) $row['to_sku_id'] : (int) $row['sku_id'];
                $toSku = $skusById->get($toSkuId);

                $qty = (int) $row['quantity'];
                $sheetQty = array_key_exists('file_quantity', $row) && $row['file_quantity'] !== null
                    ? (int) $row['file_quantity']
                    : null;
                $clientId = trim((string) ($row['client_transfer_id'] ?? ''));
                $crossSuffix = ($toSku && $fromSku && (int) $toSku->id !== (int) $fromSku->id)
                    ? ('[cross-SKU: '.$fromSku->id.' → '.$toSku->id.']')
                    : '';

                // Create OUT Transaction (Source)
                $notesOut = $this->buildTransferNotes('out', (int) $validated['to_location_id'], $userNotes, $crossSuffix, $sheetQty);
                $notesIn = $this->buildTransferNotes('in', (int) $validated['from_location_id'], $userNotes, $crossSuffix, $sheetQty);
                $refTypeOut = $clientId !== '' ? ('transfer_out:'.$clientId) : 'transfer_out';
                $refTypeIn = $clientId !== '' ? ('transfer_in:'.$clientId) : 'transfer_in';

                $outTx = InventoryTransaction::create([
                    'sku_id' => (int) $fromSku->id,
                    'location_id' => (int) $validated['from_location_id'],
                    'type' => 'TRANSFER',
                    'quantity' => $qty,
                    'notes' => $notesOut,
                    'reference_type' => $refTypeOut,
                    'reference_id' => null,
                ]);

                // Decrement from locked grouped inventory row (same sku+location).
                $srcInv = $lockedSource[(int) $fromSku->id] ?? $this->lockedInventoryRow((int) $fromSku->id, (int) $validated['from_location_id']);
                $srcInv->decrement('quantity', $qty);
                $srcInv->refresh();
                if ((int) $srcInv->quantity < 0) {
                    throw new \RuntimeException('Source inventory became negative after transfer decrement.');
                }

                // IN transaction + destination inventory increment
                $inTx = InventoryTransaction::create([
                    'sku_id' => (int) $toSku->id,
                    'location_id' => (int) $validated['to_location_id'],
                    'type' => 'IN',
                    'quantity' => $qty,
                    'notes' => $notesIn,
                    'reference_type' => $refTypeIn,
                    'reference_id' => (string) $outTx->id,
                ]);
                $outTx->update(['reference_id' => (string) $inTx->id]);

                $destInv = $this->lockedInventoryRow((int) $toSku->id, (int) $validated['to_location_id']);
                $destInv->increment('quantity', $qty);

                $applied[] = [
                    'index' => $idx,
                    'out_transaction_id' => (string) $outTx->id,
                    'in_transaction_id' => (string) $inTx->id,
                    'from_sku_id' => (int) $fromSku->id,
                    'to_sku_id' => (int) $toSku->id,
                    'quantity' => $qty,
                ];
            }

            DB::commit();

            $broadcastPairs = [];
            foreach ($applied as $row) {
                $broadcastPairs[] = ['sku_id' => (int) $row['from_sku_id'], 'location_id' => (int) $validated['from_location_id']];
                $broadcastPairs[] = ['sku_id' => (int) $row['to_sku_id'], 'location_id' => (int) $validated['to_location_id']];
            }
            $this->safeBroadcastTransferPairs($broadcastPairs);

            app(\App\Application\Services\InventoryAuditLogService::class)->record(
                'inventory.transfer_batch',
                null,
                null,
                [
                    'from_location_id' => (int) $validated['from_location_id'],
                    'to_location_id' => (int) $validated['to_location_id'],
                    'applied_count' => count($applied),
                ],
            );

            return response()->json([
                'message' => 'Batch transfer successful',
                'applied' => $applied,
                'already_processed' => $alreadyProcessed,
            ], 201);
        } catch (\Throwable $e) {
            DB::rollBack();
            report($e);

            return response()->json([
                'message' => 'Batch transfer failed',
                'error' => $e->getMessage(),
            ], 500);
        }
    }

    /**
     * Update an existing transfer pair (OUT transfer + linked IN).
     * Allows editing quantity + notes while keeping inventories consistent.
     */
    public function updateTransfer(Request $request, string $id)
    {
        $validated = $request->validate([
            'quantity' => 'nullable|integer|min:1',
            'notes' => 'nullable|string',
            'from_location_id' => 'nullable|exists:inventory_locations,id',
            'to_location_id' => 'nullable|exists:inventory_locations,id',
            'to_sku_id' => 'nullable|exists:skus,id',
        ]);

        DB::beginTransaction();
        try {
            $outTx = InventoryTransaction::with(['sku.offer', 'location'])->findOrFail($id);
            if ($outTx->type !== 'TRANSFER') {
                return response()->json(['message' => 'Only TRANSFER transactions can be edited via this endpoint.'], 422);
            }
            if (! $outTx->reference_id) {
                return response()->json(['message' => 'Transfer transaction is missing its paired IN reference.'], 422);
            }

            $inTx = InventoryTransaction::with(['sku.offer', 'location'])->findOrFail((string) $outTx->reference_id);

            // Current state
            $oldFromLocationId = (int) $outTx->location_id;
            $oldToLocationId = (int) $inTx->location_id;
            $fromSku = Sku::query()->with('offer')->findOrFail((int) $outTx->sku_id);
            $oldToSku = Sku::query()->with('offer')->findOrFail((int) $inTx->sku_id);

            $oldQty = (int) ($outTx->quantity ?? 0);
            $newQty = array_key_exists('quantity', $validated) ? (int) $validated['quantity'] : $oldQty;

            // New state (if provided)
            $newFromLocationId = array_key_exists('from_location_id', $validated) && $validated['from_location_id']
                ? (int) $validated['from_location_id']
                : $oldFromLocationId;
            $newToLocationId = array_key_exists('to_location_id', $validated) && $validated['to_location_id']
                ? (int) $validated['to_location_id']
                : $oldToLocationId;

            if ($newFromLocationId === $newToLocationId) {
                return response()->json(['message' => 'Destination location must be different from source location.'], 422);
            }

            $newToSkuId = array_key_exists('to_sku_id', $validated) && $validated['to_sku_id']
                ? (int) $validated['to_sku_id']
                : (int) $oldToSku->id;
            $newToSku = $newToSkuId === (int) $oldToSku->id
                ? $oldToSku
                : Sku::query()->with('offer')->findOrFail($newToSkuId);

            $oldFromLoc = InventoryLocation::query()->findOrFail($oldFromLocationId);
            $oldToLoc = InventoryLocation::query()->findOrFail($oldToLocationId);
            $newFromLoc = $newFromLocationId === $oldFromLocationId
                ? $oldFromLoc
                : InventoryLocation::query()->findOrFail($newFromLocationId);
            $newToLoc = $newToLocationId === $oldToLocationId
                ? $oldToLoc
                : InventoryLocation::query()->findOrFail($newToLocationId);

            // Validate constraints for the NEW desired state
            $constraintError = $this->validateTransferConstraints($fromSku, $newToSku, $newFromLoc, $newToLoc);
            if ($constraintError) {
                return $constraintError;
            }

            // If changing destination SKU, ensure same master product if cross-SKU
            // (validateTransferConstraints already covers that)

            // If changing locations or destination SKU, we will "rewind" the old transfer then apply the new one.
            $changingRoute = $newFromLocationId !== $oldFromLocationId || $newToLocationId !== $oldToLocationId || $newToSku->id !== $oldToSku->id;

            if ($changingRoute) {
                // Rewind old transfer: add back to old source, subtract from old destination.
                $oldSourceInv = $this->lockedInventoryRow((int) $fromSku->id, (int) $oldFromLocationId);
                $oldDestInv = $this->lockedInventoryRow((int) $oldToSku->id, (int) $oldToLocationId);
                if ((int) $oldDestInv->quantity < (int) $oldQty) {
                    return response()->json([
                        'message' => 'Cannot change transfer destination/source/SKU because part of the transferred stock was already consumed at the current destination.',
                        'destination_current_stock' => (int) $oldDestInv->quantity,
                        'required_to_rewind' => $oldQty,
                    ], 422);
                }
                // Atomic rewind
                $oldSourceInv->increment('quantity', (int) $oldQty);
                $oldDestInv->decrement('quantity', (int) $oldQty);
                $oldDestInv->refresh();
                if ((int) $oldDestInv->quantity < 0) {
                    throw new \RuntimeException('Destination inventory became negative while rewinding transfer.');
                }

                // Apply new transfer: subtract from new source, add to new destination.
                $newSourceInv = $this->lockedInventoryRow((int) $fromSku->id, (int) $newFromLocationId);
                if ((int) $newSourceInv->quantity < (int) $newQty) {
                    return response()->json([
                        'message' => 'Insufficient stock at new source location for this transfer.',
                        'current_stock' => (int) $newSourceInv->quantity,
                        'requested' => $newQty,
                    ], 422);
                }
                $newDestInv = $this->lockedInventoryRow((int) $newToSku->id, (int) $newToLocationId);
                $newSourceInv->decrement('quantity', (int) $newQty);
                $newSourceInv->refresh();
                if ((int) $newSourceInv->quantity < 0) {
                    throw new \RuntimeException('Source inventory became negative while applying new transfer route.');
                }
                $newDestInv->increment('quantity', (int) $newQty);

                // Update transaction records to reflect the new route
                $outTx->location_id = $newFromLocationId;
                $outTx->quantity = $newQty;
                $inTx->location_id = $newToLocationId;
                $inTx->sku_id = $newToSku->id;
                $inTx->quantity = $newQty;
            } else {
                // Only quantity change (same locations & same destination SKU): adjust delta.
                if ($newQty !== $oldQty) {
                    $delta = $newQty - $oldQty; // +ve means increase transfer amount

                    $sourceInv = $this->lockedInventoryRow((int) $fromSku->id, (int) $oldFromLocationId);
                    $destInv = $this->lockedInventoryRow((int) $oldToSku->id, (int) $oldToLocationId);

                    if ($delta > 0) {
                        if ((int) $sourceInv->quantity < $delta) {
                            return response()->json([
                                'message' => 'Insufficient stock at source location for increasing this transfer.',
                                'current_stock' => (int) $sourceInv->quantity,
                                'requested_increase' => $delta,
                            ], 422);
                        }
                        $sourceInv->decrement('quantity', (int) $delta);
                        $destInv->increment('quantity', (int) $delta);
                        $sourceInv->refresh();
                        if ((int) $sourceInv->quantity < 0) {
                            throw new \RuntimeException('Source inventory became negative while increasing transfer quantity.');
                        }
                    } else {
                        $decrease = abs($delta);
                        if ((int) $destInv->quantity < $decrease) {
                            return response()->json([
                                'message' => 'Insufficient stock at destination location for decreasing this transfer.',
                                'current_stock' => (int) $destInv->quantity,
                                'requested_decrease' => $decrease,
                            ], 422);
                        }
                        $sourceInv->increment('quantity', (int) $decrease);
                        $destInv->decrement('quantity', (int) $decrease);
                        $destInv->refresh();
                        if ((int) $destInv->quantity < 0) {
                            throw new \RuntimeException('Destination inventory became negative while decreasing transfer quantity.');
                        }
                    }

                    $outTx->quantity = $newQty;
                    $inTx->quantity = $newQty;
                }
            }

            if (array_key_exists('notes', $validated)) {
                $userNotes = $validated['notes'];
                $toLocForNotes = (int) $inTx->location_id;
                $fromLocForNotes = (int) $outTx->location_id;
                $crossSuffix = '';
                if ((int) $inTx->sku_id !== (int) $fromSku->id) {
                    $crossSuffix = ' [cross-SKU: '.$fromSku->id.' → '.(int) $inTx->sku_id.']';
                }
                $outTx->notes = $this->buildTransferNotes('out', $toLocForNotes, $userNotes, $crossSuffix);
                $inTx->notes = $this->buildTransferNotes('in', $fromLocForNotes, $userNotes, $crossSuffix);
            }

            $outTx->save();
            $inTx->save();

            DB::commit();

            $this->safeBroadcastTransferPairs([
                ['sku_id' => (int) $outTx->sku_id, 'location_id' => (int) $outTx->location_id],
                ['sku_id' => (int) $inTx->sku_id, 'location_id' => (int) $inTx->location_id],
            ]);

            return response()->json([
                'message' => 'Transfer updated',
                'out_transaction' => $outTx->load(['sku', 'location']),
                'in_transaction' => $inTx->load(['sku', 'location']),
            ]);
        } catch (\Exception $e) {
            DB::rollBack();
            report($e);

            return response()->json(['error' => $e->getMessage()], 500);
        }
    }

    /**
     * Display the specified resource.
     */
    public function show(string $id)
    {
        return response()->json(
            InventoryTransaction::with(['sku', 'location'])->findOrFail($id)
        );
    }

    /**
     * Update the specified resource in storage.
     */
    public function update(Request $request, string $id)
    {
        $transaction = InventoryTransaction::findOrFail($id);
        $transaction->update($request->only(['notes']));

        return response()->json($transaction);
    }

    /**
     * Remove the specified resource from storage.
     */
    public function destroy(string $id)
    {
        InventoryTransaction::destroy($id);

        return response()->json(null, 204);
    }
}
