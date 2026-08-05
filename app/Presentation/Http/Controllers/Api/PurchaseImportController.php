<?php

namespace App\Presentation\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Validation\Rule;
use App\Application\Services\PurchaseImportService;
use App\Application\Services\TreasurySpendGuard;
use App\Presentation\Http\Requests\StorePurchaseBatchRequest;
use App\Domain\Models\Wms\InventoryLocation;
use App\Domain\Models\Wms\InventoryTransaction;
use App\Domain\Models\Wms\PurchaseBatch;
use App\Domain\Models\Wms\PurchaseBatchItem;
use App\Domain\Models\Wms\PurchaseUpload;
use App\Domain\Models\Wms\Sku;
use App\Domain\Models\Wms\SkuInventory;
use App\Domain\Models\Wms\Supplier;
use App\Domain\Models\Wms\Vendor;

class PurchaseImportController extends Controller
{
    protected PurchaseImportService $importService;

    public function __construct(PurchaseImportService $importService)
    {
        $this->importService = $importService;
    }

    private function parsePaymentMeta(?string $rawNotes): array
    {
        $notes = (string) ($rawNotes ?? '');
        $line = collect(preg_split('/\r\n|\r|\n/', $notes))
            ->first(fn ($entry) => str_starts_with(trim((string) $entry), '[PAYMENT]')) ?? '';

        preg_match('/paid=([0-9]+(?:\.[0-9]+)?)/i', $line, $paidMatch);
        preg_match('/remaining=([0-9]+(?:\.[0-9]+)?)/i', $line, $remainingMatch);
        preg_match('/type=(cash|credit)/i', $line, $typeMatch);
        preg_match('/status=([a-z_]+)/i', $line, $statusMatch);

        return [
            'paid' => isset($paidMatch[1]) ? (float) $paidMatch[1] : null,
            'remaining' => isset($remainingMatch[1]) ? (float) $remainingMatch[1] : null,
            'type' => isset($typeMatch[1]) ? strtolower((string) $typeMatch[1]) : null,
            'status' => isset($statusMatch[1]) ? strtolower((string) $statusMatch[1]) : null,
        ];
    }

    private function mergePaymentMetaNotes(?string $rawNotes, string $paymentType, float $paid, float $remaining, string $status): string
    {
        $base = collect(preg_split('/\r\n|\r|\n/', (string) ($rawNotes ?? '')))
            ->filter(fn ($line) => ! str_starts_with(trim((string) $line), '[PAYMENT]'))
            ->implode("\n");
        $meta = sprintf(
            '[PAYMENT] type=%s; paid=%s; remaining=%s; status=%s',
            $paymentType,
            number_format($paid, 2, '.', ''),
            number_format($remaining, 2, '.', ''),
            $status
        );

        return trim(implode("\n", array_filter([trim($base), $meta], fn ($line) => trim((string) $line) !== '')));
    }

    private function syncSupplierBalanceFromVendorDelta(int $vendorId, float $delta): void
    {
        if ($vendorId <= 0 || abs($delta) < 0.00001) {
            return;
        }

        $vendor = Vendor::find($vendorId);
        if (! $vendor) {
            return;
        }

        $query = Supplier::query();
        $hasCondition = false;

        if (! empty($vendor->email)) {
            $query->where('email', $vendor->email);
            $hasCondition = true;
        }

        if (! empty($vendor->name)) {
            if ($hasCondition) {
                $query->orWhere('name', $vendor->name);
            } else {
                $query->where('name', $vendor->name);
                $hasCondition = true;
            }
        }

        if (! $hasCondition) {
            return;
        }

        $supplier = $query->first();
        if (! $supplier) {
            return;
        }

        $current = (float) ($supplier->balance ?? 0);
        $supplier->update([
            'balance' => max(0.0, $current + $delta),
        ]);
    }

    private function calculateOutstandingAmountFromBatch(PurchaseBatch $batch): float
    {
        return $this->importService->computeOpenPayableFromBatch($batch);
    }

    private function transferReceivedInventoryLocation(PurchaseBatch $batch, int $newLocationId): void
    {
        $oldLocationId = (int) ($batch->location_id ?? 0);
        if ($oldLocationId <= 0 || $newLocationId <= 0 || $oldLocationId === $newLocationId) {
            return;
        }

        $batch->loadMissing('items');

        foreach ($batch->items as $item) {
            $skuId = (int) ($item->sku_id ?? 0);
            $qty = (float) ($item->received_quantity ?? $item->quantity ?? 0);

            if ($skuId <= 0 || $qty <= 0) {
                continue;
            }

            $sourceInventory = SkuInventory::firstOrCreate(
                ['sku_id' => $skuId, 'location_id' => $oldLocationId],
                ['quantity' => 0, 'reserved' => 0]
            );
            $available = (float) ($sourceInventory->quantity ?? 0);
            if ($available < $qty) {
                throw new \Exception("Cannot change warehouse after receiving: SKU {$skuId} stock already consumed in current warehouse.");
            }

            $targetInventory = SkuInventory::firstOrCreate(
                ['sku_id' => $skuId, 'location_id' => $newLocationId],
                ['quantity' => 0, 'reserved' => 0]
            );

            $sourceInventory->decrement('quantity', $qty);
            $targetInventory->increment('quantity', $qty);

            InventoryTransaction::create([
                'sku_id' => $skuId,
                'location_id' => $oldLocationId,
                'type' => 'OUT',
                'quantity' => $qty,
                'reference_type' => PurchaseBatch::class,
                'reference_id' => $batch->id,
                'notes' => "Batch {$batch->batch_number} warehouse relink OUT to location {$newLocationId}",
                'user_id' => auth()->id(),
            ]);

            InventoryTransaction::create([
                'sku_id' => $skuId,
                'location_id' => $newLocationId,
                'type' => 'IN',
                'quantity' => $qty,
                'reference_type' => PurchaseBatch::class,
                'reference_id' => $batch->id,
                'notes' => "Batch {$batch->batch_number} warehouse relink IN from location {$oldLocationId}",
                'user_id' => auth()->id(),
            ]);
        }
    }

    private function moveOutstandingBetweenVendors(?int $oldVendorId, ?int $newVendorId, float $outstanding): void
    {
        $outstanding = max(0.0, (float) $outstanding);
        if ($outstanding <= 0 || (int) $oldVendorId === (int) $newVendorId) {
            return;
        }

        if ((int) $oldVendorId > 0) {
            $oldVendor = Vendor::find((int) $oldVendorId);
            if ($oldVendor) {
                $oldCurrent = (float) ($oldVendor->current_balance ?? 0);
                $oldVendor->update([
                    'current_balance' => max(0.0, $oldCurrent - $outstanding),
                ]);
                $this->syncSupplierBalanceFromVendorDelta((int) $oldVendorId, -$outstanding);
            }
        }

        if ((int) $newVendorId > 0) {
            $newVendor = Vendor::find((int) $newVendorId);
            if ($newVendor) {
                $newCurrent = (float) ($newVendor->current_balance ?? 0);
                $newVendor->update([
                    'current_balance' => max(0.0, $newCurrent + $outstanding),
                ]);
                $this->syncSupplierBalanceFromVendorDelta((int) $newVendorId, $outstanding);
            }
        }
    }

    private function resolveSkuIdForMasterProductAtLocation(int $masterProductId, int $locationId): ?int
    {
        if ($masterProductId <= 0 || $locationId <= 0) {
            return null;
        }

        return $this->importService->resolveSkuIdForManualPurchaseLine(
            $masterProductId,
            0,
            $locationId,
            (int) (auth()->id() ?? 0)
        );
    }

    // ─── Upload & Process ─────────────────────────────────────

    /**
     * POST /api/inventory/purchases/smart-import/upload
     * Upload a supplier invoice file and trigger the full pipeline.
     */
    public function upload(Request $request): JsonResponse
    {
        $request->validate([
            'file' => 'required|file|mimes:pdf,jpg,jpeg,png,xlsx,xls|max:20480', // 20MB
        ]);

        $file = $request->file('file');
        $userId = $request->user()->id;

        // Step 1: Upload
        $upload = $this->importService->uploadFile($file, $userId);

        // Step 2: Extract text
        $upload = $this->importService->extractText($upload);

        if ($upload->extraction_status === 'failed') {
            return response()->json([
                'message' => $upload->error_message ?: 'Text extraction failed',
                'upload' => $upload,
            ], 422);
        }

        // Step 3: AI parse
        $upload = $this->importService->aiParse($upload);

        if ($upload->extraction_status === 'failed') {
            return response()->json([
                'message' => $upload->error_message ?: 'AI parsing failed',
                'upload' => $upload,
            ], 422);
        }

        // Step 4: Create draft batch
        $batch = $this->importService->createDraftBatch($upload);

        return response()->json([
            'message' => 'Invoice processed successfully',
            'upload' => $upload,
            'batch' => $batch,
        ], 201);
    }

    /**
     * POST /api/inventory/purchases/smart-import/upload-only
     * Upload file only (without processing). For manual trigger later.
     */
    public function uploadOnly(Request $request): JsonResponse
    {
        $request->validate([
            'file' => 'required|file|mimes:pdf,jpg,jpeg,png,xlsx,xls|max:20480',
        ]);

        $upload = $this->importService->uploadFile($request->file('file'), $request->user()->id);

        return response()->json([
            'message' => 'File uploaded successfully',
            'upload' => $upload,
        ], 201);
    }

    /**
     * POST /api/inventory/purchases/smart-import/{uploadId}/process
     * Trigger processing for an already uploaded file.
     */
    public function process(string $uploadId): JsonResponse
    {
        $upload = PurchaseUpload::where('upload_id', $uploadId)->firstOrFail();

        // Extract if not done
        if (! $upload->raw_text) {
            $upload = $this->importService->extractText($upload);
            if ($upload->extraction_status === 'failed') {
                return response()->json(['message' => 'Extraction failed', 'upload' => $upload], 422);
            }
        }

        // AI parse if not done
        if (! $upload->ai_structured_data) {
            $upload = $this->importService->aiParse($upload);
            if ($upload->extraction_status === 'failed') {
                return response()->json(['message' => 'AI parsing failed', 'upload' => $upload], 422);
            }
        }

        // Create batch if not exists
        if (! $upload->batch) {
            $batch = $this->importService->createDraftBatch($upload);
        } else {
            $batch = $upload->batch->load('items.masterProduct', 'items.sku', 'vendor');
        }

        return response()->json([
            'message' => 'Processing complete',
            'upload' => $upload,
            'batch' => $batch,
        ]);
    }

    // ─── Uploads ──────────────────────────────────────────────

    /**
     * GET /api/inventory/purchases/smart-import/uploads
     */
    public function listUploads(Request $request): JsonResponse
    {
        $uploads = PurchaseUpload::where('user_id', $request->user()->id)
            ->with('batch')
            ->orderByDesc('created_at')
            ->paginate(20);

        return response()->json($uploads);
    }

    // ─── Batches ──────────────────────────────────────────────

    /**
     * GET /api/inventory/purchases/smart-import/batches
     */
    public function listBatches(Request $request): JsonResponse
    {
        $query = PurchaseBatch::with([
            'vendor',
            'upload',
            'items' => function ($q) {
                $q->select('id', 'purchase_batch_id', 'raw_description', 'master_product_id', 'sku_id')
                    ->with([
                        'masterProduct:id,internal_name',
                        'sku:id,sku,name',
                    ]);
            },
        ])
            ->withCount('items')
            ->orderByDesc('created_at');

        if ($request->has('status')) {
            $query->where('status', $request->status);
        }

        if ($request->filled('search')) {
            $term = '%'.addcslashes(trim((string) $request->input('search')), '%_\\').'%';
            $query->where(function ($q) use ($term) {
                $q->where('invoice_number', 'ilike', $term)
                    ->orWhere('batch_number', 'ilike', $term)
                    ->orWhere('notes', 'ilike', $term)
                    ->orWhereHas('vendor', fn ($vq) => $vq->where('name', 'ilike', $term))
                    ->orWhereHas('items', function ($iq) use ($term) {
                        $iq->where('raw_description', 'ilike', $term)
                            ->orWhereHas('masterProduct', fn ($mq) => $mq->where('internal_name', 'ilike', $term))
                            ->orWhereHas('sku', function ($sq) use ($term) {
                                $sq->where('sku', 'ilike', $term)
                                    ->orWhere('name', 'ilike', $term);
                            });
                    });
            });
        }

        $perPage = min(500, max(1, (int) $request->input('per_page', 50)));

        return response()->json($query->paginate($perPage));
    }

    /**
     * GET /api/inventory/purchases/smart-import/summary/by-location
     * Aggregate purchase totals by location from approved/received batches.
     */
    public function summaryByLocation(): JsonResponse
    {
        $rows = PurchaseBatch::query()
            ->selectRaw('location_id, COUNT(*) as invoices_count, SUM(COALESCE(grand_total, subtotal, 0)) as total_purchase')
            // Smart-import batches are often kept in draft/review while still representing real purchases.
            // Count every non-cancelled invoice so dashboard totals match what users actually imported.
            ->where('status', '!=', 'cancelled')
            ->whereNotNull('location_id')
            ->groupBy('location_id')
            ->get()
            ->map(function ($row) {
                return [
                    'location_id' => (int) $row->location_id,
                    'invoices_count' => (int) ($row->invoices_count ?? 0),
                    'total_purchase' => round((float) ($row->total_purchase ?? 0), 2),
                ];
            })
            ->values();

        return response()->json($rows);
    }

    /**
     * POST /api/inventory/purchases/smart-import/batches
     * Create a manual purchase batch.
     */
    public function store(StorePurchaseBatchRequest $request): JsonResponse
    {
        $this->normalizeManualPurchaseStoreRequest($request);

        $userId = (int) $request->user()->id;
        $validated = $request->validated();

        $locationId = (int) ($validated['location_id'] ?? 0);
        $location = InventoryLocation::query()->with('channel')->findOrFail($locationId);
        $locationChannelId = $this->importService->resolveReceiveChannelIdForLocation($locationId);

        $items = (array) ($validated['items'] ?? []);
        $batchUserId = (int) $request->user()->id;
        foreach ($items as $i => $itemData) {
            $mpId = (int) ($itemData['master_product_id'] ?? 0);
            $requestedSkuId = (int) ($itemData['sku_id'] ?? 0);
            $resolvedSkuId = $this->importService->resolveSkuIdForManualPurchaseLine(
                $mpId,
                $requestedSkuId,
                $locationId,
                $batchUserId
            );
            if (! $resolvedSkuId) {
                $line = $i + 1;
                $channelName = $location->channel?->name;
                $hint = $locationChannelId !== null
                    ? "Add a listing (SKU) for this product on channel \"{$channelName}\" first, then save the invoice."
                    : 'Link this product to a generic SKU (no channel) for this warehouse.';

                return response()->json([
                    'message' => "Line {$line}: product is not linked to a valid SKU for this warehouse/channel. {$hint}",
                ], 422);
            }
            $items[$i]['sku_id'] = $resolvedSkuId;
        }

        $paymentMeta = $this->parsePaymentMeta($validated['notes'] ?? null);
        if (($paymentMeta['type'] ?? '') === 'cash') {
            $invoiceTotal = array_reduce(
                $items,
                fn (float $sum, array $row) => $sum + ((float) ($row['quantity'] ?? 0) * (float) ($row['unit_price'] ?? 0)),
                0.0
            );
            if ($invoiceTotal > 0.00001) {
                app(TreasurySpendGuard::class)->assertPaymentAllowedForUser($batchUserId, $invoiceTotal);
            }
        }

        try {
            $result = DB::transaction(function () use ($request, $validated, $locationId, $items) {
                $supplier = Supplier::findOrFail((int) $validated['supplier_id']);
                $vendor = $this->resolveOrCreateVendorFromSupplier($supplier);

                $batch = PurchaseBatch::create([
                    'batch_number' => PurchaseBatch::generateBatchNumber((int) $request->user()->id),
                    'user_id' => $request->user()->id,
                    // Some schemas require supplier_id; keep vendor_id for legacy purchase-batches/AP logic.
                    'supplier_id' => (int) $supplier->id,
                    'vendor_id' => $vendor->id,
                    'supplier_name_raw' => $supplier->name,
                    'supplier_matched' => true,
                    'location_id' => $locationId,
                    'invoice_number' => $validated['reference_number'] ?? null,
                    'invoice_date' => $validated['invoice_date'] ?? now(),
                    'notes' => $validated['notes'] ?? null,
                    'status' => 'draft',
                    'currency' => 'EGP',
                ]);

                foreach ($items as $itemData) {
                    PurchaseBatchItem::create([
                        'purchase_batch_id' => $batch->id,
                        'master_product_id' => (int) $itemData['master_product_id'],
                        'sku_id' => (int) $itemData['sku_id'],
                        'quantity' => (float) $itemData['quantity'],
                        'unit_price' => (float) $itemData['unit_price'],
                        'total_price' => (float) $itemData['quantity'] * (float) $itemData['unit_price'],
                        'product_matched' => true,
                    ]);
                }

                $batch->recalculateTotals();

                $batch = $this->importService->approveBatch($batch->refresh());

                $receivedItems = PurchaseBatchItem::where('purchase_batch_id', $batch->id)
                    ->get(['id', 'quantity'])
                    ->map(fn (PurchaseBatchItem $item) => [
                        'id' => (int) $item->id,
                        'received_quantity' => (float) $item->quantity,
                    ])
                    ->values()
                    ->all();

                $batch = $this->importService->receiveBatch(
                    $batch,
                    $receivedItems,
                    $locationId
                );

                $this->importService->syncAutoCashPurchasePayment($batch->refresh());

                return $batch;
            });
        } catch (HttpResponseException $e) {
            return $e->getResponse();
        } catch (\Throwable $e) {
            $message = trim($e->getMessage());

            return response()->json([
                'message' => $message !== '' ? $message : 'Could not save purchase invoice',
            ], 422);
        }

        return response()->json([
            'message' => 'Purchase invoice saved and received',
            'batch' => $result->load('items.masterProduct', 'items.sku', 'vendor', 'location'),
        ], 201);
    }

    /**
     * Accept legacy/alternate field names from the inventory SPA before validation.
     */
    private function normalizeManualPurchaseStoreRequest(Request $request): void
    {
        if (! $request->filled('location_id')) {
            $location = $request->input('store_id') ?? $request->input('warehouse_id');
            if ($location !== null && $location !== '') {
                $request->merge(['location_id' => $location]);
            }
        }

        if (! $request->filled('reference_number') && $request->filled('invoice_number')) {
            $request->merge(['reference_number' => $request->input('invoice_number')]);
        }

        $items = $request->input('items');
        if (! is_array($items)) {
            return;
        }

        $normalizedItems = [];
        foreach ($items as $item) {
            if (! is_array($item)) {
                continue;
            }

            if (empty($item['master_product_id']) && ! empty($item['product_id'])) {
                $item['master_product_id'] = $item['product_id'];
            }

            if (array_key_exists('sku_id', $item)) {
                $skuId = $item['sku_id'];
                if ($skuId === '' || $skuId === null || $skuId === false || (is_numeric($skuId) && (int) $skuId <= 0)) {
                    unset($item['sku_id']);
                } else {
                    $item['sku_id'] = (int) $skuId;
                }
            }

            $normalizedItems[] = $item;
        }

        $request->merge(['items' => $normalizedItems]);

        $notes = (string) ($request->input('notes') ?? '');
        if (! str_contains($notes, '[PAYMENT]')) {
            $paymentType = strtolower((string) ($request->input('payment_type') ?? $request->input('payment_method') ?? ''));
            if (in_array($paymentType, ['cash', 'credit'], true)) {
                $total = array_reduce(
                    $normalizedItems,
                    fn (float $sum, array $row) => $sum + ((float) ($row['quantity'] ?? 0) * (float) ($row['unit_price'] ?? 0)),
                    0.0
                );
                $paid = $request->has('paid_amount')
                    ? max(0.0, min((float) $request->input('paid_amount'), $total))
                    : ($paymentType === 'cash' ? $total : 0.0);
                $remaining = max(0.0, $total - $paid);
                $status = PurchaseImportService::resolvePaymentMetaStatus('draft', $paid, $remaining, $paymentType);
                $request->merge([
                    'notes' => $this->mergePaymentMetaNotes($notes, $paymentType, $paid, $remaining, $status),
                ]);
            }
        }
    }

    private function resolveOrCreateVendorFromSupplier(Supplier $supplier): Vendor
    {
        $existing = Supplier::findMatchingVendorFor($supplier);
        if ($existing) {
            return $existing;
        }

        return Vendor::create([
            'name' => $supplier->name,
            'email' => $supplier->email,
            'phone' => $supplier->phone,
            'address' => $supplier->address,
            'current_balance' => (float) ($supplier->balance ?? 0),
            'is_active' => true,
        ]);
    }

    /**
     * GET /api/inventory/purchases/smart-import/batches/{id}
     */
    public function showBatch(int $id): JsonResponse
    {
        $batch = PurchaseBatch::with([
            'items.masterProduct',
            'items.sku',
            'vendor',
            'upload',
            'location',
        ])->findOrFail($id);

        return response()->json($batch);
    }

    /**
     * PUT /api/inventory/purchases/smart-import/batches/{id}
     * Update batch info (supplier, invoice details) and items.
     */
    public function updateBatch(Request $request, int $id): JsonResponse
    {
        $batch = PurchaseBatch::with('items')->findOrFail($id);
        $status = (string) $batch->status;
        $isReceived = $status === 'received';

        if (! in_array($status, ['draft', 'review', 'approved', 'received'], true)) {
            return response()->json(['message' => 'Batch cannot be edited in current status'], 422);
        }

        $oldOutstanding = $this->calculateOutstandingAmountFromBatch($batch);

        $rules = [
            'vendor_id' => 'nullable|exists:vendors,id',
            'supplier_id' => 'nullable|exists:suppliers,id',
            'location_id' => 'nullable|exists:inventory_locations,id',
        ];

        if ($isReceived) {
            $rules = array_merge($rules, [
                'items' => 'sometimes|array',
                'items.*.id' => 'required_with:items|exists:purchase_batch_items,id',
                'items.*.raw_description' => 'nullable|string',
                'items.*.master_product_id' => 'nullable|exists:master_products,id',
                'items.*.sku_id' => 'nullable|exists:skus,id',
                'items.*.quantity' => 'nullable|numeric|min:0',
                'items.*.unit_price' => 'nullable|numeric|min:0',
                'invoice_number' => 'prohibited',
                'invoice_date' => 'prohibited',
                'currency' => 'prohibited',
            ]);
        } else {
            $rules = array_merge($rules, [
                'items' => 'sometimes|array',
                'items.*.id' => 'required_with:items|exists:purchase_batch_items,id',
                'items.*.quantity' => 'nullable|numeric|min:0',
                'items.*.unit_price' => 'nullable|numeric|min:0',
                'items.*.master_product_id' => 'nullable|exists:master_products,id',
                'items.*.sku_id' => 'nullable|exists:skus,id',
            ]);
        }

        $request->validate($rules);

        $payload = $request->only(['location_id', 'supplier_name_raw', 'notes']);
        if (! $isReceived) {
            $payload = array_merge($payload, $request->only(['invoice_number', 'invoice_date', 'currency']));
        }

        $oldVendorId = (int) ($batch->vendor_id ?? 0);
        $oldLocationId = (int) ($batch->location_id ?? 0);

        if ($request->filled('supplier_id')) {
            $supplier = Supplier::findOrFail((int) $request->supplier_id);
            $vendor = $this->resolveOrCreateVendorFromSupplier($supplier);
            $payload['vendor_id'] = $vendor->id;
            $payload['supplier_name_raw'] = $supplier->name;
            $payload['supplier_matched'] = true;
        } elseif ($request->filled('vendor_id')) {
            $payload['vendor_id'] = (int) $request->vendor_id;
            $payload['supplier_matched'] = true;
        } elseif ($request->has('vendor_id')) {
            $payload['vendor_id'] = null;
            $payload['supplier_matched'] = false;
        }

        try {
            DB::transaction(function () use ($request, $batch, $payload, $isReceived, $oldVendorId, $oldLocationId, $oldOutstanding, $status) {
            $batch->update($payload);

            // For received invoices, warehouse relink means stock transfer from old location to new location.
            $newLocationId = (int) ($batch->location_id ?? 0);
            if ($isReceived && $oldLocationId > 0 && $newLocationId > 0 && $newLocationId !== $oldLocationId) {
                $this->transferReceivedInventoryLocation($batch, $newLocationId);
            }

            $newVendorId = (int) ($batch->vendor_id ?? 0);
            $batchUserId = (int) ($batch->user_id ?? 0);
            $receiveLocationId = (int) ($batch->location_id ?? 0);

            // Update items:
            // - received: qty/price/mapping with stock deltas (same SKU resolution as receive)
            // - approved: qty increases post stock before formal receive
            // - draft/review: full editable row values (DB only)
            if ($request->has('items')) {
                $hasRemainingQuantityColumn = \Illuminate\Support\Facades\Schema::hasColumn('purchase_batch_items', 'remaining_quantity');
                foreach ($request->items as $itemData) {
                    $item = PurchaseBatchItem::find($itemData['id'] ?? 0);
                    if (! $item || $item->purchase_batch_id !== $batch->id) {
                        continue;
                    }

                    if ($isReceived) {
                        $oldQty = (float) ($item->received_quantity ?? $item->quantity ?? 0);
                        $newQty = array_key_exists('quantity', $itemData) ? (float) ($itemData['quantity'] ?? 0) : $oldQty;
                        $deltaQty = $newQty - $oldQty;

                        if (! empty($itemData['master_product_id'])) {
                            $item->master_product_id = (int) $itemData['master_product_id'];
                        }
                        if (! empty($itemData['raw_description'])) {
                            $item->raw_description = (string) $itemData['raw_description'];
                        }
                        if (! empty($itemData['sku_id'])) {
                            $item->sku_id = (int) $itemData['sku_id'];
                        }
                        $item->save();

                        $preferredSkuId = ! empty($itemData['sku_id']) ? (int) $itemData['sku_id'] : null;
                        $resolvedSkuId = $this->importService->resolveStockSkuIdForReceivedLineEdit(
                            $batch,
                            $item->fresh(),
                            $receiveLocationId > 0 ? $receiveLocationId : 0,
                            $batchUserId,
                            $preferredSkuId
                        );
                        if (! $resolvedSkuId && ($preferredSkuId || ! empty($itemData['master_product_id']))) {
                            throw new \Exception(
                                'لا يوجد عرض بيع (SKU) لهذا المنتج على قناة المخزن المحدد. '
                                .'أضِف SKU على نفس القناة من المنتج الأساسي ثم أعد الربط.'
                            );
                        }
                        $skuId = $resolvedSkuId ? (int) $resolvedSkuId : null;
                        if ($skuId && $receiveLocationId > 0) {
                            if (abs($deltaQty) > 0.0000001) {
                                $this->importService->applyReceivedStockDelta(
                                    $batch,
                                    $skuId,
                                    $receiveLocationId,
                                    (float) $deltaQty,
                                    "Purchase batch {$batch->batch_number} line {$item->id} quantity edit"
                                );
                            } elseif (array_key_exists('quantity', $itemData)) {
                                // Qty already saved but stock may be on another SKU — realign without changing the line again.
                                $this->importService->reconcileReceivedLineStockToTargetSku(
                                    $batch,
                                    $item->fresh(),
                                    $skuId,
                                    $receiveLocationId,
                                    (float) $newQty,
                                    "Purchase batch {$batch->batch_number} line {$item->id} stock reconcile"
                                );
                            }
                        } elseif (abs($deltaQty) > 0.0000001) {
                            if (! $skuId) {
                                throw new \Exception('Cannot adjust received quantity: missing SKU mapping on the line.');
                            }
                            if ($receiveLocationId <= 0) {
                                throw new \Exception('Cannot adjust received invoice: missing warehouse/location.');
                            }
                        }

                        $incomingSkuId = $skuId ?? ($preferredSkuId ?: ($itemData['sku_id'] ?? $item->sku_id));

                        $itemPayload = array_filter([
                            'master_product_id' => $itemData['master_product_id'] ?? null,
                            'sku_id' => $incomingSkuId ?? $item->sku_id,
                            'raw_description' => $itemData['raw_description'] ?? null,
                            'product_matched' => ! empty($itemData['master_product_id']) || ! empty($incomingSkuId ?? $item->sku_id),
                            'quantity' => array_key_exists('quantity', $itemData) ? $newQty : null,
                            'unit_price' => array_key_exists('unit_price', $itemData) ? (float) ($itemData['unit_price'] ?? 0) : null,
                            'total_price' => (array_key_exists('quantity', $itemData) || array_key_exists('unit_price', $itemData))
                                ? ((float) $newQty) * ((float) ($itemData['unit_price'] ?? $item->unit_price ?? 0))
                                : null,
                        ], fn ($v) => $v !== null);

                        // Keep received_quantity aligned with quantity edits for already-received invoices.
                        if (array_key_exists('quantity', $itemData)) {
                            $itemPayload['received_quantity'] = $newQty;
                            if ($hasRemainingQuantityColumn) {
                                $itemPayload['remaining_quantity'] = $newQty;
                            }
                        }

                        $item->update($itemPayload);

                        continue;
                    }

                    $oldQty = (float) ($item->quantity ?? 0);
                    $newQty = array_key_exists('quantity', $itemData)
                        ? (float) ($itemData['quantity'] ?? 0)
                        : $oldQty;
                    $deltaQty = $newQty - $oldQty;

                    if ($status === 'approved' && abs($deltaQty) > 0.0000001 && $receiveLocationId > 0) {
                        if (! empty($itemData['master_product_id'])) {
                            $item->master_product_id = (int) $itemData['master_product_id'];
                        }
                        if (! empty($itemData['sku_id'])) {
                            $item->sku_id = (int) $itemData['sku_id'];
                        }
                        $item->save();

                        $resolvedSkuId = $this->importService->resolveSkuIdForBatchItemLine(
                            $item->fresh(),
                            $receiveLocationId,
                            $batchUserId
                        );
                        if (! $resolvedSkuId) {
                            throw new \Exception('Cannot adjust approved invoice quantity: missing SKU mapping on the line.');
                        }
                        if ($deltaQty > 0) {
                            $stockLocationId = $this->importService->resolveStockLocationIdForSku((int) $resolvedSkuId, $receiveLocationId);
                            $this->importService->applyReceivedStockDelta(
                                $batch,
                                (int) $resolvedSkuId,
                                $stockLocationId,
                                (float) $deltaQty,
                                "Purchase batch {$batch->batch_number} line {$item->id} approved qty increase"
                            );
                        }
                    }

                    $item->update(array_filter([
                        'master_product_id' => $itemData['master_product_id'] ?? null,
                        'sku_id' => $itemData['sku_id'] ?? null,
                        'raw_description' => $itemData['raw_description'] ?? null,
                        'product_matched' => ! empty($itemData['master_product_id']) || ! empty($itemData['sku_id'] ?? null),
                        'quantity' => array_key_exists('quantity', $itemData) ? $newQty : null,
                        'unit_price' => $itemData['unit_price'] ?? null,
                        'total_price' => (array_key_exists('quantity', $itemData) || array_key_exists('unit_price', $itemData))
                            ? ((float) $newQty) * ((float) ($itemData['unit_price'] ?? $item->unit_price ?? 0))
                            : null,
                    ], fn ($v) => $v !== null));
                }

                $batch->recalculateTotals();
            }

            // Moving supplier/vendor after approval/receive should move outstanding payable.
            if (in_array((string) $batch->status, ['approved', 'received'], true)) {
                $newOutstanding = $this->calculateOutstandingAmountFromBatch($batch->refresh()->loadMissing('items'));

                if ($newVendorId !== $oldVendorId) {
                    if ($oldVendorId > 0) {
                        $this->moveOutstandingBetweenVendors($oldVendorId, null, (float) $oldOutstanding);
                    }
                    if ($newVendorId > 0) {
                        $this->moveOutstandingBetweenVendors(null, $newVendorId, (float) $newOutstanding);
                    }
                } else {
                    $delta = (float) $newOutstanding - (float) $oldOutstanding;
                    if ($newVendorId > 0 && abs($delta) > 0.0000001) {
                        $this->importService->adjustVendorPayableBalance($newVendorId, $delta);
                    }
                }
            }
        });
        } catch (\Throwable $e) {
            return response()->json([
                'message' => $e->getMessage() ?: 'Failed to update purchase batch',
            ], 422);
        }

        return response()->json([
            'message' => 'Batch updated',
            'batch' => $batch->refresh()->load('items.masterProduct', 'items.sku', 'vendor', 'location'),
        ]);
    }

    /**
     * POST /api/inventory/purchases/smart-import/batches/{id}/add-item
     * Add a new item to a draft batch.
     */
    public function addItem(Request $request, int $id): JsonResponse
    {
        $batch = PurchaseBatch::findOrFail($id);

        if (! in_array($batch->status, ['draft', 'review', 'approved', 'received'], true)) {
            return response()->json(['message' => 'Cannot add items to this batch'], 422);
        }

        $isReceived = (string) $batch->status === 'received';
        $request->validate([
            'raw_description' => 'required|string',
            'quantity' => $isReceived ? 'required|numeric|min:0' : 'required|numeric|min:0.01',
            'unit_price' => 'required|numeric|min:0',
            'master_product_id' => 'nullable|exists:master_products,id',
            'sku_id' => 'nullable|exists:skus,id',
        ]);

        $receiveLocationId = (int) ($batch->location_id ?? 0);
        $skuId = $request->sku_id ? (int) $request->sku_id : null;
        if ($isReceived && $receiveLocationId > 0 && $skuId) {
            $sku = Sku::query()->with('offer')->findOrFail($skuId);
            $mpId = (int) ($request->master_product_id ?? 0);
            $skuMasterId = (int) ($sku->offer?->master_product_id ?? 0);
            if ($mpId > 0 && $skuMasterId > 0 && $mpId !== $skuMasterId) {
                return response()->json(['message' => 'SKU does not belong to the selected master product'], 422);
            }
            if (! $this->importService->isSkuCompatibleWithReceiveLocation($sku, $receiveLocationId)) {
                $channelSku = $mpId > 0
                    ? $this->resolveSkuIdForMasterProductAtLocation($mpId, $receiveLocationId)
                    : null;
                if ($channelSku) {
                    $skuId = $channelSku;
                } else {
                    return response()->json([
                        'message' => 'Selected SKU is not for this warehouse channel. Add a listing on that channel first.',
                    ], 422);
                }
            }
        }

        $oldOutstanding = $this->calculateOutstandingAmountFromBatch($batch->loadMissing('items'));

        $item = PurchaseBatchItem::create([
            'purchase_batch_id' => $batch->id,
            'master_product_id' => $request->master_product_id,
            'sku_id' => $skuId,
            'raw_description' => $request->raw_description,
            'product_matched' => (bool) $request->master_product_id,
            'quantity' => $request->quantity,
            'unit_price' => $request->unit_price,
            'total_price' => $request->quantity * $request->unit_price,
            'received_quantity' => $isReceived ? $request->quantity : null,
            'batch_cost_id' => $isReceived ? ('BC-'.$batch->batch_number) : null,
        ]);

        // Keep FIFO layers consistent for already-received invoices (if the column exists).
        if ($isReceived && Schema::hasColumn('purchase_batch_items', 'remaining_quantity')) {
            $qty = (float) ($request->quantity ?? 0);
            $item->update(['remaining_quantity' => max(0.0, $qty)]);
        }

        $batch->recalculateTotals();

        if (in_array((string) $batch->status, ['approved', 'received'], true) && $batch->vendor_id) {
            $newOutstanding = $this->calculateOutstandingAmountFromBatch($batch->refresh()->loadMissing('items'));
            $delta = (float) $newOutstanding - (float) $oldOutstanding;
            if (abs($delta) > 0.0000001) {
                $this->importService->adjustVendorPayableBalance((int) $batch->vendor_id, $delta);
            }
        }

        if ($isReceived && $receiveLocationId > 0 && $skuId) {
            if ($receiveLocationId <= 0) {
                return response()->json(['message' => 'Received invoice is missing warehouse/location'], 422);
            }
            $resolvedSkuId = $this->importService->resolveStockSkuIdForReceivedLineEdit(
                $batch,
                $item->fresh(),
                $receiveLocationId,
                (int) ($batch->user_id ?? 0),
                $skuId
            );
            if (! $resolvedSkuId) {
                return response()->json([
                    'message' => 'Cannot add line: no SKU listing for this product on the invoice warehouse channel.',
                ], 422);
            }
            if ((int) $resolvedSkuId !== $skuId) {
                $item->update(['sku_id' => (int) $resolvedSkuId]);
            }
            $skuId = (int) $resolvedSkuId;
            $qty = (float) ($item->received_quantity ?? $item->quantity ?? 0);
            if ($skuId > 0 && $qty > 0) {
                $stockLocationId = $this->importService->resolveStockLocationIdForSku($skuId, $receiveLocationId);
                $this->importService->applyReceivedStockDelta(
                    $batch,
                    $skuId,
                    $stockLocationId,
                    $qty,
                    "Purchase batch {$batch->batch_number} add line {$item->id}"
                );
            }
        }

        return response()->json([
            'message' => 'Item added',
            'item' => $item->load('masterProduct', 'sku'),
        ], 201);
    }

    /**
     * DELETE /api/inventory/purchases/smart-import/batches/{batchId}/items/{itemId}
     */
    public function removeItem(int $batchId, int $itemId): JsonResponse
    {
        $batch = PurchaseBatch::findOrFail($batchId);

        if (! in_array($batch->status, ['draft', 'review', 'approved', 'received'], true)) {
            return response()->json(['message' => 'Cannot remove items from this batch'], 422);
        }

        $item = PurchaseBatchItem::where('purchase_batch_id', $batchId)->findOrFail($itemId);
        $oldOutstanding = $this->calculateOutstandingAmountFromBatch($batch->loadMissing('items'));
        $wasApprovedOrReceived = in_array((string) $batch->status, ['approved', 'received'], true);

        try {
            if ((string) $batch->status === 'received') {
                $receiveLocationId = (int) ($batch->location_id ?? 0);
                if ($receiveLocationId <= 0) {
                    return response()->json(['message' => 'Received invoice is missing warehouse/location'], 422);
                }
                $resolvedSkuId = $this->importService->resolveSkuIdForBatchItemLine(
                    $item,
                    $receiveLocationId,
                    (int) ($batch->user_id ?? 0)
                );
                $skuId = (int) ($resolvedSkuId ?? $item->sku_id ?? 0);
                $qty = (float) ($item->received_quantity ?? $item->quantity ?? 0);
                if ($qty > 0 && $skuId <= 0) {
                    return response()->json(['message' => 'Cannot remove line from received invoice: missing SKU mapping'], 422);
                }
                if ($skuId > 0 && $qty > 0) {
                    $stockLocationId = $this->importService->resolveStockLocationIdForSku($skuId, $receiveLocationId);
                    $this->importService->applyReceivedStockDelta(
                        $batch,
                        $skuId,
                        $stockLocationId,
                        -$qty,
                        "Purchase batch {$batch->batch_number} remove line {$item->id}"
                    );
                }
            }

            $item->delete();

            $batch->recalculateTotals();

            if ($wasApprovedOrReceived && $batch->vendor_id) {
                $newOutstanding = $this->calculateOutstandingAmountFromBatch($batch->refresh()->loadMissing('items'));
                $delta = (float) $newOutstanding - (float) $oldOutstanding;
                if (abs($delta) > 0.0000001) {
                    $this->importService->adjustVendorPayableBalance((int) $batch->vendor_id, $delta);
                }
            }
        } catch (\Throwable $e) {
            return response()->json([
                'message' => $e->getMessage() ?: 'Failed to remove purchase line',
            ], 422);
        }

        return response()->json(['message' => 'Item removed']);
    }

    /**
     * POST /api/inventory/purchases/smart-import/batches/{id}/approve
     */
    public function approve(int $id): JsonResponse
    {
        $batch = PurchaseBatch::findOrFail($id);

        try {
            $batch = $this->importService->approveBatch($batch);
        } catch (\Exception $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }

        return response()->json([
            'message' => 'Batch approved',
            'batch' => $batch->load('items'),
        ]);
    }

    /**
     * POST /api/inventory/purchases/smart-import/batches/{id}/receive
     */
    public function receive(Request $request, int $id): JsonResponse
    {
        $request->validate([
            'location_id' => 'required|exists:inventory_locations,id',
            'items' => 'required|array',
            'items.*.id' => 'required|exists:purchase_batch_items,id',
            'items.*.received_quantity' => 'required|numeric|min:0',
        ]);

        $batch = PurchaseBatch::findOrFail($id);

        try {
            $batch = $this->importService->receiveBatch(
                $batch,
                $request->items,
                $request->location_id
            );
        } catch (\Exception $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }

        $autoCreated = $this->importService->getLastAutoCreatedItems();
        $message = 'Batch received and inventory updated';
        if (! empty($autoCreated)) {
            $message .= ' (auto-created '.count($autoCreated).' new product(s))';
        }

        return response()->json([
            'message' => $message,
            'batch' => $batch,
            'auto_created_items' => $autoCreated,
        ]);
    }

    /**
     * POST /api/inventory/purchases/smart-import/batches/{id}/cancel
     */
    public function cancel(int $id): JsonResponse
    {
        $batch = PurchaseBatch::findOrFail($id);
        $keepStock = request()->boolean('keep_stock', false);

        try {
            $this->importService->cancelBatch($batch, $keepStock);
        } catch (\Exception $e) {
            return response()->json(['message' => $e->getMessage()], 422);
        }

        return response()->json([
            'message' => $keepStock
                ? 'Batch cancelled and accounting reversed (stock kept as-is).'
                : 'Batch cancelled',
        ]);
    }

    /**
     * POST /api/inventory/purchases/smart-import/batches/{id}/payment-meta
     * Update payment meta in notes and sync payable balance for approved/received batches.
     */
    public function updatePaymentMeta(Request $request, int $id): JsonResponse
    {
        $request->validate([
            'payment_type' => 'required|in:cash,credit',
            'paid_amount' => 'nullable|numeric|min:0',
        ]);

        $batch = PurchaseBatch::findOrFail($id);
        $paymentType = strtolower((string) $request->payment_type);
        $total = (float) ($batch->grand_total ?? $batch->subtotal ?? 0);

        $oldOpen = $this->importService->computeOpenPayableFromBatch($batch);

        if ($request->filled('paid_amount')) {
            $newPaid = max(0.0, min((float) $request->paid_amount, $total));
        } elseif ($paymentType === 'cash') {
            $newPaid = $total;
        } else {
            // Full credit (أجل) unless caller sends an explicit advance via paid_amount.
            $newPaid = 0.0;
        }

        $newRemaining = max(0.0, $total - $newPaid);
        $newStatus = PurchaseImportService::resolvePaymentMetaStatus(
            (string) ($batch->status ?? ''),
            $newPaid,
            $newRemaining,
            $paymentType
        );

        $batch->update([
            'notes' => $this->mergePaymentMetaNotes($batch->notes, $paymentType, $newPaid, $newRemaining, $newStatus),
        ]);

        $batch->refresh();
        $newOpen = $this->importService->computeOpenPayableFromBatch($batch);

        // Keep vendor/supplier payable balances aligned when invoice is already approved/received.
        if (in_array((string) $batch->status, ['approved', 'received'], true) && $batch->vendor_id) {
            $delta = $newOpen - $oldOpen;
            if (abs($delta) >= 0.00001) {
                $vendor = Vendor::find((int) $batch->vendor_id);
                if ($vendor) {
                    $currentVendorBalance = (float) ($vendor->current_balance ?? 0);
                    $vendor->update([
                        'current_balance' => max(0.0, $currentVendorBalance + $delta),
                    ]);
                }
                $this->syncSupplierBalanceFromVendorDelta((int) $batch->vendor_id, $delta);
            }
        }

        $this->importService->syncAutoCashPurchasePayment($batch->refresh());

        return response()->json([
            'message' => 'Batch payment metadata updated',
            'batch' => $batch->refresh()->load('items.masterProduct', 'items.sku', 'vendor', 'location'),
        ]);
    }
}
