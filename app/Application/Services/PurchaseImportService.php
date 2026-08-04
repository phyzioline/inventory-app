<?php

namespace App\Application\Services;

use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use App\Infrastructure\External\GeminiService;
use App\Domain\Models\Wms\InventoryLocation;
use App\Domain\Models\Wms\InventoryOffer;
use App\Domain\Models\Wms\InventoryTransaction;
use App\Domain\Models\Wms\MasterProduct;
use App\Domain\Models\Wms\Payment;
use App\Domain\Models\Wms\PurchaseBatch;
use App\Domain\Models\Wms\PurchaseBatchItem;
use App\Domain\Models\Wms\PurchaseUpload;
use App\Domain\Models\Wms\Sku;
use App\Domain\Models\Wms\SkuInventory;
use App\Domain\Models\Wms\Supplier;
use App\Domain\Models\Wms\Vendor;
use App\Infrastructure\Support\StockUpdateBroadcaster;

class PurchaseImportService
{
    protected GeminiService $gemini;

    protected array $lastAutoCreatedItems = [];

    public function __construct(GeminiService $gemini)
    {
        $this->gemini = $gemini;
    }

    public function getLastAutoCreatedItems(): array
    {
        return array_values($this->lastAutoCreatedItems);
    }

    // ─── STEP 1: Upload File ────────────────────────────────────

    public function uploadFile(UploadedFile $file, int $userId): PurchaseUpload
    {
        $uploadId = (string) Str::uuid();
        $ext = strtolower($file->getClientOriginalExtension());
        $path = $file->storeAs('purchase-uploads', "{$uploadId}.{$ext}", 'local');

        return PurchaseUpload::create([
            'upload_id' => $uploadId,
            'user_id' => $userId,
            'original_filename' => $file->getClientOriginalName(),
            'file_path' => $path,
            'file_type' => $ext,
            'file_size' => $file->getSize(),
            'extraction_status' => 'pending',
        ]);
    }

    // ─── STEP 2: Extract Text ───────────────────────────────────

    public function extractText(PurchaseUpload $upload): PurchaseUpload
    {
        $upload->update(['extraction_status' => 'extracting']);

        try {
            $fullPath = Storage::disk('local')->path($upload->file_path);
            $text = '';

            switch ($upload->file_type) {
                case 'pdf':
                    $text = $this->extractFromPdf($fullPath);
                    break;

                case 'jpg':
                case 'jpeg':
                case 'png':
                    $text = $this->extractFromImage($fullPath);
                    break;

                case 'xlsx':
                case 'xls':
                    $text = $this->extractFromExcel($fullPath);
                    break;

                default:
                    throw new \Exception("Unsupported file type: {$upload->file_type}");
            }

            if (empty(trim($text))) {
                throw new \Exception('No text could be extracted from the file.');
            }

            $upload->update([
                'raw_text' => $text,
                'extraction_status' => 'extracted',
            ]);
        } catch (\Exception $e) {
            Log::error('Purchase Import - Text Extraction Failed', [
                'upload_id' => $upload->upload_id,
                'error' => $e->getMessage(),
            ]);

            $upload->update([
                'extraction_status' => 'failed',
                'error_message' => $e->getMessage(),
            ]);
        }

        return $upload->refresh();
    }

    // ─── STEP 3: AI Parse ───────────────────────────────────────

    public function aiParse(PurchaseUpload $upload): PurchaseUpload
    {
        if (! $upload->raw_text) {
            $upload->update([
                'extraction_status' => 'failed',
                'error_message' => 'No raw text available for parsing.',
            ]);

            return $upload;
        }

        $upload->update(['extraction_status' => 'ai_parsing']);

        try {
            $isLocalEnabled = config('services.gemini.smart_import_local', true);
            $structured = null;

            if ($isLocalEnabled) {
                Log::info('Purchase Import: Using local rule-based parser');
                $structured = $this->localParse($upload->raw_text, $upload->file_type);
            } else {
                Log::info('Purchase Import: Using Gemini AI parser');
                $prompt = $this->buildParsingPrompt($upload->raw_text);
                $aiResponse = $this->gemini->askGemini($prompt);
                $json = $this->extractJsonFromResponse($aiResponse);

                if (! $json) {
                    throw new \Exception('AI did not return valid JSON.');
                }

                $structured = json_decode($json, true);

                if (json_last_error() !== JSON_ERROR_NONE) {
                    throw new \Exception('AI returned invalid JSON: '.json_last_error_msg());
                }
            }

            if (! $structured) {
                throw new \Exception('Failed to structure document data.');
            }

            if (in_array(strtolower((string) $upload->file_type), ['xlsx', 'xls'], true)) {
                $itemsCount = is_array($structured['items'] ?? null) ? count($structured['items']) : 0;
                if ($itemsCount === 0) {
                    throw new \Exception('No product rows found in Excel file. Fill the template rows under headers and re-upload.');
                }
            }

            $upload->update([
                'ai_structured_data' => $structured,
                'extraction_status' => 'parsed',
            ]);
        } catch (\Exception $e) {
            Log::error('Purchase Import - Parsing Failed', [
                'upload_id' => $upload->upload_id,
                'error' => $e->getMessage(),
            ]);

            $upload->update([
                'extraction_status' => 'failed',
                'error_message' => 'Parsing failed: '.$e->getMessage(),
            ]);
        }

        return $upload->refresh();
    }

    // ─── STEP 4: Create Draft Batch ─────────────────────────────

    public function createDraftBatch(PurchaseUpload $upload): PurchaseBatch
    {
        $data = $upload->ai_structured_data ?? [];
        $isStructuredExcel = in_array(strtolower((string) $upload->file_type), ['xlsx', 'xls'], true);

        // Supplier matching
        $supplierName = $data['supplier_name'] ?? null;
        $vendor = null;
        $supplierMatched = false;

        if ($supplierName) {
            $vendor = $this->matchSupplier($supplierName);
            $supplierMatched = $vendor !== null;
        }

        // Create batch
        $batch = PurchaseBatch::create([
            'batch_number' => PurchaseBatch::generateBatchNumber((int) $upload->user_id),
            'purchase_upload_id' => $upload->id,
            'user_id' => $upload->user_id,
            'vendor_id' => $vendor?->id,
            'supplier_name_raw' => $supplierName,
            'supplier_matched' => $supplierMatched,
            'invoice_number' => $data['invoice_number'] ?? null,
            'invoice_date' => $data['invoice_date'] ?? null,
            'currency' => $data['currency'] ?? 'EGP',
            'status' => 'draft',
        ]);

        // Create line items with product matching
        $items = $data['items'] ?? [];
        $subtotal = 0;

        foreach ($items as $item) {
            $description = $item['description'] ?? '';
            $qty = floatval($item['quantity'] ?? 0);
            $unitPrice = floatval($item['unit_price'] ?? 0);
            $totalPrice = floatval($item['total'] ?? ($qty * $unitPrice));

            // Product matching:
            // - Excel template import uses strict matching (explicit SKU/exact name only).
            // - Other import sources keep fuzzy smart matching.
            $match = $isStructuredExcel
                ? $this->matchProductStrictFromTemplate($item)
                : $this->matchProduct($description);

            PurchaseBatchItem::create([
                'purchase_batch_id' => $batch->id,
                'master_product_id' => $match['master_product_id'],
                'sku_id' => $match['sku_id'],
                'raw_description' => $description,
                'product_matched' => $match['matched'],
                'quantity' => $qty,
                'unit_price' => $unitPrice,
                'total_price' => $totalPrice,
            ]);

            $subtotal += $totalPrice;
        }

        $grandTotal = floatval($data['grand_total'] ?? $subtotal);

        $batch->update([
            'subtotal' => $subtotal,
            'grand_total' => $grandTotal,
            'tax_amount' => max(0, $grandTotal - $subtotal),
        ]);

        return $batch->load('items.masterProduct', 'items.sku', 'vendor', 'upload');
    }

    // ─── STEP 5: Approve Batch ──────────────────────────────────

    public function approveBatch(PurchaseBatch $batch): PurchaseBatch
    {
        if ($batch->status !== 'draft' && $batch->status !== 'review') {
            throw new \Exception("Batch can only be approved from draft/review status. Current: {$batch->status}");
        }

        // Validate all items are matched
        $unmapped = $batch->items()->where('product_matched', false)->count();

        $batch->update([
            'status' => 'approved',
        ]);

        // Register payable to supplier (vendor balance) once when batch is approved.
        $this->applyVendorOutstandingBalanceOnApproval($batch);

        return $batch->refresh();
    }

    // ─── STEP 6: Receive Items ──────────────────────────────────

    /**
     * Sales channel used for SKU compatibility when receiving into a warehouse.
     * Legacy physical locations (المحل) may have no channel_id — map them to the main store channel.
     */
    public function resolveReceiveChannelIdForLocation(int $locationId): ?int
    {
        if ($locationId <= 0) {
            return null;
        }

        $loc = InventoryLocation::query()->find($locationId);
        if (! $loc) {
            return null;
        }

        if ($loc->channel_id !== null) {
            return (int) $loc->channel_id;
        }

        $name = mb_strtolower((string) ($loc->name ?? ''));
        $type = mb_strtolower((string) ($loc->type ?? ''));
        foreach (['store', 'shop', 'physical', 'main', 'المحل', 'المخزن', 'متجر'] as $needle) {
            if (str_contains($name, $needle) || str_contains($type, $needle)) {
                $storeId = ChannelStockResolver::resolveMainStoreChannelId();

                return $storeId > 0 ? $storeId : null;
            }
        }

        return null;
    }

    public function receiveBatch(PurchaseBatch $batch, array $receivedItems, int $locationId): PurchaseBatch
    {
        $this->lastAutoCreatedItems = [];

        if ($batch->status !== 'approved') {
            throw new \Exception("Batch must be approved before receiving. Current: {$batch->status}");
        }

        $batchCostId = 'BC-'.$batch->batch_number;
        $hasRemainingQuantityColumn = Schema::hasColumn('purchase_batch_items', 'remaining_quantity');
        // FIX: preserve null for non-channel warehouses — casting null to (int) gives 0,
        // which makes isSkuCompatibleWithReceiveChannel() treat it as a real channel (id=0)
        // and triggers wrong/duplicate SKU creation instead of reusing the generic SKU.
        $locationChannelId = $this->resolveReceiveChannelIdForLocation($locationId);
        // IMPORTANT:
        // Receiving may happen when Auth context is missing/expired.
        // Always rely on the batch owner for auto-created records.
        $batchUserId = (int) ($batch->user_id ?? 0);
        if ($batchUserId <= 0) {
            throw new \Exception('Batch is missing user_id; cannot auto-create SKUs.');
        }

        $prepared = [];
        $unresolved = [];

        foreach ($receivedItems as $itemData) {
            $item = PurchaseBatchItem::find($itemData['id']);
            if (! $item || $item->purchase_batch_id !== $batch->id) {
                continue;
            }

            $receivedQty = floatval($itemData['received_quantity'] ?? $item->quantity);
            $variance = $receivedQty - floatval($item->quantity);
            // Always resolve to a SKU that belongs to the invoice warehouse channel (never display-pool siblings).
            $resolvedSkuId = $this->resolveSkuIdForBatchItem(
                $item,
                $locationChannelId,
                $batchUserId,
                $this->shouldAllowAutoCreateSkuForReceiveLine($item, $locationChannelId)
            );

            if ($receivedQty > 0 && ! $resolvedSkuId) {
                $label = $item->raw_description ?: ('item#'.$item->id);
                if ((int) ($item->sku_id ?? 0) > 0) {
                    $skuCode = Sku::query()->whereKey((int) $item->sku_id)->value('sku');
                    if ($skuCode) {
                        $label = trim((string) $skuCode).' ('.$label.')';
                    }
                }
                $unresolved[] = $label;
            }

            $prepared[] = [
                'item' => $item,
                'receivedQty' => $receivedQty,
                'variance' => $variance,
                'resolvedSkuId' => $resolvedSkuId,
                'varianceNotes' => $itemData['variance_notes'] ?? null,
            ];
        }

        if (! empty($unresolved)) {
            $sample = implode(', ', array_slice($unresolved, 0, 3));
            throw new \Exception("Some rows are not mapped to a valid SKU for the selected location/channel: {$sample}");
        }

        foreach ($prepared as $row) {
            /** @var PurchaseBatchItem $item */
            $item = $row['item'];
            $receivedQty = (float) $row['receivedQty'];
            $variance = (float) $row['variance'];
            $resolvedSkuId = $row['resolvedSkuId'];
            $unitCost = (float) ($item->unit_price ?? 0);
            $itemPayload = [
                'received_quantity' => $receivedQty,
                'variance_quantity' => $variance != 0 ? $variance : null,
                'variance_notes' => $row['varianceNotes'],
                'batch_cost_id' => $batchCostId,
            ];
            if ($hasRemainingQuantityColumn) {
                $itemPayload['remaining_quantity'] = $receivedQty;
            }
            $item->update($itemPayload);

            // Update master product purchase cost snapshot from this invoice.
            // We store it on the master product (not SKU) because the same product can have multiple listings/SKUs.
            if ($item->master_product_id && $unitCost > 0) {
                $master = MasterProduct::query()->whereKey((int) $item->master_product_id)->first();
                if ($master) {
                    $currentCost = (float) ($master->cost_price ?? 0);
                    $master->update([
                        'last_purchase_price' => $unitCost,
                        // Keep a usable fallback cost price if it's missing.
                        'cost_price' => $currentCost > 0 ? $currentCost : $unitCost,
                    ]);
                }
            }

            // Move stock to inventory (only if product is matched and has SKU)
            if ($resolvedSkuId && $receivedQty > 0) {
                if ((int) ($item->sku_id ?? 0) !== (int) $resolvedSkuId) {
                    $item->update(['sku_id' => $resolvedSkuId]);
                }
                $stockLocationId = $this->resolveStockLocationIdForSku((int) $resolvedSkuId, $locationId);
                $this->addToInventory($resolvedSkuId, $stockLocationId, $receivedQty, $batch, $batchCostId);
            }
        }

        $batch->update([
            'status' => 'received',
            'location_id' => $locationId,
            'received_at' => now(),
        ]);

        return $batch->refresh()->load('items.masterProduct', 'items.sku');
    }

    /**
     * Adjust vendor (+ linked supplier) payable when totals change on an already-approved batch.
     */
    public function adjustVendorPayableBalance(int $vendorId, float $delta): void
    {
        if (abs($delta) < 0.0000001 || $vendorId <= 0) {
            return;
        }

        $vendor = Vendor::find($vendorId);
        if (! $vendor) {
            return;
        }

        if ($delta > 0) {
            Vendor::where('id', $vendorId)->increment('current_balance', $delta);
        } else {
            $current = (float) ($vendor->current_balance ?? 0);
            $vendor->update([
                'current_balance' => max(0, $current + $delta),
            ]);
        }

        $this->syncSupplierBalanceFromVendor($vendorId, $delta);
    }

    public function cancelBatch(PurchaseBatch $batch, bool $keepStock = false): PurchaseBatch
    {
        return DB::transaction(function () use ($batch, $keepStock) {
            $batch->loadMissing('items');

            if ($batch->status === 'cancelled') {
                return $batch->refresh()->load('items.masterProduct', 'items.sku');
            }

            if ($batch->status === 'received' && ! $keepStock) {
                $this->rollbackReceivedInventory($batch);
            }

            if (in_array($batch->status, ['approved', 'received'], true)) {
                $this->revertVendorOutstandingBalanceOnCancellation($batch);
            }

            $batch->update([
                'status' => 'cancelled',
            ]);

            return $batch->refresh()->load('items.masterProduct', 'items.sku');
        });
    }

    /**
     * Resolve the SKU that should receive stock for a batch line (same rules as receiveBatch).
     *
     * @param  bool  $allowAutoCreateSku  When false, never spawn MPxxxx listings (manual purchase UI).
     */
    public function resolveSkuIdForBatchItemLine(
        PurchaseBatchItem $item,
        ?int $locationId = null,
        ?int $batchUserId = null,
        bool $allowAutoCreateSku = false
    ): ?int {
        $locationChannelId = null;
        if ($locationId !== null && $locationId > 0) {
            $locationChannelId = $this->resolveReceiveChannelIdForLocation((int) $locationId);
        }

        return $this->resolveSkuIdForBatchItem($item, $locationChannelId, $batchUserId, $allowAutoCreateSku);
    }

    /**
     * Resolve (or create) the SKU that may receive stock for a manual purchase invoice line.
     */
    public function resolveSkuIdForManualPurchaseLine(
        int $masterProductId,
        int $requestedSkuId,
        int $locationId,
        int $batchUserId
    ): ?int {
        if ($masterProductId <= 0 || $locationId <= 0 || $batchUserId <= 0) {
            return null;
        }

        $stub = new PurchaseBatchItem([
            'master_product_id' => $masterProductId,
            'sku_id' => $requestedSkuId > 0 ? $requestedSkuId : null,
            'product_matched' => $requestedSkuId > 0,
        ]);

        return $this->resolveSkuIdForBatchItemLine($stub, $locationId, $batchUserId, true);
    }

    /**
     * Whether receiveBatch may create or remap a channel-scoped listing for this line.
     */
    private function shouldAllowAutoCreateSkuForReceiveLine(PurchaseBatchItem $item, ?int $receiveChannelId): bool
    {
        if ((int) ($item->master_product_id ?? 0) <= 0) {
            return empty($item->sku_id) && ! (bool) ($item->product_matched ?? false);
        }

        if ((int) ($item->sku_id ?? 0) <= 0) {
            return true;
        }

        $sku = Sku::query()->find((int) $item->sku_id);
        if (! $sku) {
            return true;
        }

        return ! $this->isSkuCompatibleWithReceiveChannel($sku, $receiveChannelId);
    }

    /**
     * Post received purchase stock to the warehouse selected on the invoice — never redirect to another channel's location.
     */
    public function resolveStockLocationIdForSku(int $skuId, int $selectedLocationId): int
    {
        return $selectedLocationId;
    }

    private function resolveEffectiveInventoryLocationId(int $skuId, int $selectedLocationId): int
    {
        return $this->resolveStockLocationIdForSku($skuId, $selectedLocationId);
    }

    /**
     * Whether a SKU may receive stock at the given warehouse/location (channel rules).
     */
    public function isSkuCompatibleWithReceiveLocation(Sku $sku, int $locationId): bool
    {
        $receiveChannelId = null;
        if ($locationId > 0) {
            $rawChannelId = InventoryLocation::query()->whereKey($locationId)->value('channel_id');
            $receiveChannelId = $rawChannelId !== null ? (int) $rawChannelId : null;
        }

        return $this->isSkuCompatibleWithReceiveChannel($sku, $receiveChannelId);
    }

    /**
     * SKU to use when adjusting stock on an already-received purchase line.
     * Prefers the explicit line SKU, then where this batch already posted stock, then resolver fallback.
     */
    public function resolveStockSkuIdForReceivedLineEdit(
        PurchaseBatch $batch,
        PurchaseBatchItem $item,
        int $receiveLocationId,
        ?int $batchUserId = null,
        ?int $preferredSkuId = null
    ): ?int {
        if ($preferredSkuId > 0) {
            $preferred = Sku::query()->find($preferredSkuId);
            if ($preferred && $this->isSkuCompatibleWithReceiveLocation($preferred, $receiveLocationId)) {
                return $preferredSkuId;
            }
            // Wrong-channel SKU on the line — do not silently redirect stock to another listing.
        }

        if ((int) ($item->sku_id ?? 0) > 0) {
            $current = Sku::query()->find((int) $item->sku_id);
            if ($current && $this->isSkuCompatibleWithReceiveLocation($current, $receiveLocationId)) {
                return (int) $item->sku_id;
            }
        }

        $postedSkuId = $this->findBatchPostedSkuIdForItem($batch, $item);
        if ($postedSkuId > 0) {
            return $postedSkuId;
        }

        return $this->resolveSkuIdForBatchItemLine(
            $item,
            $receiveLocationId > 0 ? $receiveLocationId : null,
            $batchUserId,
            false
        );
    }

    /**
     * Net quantity posted to inventory for this batch + SKU (IN minus OUT).
     */
    private function netBatchStockPostedForSku(PurchaseBatch $batch, int $skuId): float
    {
        $in = (float) InventoryTransaction::query()
            ->where('reference_type', PurchaseBatch::class)
            ->where('reference_id', $batch->id)
            ->where('sku_id', $skuId)
            ->where('type', 'IN')
            ->sum('quantity');
        $out = (float) InventoryTransaction::query()
            ->where('reference_type', PurchaseBatch::class)
            ->where('reference_id', $batch->id)
            ->where('sku_id', $skuId)
            ->where('type', 'OUT')
            ->sum('quantity');

        return $in - $out;
    }

    /**
     * When a received line was stocked on a different SKU than the one shown on the invoice,
     * move batch stock to the target SKU and align to the line quantity (fixes legacy mis-posts).
     */
    public function reconcileReceivedLineStockToTargetSku(
        PurchaseBatch $batch,
        PurchaseBatchItem $item,
        int $targetSkuId,
        int $receiveLocationId,
        float $targetQty,
        ?string $note = null
    ): void {
        if ($targetSkuId <= 0 || $receiveLocationId <= 0) {
            return;
        }

        $note = $note ?: "Purchase batch {$batch->batch_number} line {$item->id} stock reconcile";

        $postedSkuId = $this->findBatchPostedSkuIdForItem($batch, $item);
        if ($postedSkuId && $postedSkuId !== $targetSkuId) {
            $postedNet = $this->netBatchStockPostedForSku($batch, $postedSkuId);
            if ($postedNet > 0.0000001) {
                $this->applyReceivedStockDelta(
                    $batch,
                    $postedSkuId,
                    $receiveLocationId,
                    -$postedNet,
                    $note.' (clear mis-posted SKU)'
                );
            }
        }

        $targetNet = $this->netBatchStockPostedForSku($batch, $targetSkuId);
        $need = (float) $targetQty - $targetNet;
        if (abs($need) > 0.0000001) {
            $this->applyReceivedStockDelta(
                $batch,
                $targetSkuId,
                $receiveLocationId,
                $need,
                $note.' (align line quantity)'
            );
        }
    }

    /**
     * SKU that already received IN transactions for this batch line (same master when possible).
     */
    private function findBatchPostedSkuIdForItem(PurchaseBatch $batch, PurchaseBatchItem $item): ?int
    {
        $inBySku = InventoryTransaction::query()
            ->where('reference_type', PurchaseBatch::class)
            ->where('reference_id', $batch->id)
            ->where('type', 'IN')
            ->selectRaw('sku_id, SUM(quantity) as qty')
            ->groupBy('sku_id')
            ->pluck('qty', 'sku_id');

        if ($inBySku->isEmpty()) {
            return null;
        }

        $masterId = (int) ($item->master_product_id ?? 0);
        $candidates = [];
        foreach ($inBySku as $skuId => $qty) {
            $skuId = (int) $skuId;
            if ($skuId <= 0) {
                continue;
            }
            if ($masterId > 0) {
                $matchesMaster = Sku::query()
                    ->whereKey($skuId)
                    ->whereHas('offer', function ($q) use ($masterId) {
                        $q->where('master_product_id', $masterId);
                    })
                    ->exists();
                if (! $matchesMaster) {
                    continue;
                }
            }
            $candidates[$skuId] = (float) $qty;
        }

        if (empty($candidates) && (int) ($item->sku_id ?? 0) > 0) {
            $lineSkuId = (int) $item->sku_id;
            if ($inBySku->has($lineSkuId)) {
                return $lineSkuId;
            }
        }

        if (empty($candidates)) {
            $fallback = (int) ($inBySku->sortByDesc(fn ($qty) => (float) $qty)->keys()->first() ?? 0);

            return $fallback > 0 ? $fallback : null;
        }

        arsort($candidates);

        return (int) array_key_first($candidates);
    }

    private function resolveSkuIdForBatchItem(
        PurchaseBatchItem $item,
        ?int $preferredChannelId = null,
        ?int $batchUserId = null,
        bool $allowAutoCreateSku = false
    ): ?int {
        $receiveChannelId = ! empty($preferredChannelId) ? (int) $preferredChannelId : null;

        if ($item->sku_id) {
            $currentSku = Sku::find((int) $item->sku_id);
            if ($currentSku && $this->isSkuCompatibleWithReceiveChannel($currentSku, $receiveChannelId)) {
                return (int) $currentSku->id;
            }
        }

        if ($item->master_product_id) {
            $hinted = $this->resolveSkuIdFromLineHints($item, $receiveChannelId);
            if ($hinted) {
                return $hinted;
            }
        }

        if (! $item->master_product_id) {
            if (! $allowAutoCreateSku) {
                return null;
            }
            $createdSkuId = $this->ensureMasterProductAndSkuForUnmappedItem($item, $receiveChannelId, $batchUserId);
            if ($createdSkuId) {
                return $createdSkuId;
            }

            return null;
        }

        $resolved = $this->findBestSkuForReceiveChannel((int) $item->master_product_id, $receiveChannelId);
        if ($resolved) {
            return $resolved;
        }

        if (! $allowAutoCreateSku) {
            return null;
        }

        return $this->ensureFallbackSkuForBatchItem($item, $receiveChannelId, $batchUserId);
    }

    /**
     * When sku_id was not persisted on the batch line (UI/API gap) but the invoice text still contains
     * a merchant code (e.g. PHY32), resolve that SKU for the same master product instead of defaulting to MPxxxx generic stock.
     */
    private function resolveSkuIdFromLineHints(PurchaseBatchItem $item, ?int $receiveChannelId): ?int
    {
        $masterId = (int) ($item->master_product_id ?? 0);
        if ($masterId <= 0) {
            return null;
        }
        $text = trim((string) ($item->raw_description ?? ''));
        if ($text === '') {
            return null;
        }
        if (! preg_match_all('/\b([A-Za-z][A-Za-z0-9\-]{2,39})\b/u', $text, $matches)) {
            return null;
        }
        foreach (array_unique($matches[1]) as $token) {
            $t = trim((string) $token);
            if (strlen($t) < 4) {
                continue;
            }
            if (preg_match('/^MP\d+$/i', $t)) {
                continue;
            }
            $rawLower = Str::lower($t);
            $sku = Sku::query()
                ->with('offer')
                ->where(function ($q) use ($rawLower) {
                    $q->whereRaw('LOWER(sku) = ?', [$rawLower])
                        ->orWhereRaw('LOWER(marketplace_id) = ?', [$rawLower]);
                })
                ->whereHas('offer', fn ($q) => $q->where('master_product_id', $masterId))
                ->when($receiveChannelId !== null, fn ($q) => $q->where('channel_id', $receiveChannelId))
                ->when($receiveChannelId === null, fn ($q) => $q->whereNull('channel_id'))
                ->orderBy('id')
                ->first();
            if (! $sku) {
                continue;
            }
            if ($this->isSkuCompatibleWithReceiveChannel($sku, $receiveChannelId)) {
                return (int) $sku->id;
            }
        }

        return null;
    }

    private function ensureMasterProductAndSkuForUnmappedItem(PurchaseBatchItem $item, ?int $preferredChannelId = null, ?int $batchUserId = null): ?int
    {
        $userId = (int) ($batchUserId ?? 0);
        if ($userId <= 0) {
            $userId = (int) PurchaseBatch::query()->whereKey($item->purchase_batch_id)->value('user_id');
        }
        if ($userId <= 0) {
            throw new \Exception('Cannot resolve user_id for auto-created products.');
        }

        $rawName = trim((string) ($item->raw_description ?? ''));
        if ($rawName === '') {
            $rawName = 'Auto Product '.$item->id;
        }
        $unitCost = (float) ($item->unit_price ?? 0);
        $normalizedName = mb_strtolower($rawName);

        $master = MasterProduct::query()
            ->whereRaw('LOWER(internal_name) = ?', [$normalizedName])
            ->orderBy('id')
            ->first();

        if (! $master) {
            $master = MasterProduct::create([
                'internal_name' => $rawName,
                'cost_price' => $unitCost > 0 ? $unitCost : 0,
                'selling_price' => $unitCost > 0 ? $unitCost : 0,
                'is_active' => true,
                'user_id' => $userId,
            ]);
        } elseif ($unitCost > 0 && (float) ($master->cost_price ?? 0) <= 0) {
            $master->update([
                'cost_price' => $unitCost,
            ]);
        }

        $item->update([
            'master_product_id' => (int) $master->id,
            'product_matched' => true,
        ]);

        $skuId = $this->ensureFallbackSkuForBatchItem($item->fresh(), $preferredChannelId, $userId);
        if ($skuId) {
            $this->lastAutoCreatedItems[(string) $item->id] = [
                'item_id' => (int) $item->id,
                'description' => $rawName,
                'master_product_id' => (int) $master->id,
                'sku_id' => (int) $skuId,
                'quantity' => (float) ($item->quantity ?? 0),
                'unit_price' => $unitCost,
            ];
        }

        return $skuId;
    }

    private function ensureFallbackSkuForBatchItem(PurchaseBatchItem $item, ?int $preferredChannelId = null, ?int $batchUserId = null): ?int
    {
        if (! $item->master_product_id) {
            return null;
        }

        $userId = (int) ($batchUserId ?? 0);
        if ($userId <= 0) {
            $userId = (int) PurchaseBatch::query()->whereKey($item->purchase_batch_id)->value('user_id');
        }
        if ($userId <= 0) {
            throw new \Exception('Cannot resolve user_id for auto-created SKUs.');
        }

        $offer = InventoryOffer::firstOrCreate(
            [
                'master_product_id' => (int) $item->master_product_id,
                'type' => 'single',
            ],
            [
                'name' => 'Default Offer',
                'components' => null,
                'user_id' => $userId,
            ]
        );

        $master = MasterProduct::find((int) $item->master_product_id);
        $baseName = trim((string) ($master?->internal_name ?: $item->raw_description ?: ('MP-'.$item->master_product_id)));
        $channelId = ! empty($preferredChannelId) ? (int) $preferredChannelId : null;
        $unitCost = (float) ($item->unit_price ?? 0);
        $baseSku = strtoupper('MP'.$item->master_product_id);

        // Re-use any existing listing for this master on the target channel (any offer).
        $existing = Sku::query()
            ->whereHas('offer', fn ($q) => $q->where('master_product_id', (int) $item->master_product_id))
            ->when($channelId, fn ($q) => $q->where('channel_id', $channelId), fn ($q) => $q->whereNull('channel_id'))
            ->orderBy('id')
            ->first();
        if ($existing) {
            return (int) $existing->id;
        }

        for ($attempt = 0; $attempt < 50; $attempt++) {
            $candidate = $attempt === 0 ? $baseSku : ($baseSku.'-'.($attempt + 1));

            if (SkuUniquenessGuard::existsForUser((int) $userId, $candidate)) {
                continue;
            }

            $created = Sku::create([
                'offer_id' => (int) $offer->id,
                'channel_id' => $channelId,
                'sku' => $candidate,
                'name' => $baseName,
                'cost_price' => $unitCost > 0 ? $unitCost : 0,
                'selling_price' => $unitCost > 0 ? $unitCost : 0,
                'marketplace_id' => null,
                'user_id' => $userId,
            ]);

            return (int) $created->id;
        }

        return null;
    }

    private function isSkuCompatibleWithReceiveChannel(Sku $sku, ?int $receiveChannelId): bool
    {
        $skuChannelId = ! empty($sku->channel_id) ? (int) $sku->channel_id : null;

        // Receiving into a channel-linked location:
        // must use SKU of the same channel only.
        if ($receiveChannelId !== null) {
            return $skuChannelId === $receiveChannelId;
        }

        // Receiving into a non-channel warehouse:
        // only generic SKUs are valid to avoid cross-channel stock contamination.
        return $skuChannelId === null;
    }

    private function findBestSkuForReceiveChannel(int $masterProductId, ?int $receiveChannelId): ?int
    {
        $baseQuery = Sku::query()
            ->whereHas('offer', function ($q) use ($masterProductId) {
                $q->where('master_product_id', $masterProductId);
            });

        if ($receiveChannelId !== null) {
            $exact = (clone $baseQuery)
                ->where('channel_id', $receiveChannelId)
                ->orderBy('id')
                ->first();
            if ($exact) {
                return (int) $exact->id;
            }

            // For channel-linked receiving, never fallback to generic SKU.
            // If exact channel SKU does not exist, caller will create a channel-scoped fallback.
            return null;
        }

        $generic = (clone $baseQuery)
            ->whereNull('channel_id')
            ->orderBy('id')
            ->first();
        if ($generic) {
            return (int) $generic->id;
        }

        return null;
    }

    private function applyVendorOutstandingBalanceOnApproval(PurchaseBatch $batch): void
    {
        if (! $batch->vendor_id) {
            return;
        }

        $outstanding = $this->computeOpenPayableFromBatch($batch);
        if ($outstanding <= 0) {
            return;
        }

        Vendor::where('id', $batch->vendor_id)->increment('current_balance', $outstanding);
        $this->syncSupplierBalanceFromVendor((int) $batch->vendor_id, $outstanding);
    }

    private function revertVendorOutstandingBalanceOnCancellation(PurchaseBatch $batch): void
    {
        if (! $batch->vendor_id) {
            return;
        }

        $outstanding = $this->calculateOutstandingAmount($batch);
        if ($outstanding <= 0) {
            return;
        }

        $vendor = Vendor::find($batch->vendor_id);
        if (! $vendor) {
            return;
        }

        $current = (float) ($vendor->current_balance ?? 0);
        $vendor->update([
            'current_balance' => max(0, $current - $outstanding),
        ]);
        $this->syncSupplierBalanceFromVendor((int) $batch->vendor_id, -$outstanding);
    }

    private function calculateOutstandingAmount(PurchaseBatch $batch): float
    {
        return $this->computeOpenPayableFromBatch($batch);
    }

    /**
     * Open accounts-payable for a purchase batch from [PAYMENT] meta.
     * Cash purchases create no vendor payable (money settled at purchase time).
     */
    public function computeOpenPayableFromBatch(PurchaseBatch $batch): float
    {
        $grandTotal = (float) ($batch->grand_total ?? $batch->subtotal ?? 0);

        return $this->computeOpenPayableFromNotes((string) ($batch->notes ?? ''), $grandTotal);
    }

    private function computeOpenPayableFromNotes(string $notes, float $grandTotal): float
    {
        if ($grandTotal <= 0) {
            return 0.0;
        }

        $meta = $this->extractPaymentMetaFromNotes($notes);
        if (($meta['type'] ?? '') === 'cash') {
            return 0.0;
        }

        if ($meta['remaining'] !== null) {
            return max(0.0, min((float) $meta['remaining'], $grandTotal));
        }

        if ($meta['paid'] !== null) {
            $paid = max(0.0, min((float) $meta['paid'], $grandTotal));

            return max(0.0, $grandTotal - $paid);
        }

        return max(0.0, $grandTotal);
    }

    /**
     * UI / supplier-statement payment status from settled amounts (not workflow status like received).
     */
    public static function resolvePaymentMetaStatus(
        string $batchStatus,
        float $paid,
        float $remaining,
        ?string $paymentType = null
    ): string {
        $batchStatus = strtolower($batchStatus);
        if ($batchStatus === 'cancelled') {
            return 'cancelled';
        }
        if ($batchStatus === 'draft') {
            return 'draft';
        }
        if ($batchStatus === 'review') {
            return 'review';
        }
        if ($remaining <= 0.00001) {
            return 'paid';
        }
        if ($paid > 0.00001) {
            return 'partially_paid';
        }

        return 'confirmed';
    }

    /**
     * Record a completed cash settlement in inv_payments for audit (Finance → Payments).
     * Does not change vendor balance (cash invoices never increase AP after computeOpenPayable fix).
     */
    public function syncAutoCashPurchasePayment(PurchaseBatch $batch): void
    {
        $batch->loadMissing('vendor');
        if (! $batch->vendor_id) {
            return;
        }
        if ((string) $batch->status !== 'received') {
            return;
        }

        $meta = $this->extractPaymentMetaFromNotes((string) ($batch->notes ?? ''));
        if (($meta['type'] ?? '') !== 'cash') {
            return;
        }

        $total = (float) ($batch->grand_total ?? $batch->subtotal ?? 0);
        if ($total <= 0.00001) {
            return;
        }

        $tag = 'AUTO_PURCHASE_BATCH:'.$batch->id;
        if (Payment::query()->where('notes', 'like', '%'.$tag.'%')->exists()) {
            return;
        }

        $vendor = Vendor::query()->find((int) $batch->vendor_id);
        if (! $vendor) {
            return;
        }

        $paymentDate = $batch->invoice_date
            ? $batch->invoice_date->toDateString()
            : ($batch->created_at?->toDateString() ?? now()->toDateString());

        $amount = round($total, 2);
        app(TreasurySpendGuard::class)->assertPaymentAllowedForUser((int) $batch->user_id, $amount);

        Payment::query()->create([
            'payment_number' => $this->generateNextPurchaseCashPaymentNumber(),
            'payee_type' => Vendor::class,
            'payee_id' => (int) $vendor->id,
            'payee_name' => (string) ($vendor->name ?? ''),
            'warehouse_id' => $batch->location_id,
            'amount' => $amount,
            'payment_method' => 'Cash',
            'payment_date' => $paymentDate,
            'reference_type' => PurchaseBatch::class,
            'reference_id' => (int) $batch->id,
            'status' => 'completed',
            'notes' => trim($tag.' '.($batch->invoice_number ?: $batch->batch_number ?: '')),
            'user_id' => $batch->user_id,
        ]);
    }

    private function generateNextPurchaseCashPaymentNumber(): string
    {
        $prefix = 'PAY-';
        $last = (string) Payment::query()->whereNotNull('payment_number')
            ->where('payment_number', 'like', $prefix.'%')
            ->orderByDesc('id')
            ->value('payment_number');

        $lastNum = (int) preg_replace('/\D+/', '', $last ?: '');
        $next = max(1, $lastNum + 1);
        $candidate = $prefix.str_pad((string) $next, 3, '0', STR_PAD_LEFT);

        while (Payment::query()->where('payment_number', $candidate)->exists()) {
            $next++;
            $candidate = $prefix.str_pad((string) $next, 3, '0', STR_PAD_LEFT);
        }

        return $candidate;
    }

    private function syncSupplierBalanceFromVendor(int $vendorId, float $delta): void
    {
        if ($delta == 0.0 || $vendorId <= 0) {
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
            'balance' => max(0, $current + $delta),
        ]);
    }

    private function extractPaymentMetaFromNotes(string $notes): array
    {
        $line = collect(explode("\n", $notes))
            ->first(fn ($entry) => str_starts_with(trim((string) $entry), '[PAYMENT]'));

        $parseNumber = function (?string $raw): ?float {
            if ($raw === null || trim($raw) === '') {
                return null;
            }

            return (float) $raw;
        };

        if (! $line) {
            return ['paid' => null, 'remaining' => null, 'type' => null, 'status' => null];
        }

        preg_match('/paid=([0-9]+(?:\.[0-9]+)?)/i', $line, $paidMatch);
        preg_match('/remaining=([0-9]+(?:\.[0-9]+)?)/i', $line, $remainingMatch);
        preg_match('/type=(cash|credit)/i', $line, $typeMatch);
        preg_match('/status=([a-z_]+)/i', $line, $statusMatch);

        return [
            'paid' => $parseNumber($paidMatch[1] ?? null),
            'remaining' => $parseNumber($remainingMatch[1] ?? null),
            'type' => strtolower((string) ($typeMatch[1] ?? '')) ?: null,
            'status' => strtolower((string) ($statusMatch[1] ?? '')) ?: null,
        ];
    }

    // ═══════════════════════════════════════════════════════════════
    // Private helpers
    // ═══════════════════════════════════════════════════════════════

    private function extractFromPdf(string $path): string
    {
        // Simple text extraction using PHP - reads text content from PDF
        // For production, install smalot/pdfparser: composer require smalot/pdfparser
        if (class_exists(\Smalot\PdfParser\Parser::class)) {
            $parser = new \Smalot\PdfParser\Parser;
            $pdf = $parser->parseFile($path);

            return $pdf->getText();
        }

        // Fallback: read raw content and extract readable text
        $content = file_get_contents($path);

        // Try to extract text between stream markers in PDF
        $text = '';
        if (preg_match_all('/stream\s*\n(.*?)\nendstream/s', $content, $matches)) {
            foreach ($matches[1] as $stream) {
                $decoded = @gzuncompress($stream);
                if ($decoded) {
                    // Extract text operators (Tj, TJ, ')
                    if (preg_match_all('/\((.*?)\)\s*Tj/s', $decoded, $textMatches)) {
                        $text .= implode(' ', $textMatches[1])."\n";
                    }
                }
            }
        }

        if (empty(trim($text))) {
            // If no text extracted, use Gemini vision to read the PDF
            // Convert first page to base64 and send to AI
            return $this->extractViaGeminiVision($path, 'pdf');
        }

        return $text;
    }

    private function extractFromImage(string $path): string
    {
        // Use Gemini Vision API for OCR
        return $this->extractViaGeminiVision($path, 'image');
    }

    private function extractViaGeminiVision(string $path, string $type): string
    {
        $apiKey = config('services.gemini.api_key');

        if (empty($apiKey)) {
            Log::warning('Gemini Vision key missing. Falling back to manual-review placeholder text.', [
                'path' => $path,
                'type' => $type,
            ]);

            // Graceful fallback: keep pipeline alive so user can review/edit batch manually.
            return "OCR_UNAVAILABLE\nSOURCE_FILE: ".basename($path)."\nPlease review and add line items manually.";
        }

        $model = config('services.gemini.model', 'gemini-1.5-flash');
        $url = "https://generativelanguage.googleapis.com/v1beta/models/{$model}:generateContent?key=".$apiKey;

        Log::info('Attempting Gemini Vision extraction', ['path' => $path, 'type' => $type, 'model' => $model]);

        $fileContent = file_get_contents($path);
        $base64 = base64_encode($fileContent);

        $mimeType = match ($type) {
            'pdf' => 'application/pdf',
            default => mime_content_type($path) ?: 'image/jpeg',
        };

        $prompt = 'Extract ALL text from this document. This is a purchase invoice or supplier document. '
            .'Extract every piece of text you can see including: supplier name, invoice number, dates, '
            .'item descriptions, quantities, prices, totals. Return the raw text as-is, preserving the structure.';

        try {
            $response = \Illuminate\Support\Facades\Http::timeout(60)->post($url, [
                'contents' => [
                    [
                        'parts' => [
                            ['text' => $prompt],
                            [
                                'inline_data' => [
                                    'mime_type' => $mimeType,
                                    'data' => $base64,
                                ],
                            ],
                        ],
                    ],
                ],
            ]);

            if ($response->successful()) {
                return $response->json('candidates.0.content.parts.0.text') ?? '';
            }

            Log::error('Gemini Vision extraction failed', [
                'status' => $response->status(),
                'body' => $response->body(),
            ]);

            return '';
        } catch (\Exception $e) {
            Log::error('Gemini Vision exception: '.$e->getMessage());

            return '';
        }
    }

    private function extractFromExcel(string $path): string
    {
        // Convert Excel to text representation
        $text = '';

        try {
            if (class_exists(\PhpOffice\PhpSpreadsheet\IOFactory::class)) {
                $spreadsheet = \PhpOffice\PhpSpreadsheet\IOFactory::load($path);
                $sheet = $spreadsheet->getActiveSheet();

                $data = $sheet->toArray(null, true, true, true);

                foreach ($data as $row) {
                    // Cast mixed cell values safely to string before trimming.
                    $rowText = array_filter(array_map(function ($cell) {
                        if ($cell === null) {
                            return '';
                        }
                        if (is_scalar($cell)) {
                            return trim((string) $cell);
                        }

                        return '';
                    }, $row), fn ($v) => $v !== '');
                    if (! empty($rowText)) {
                        $text .= implode(' | ', $rowText)."\n";
                    }
                }
            } else {
                // Fallback: read xlsx as zip and extract strings
                $zip = new \ZipArchive;
                if ($zip->open($path) === true) {
                    $sharedStrings = $zip->getFromName('xl/sharedStrings.xml');
                    if ($sharedStrings) {
                        $xml = simplexml_load_string($sharedStrings);
                        foreach ($xml->si as $si) {
                            $text .= (string) $si->t."\n";
                        }
                    }
                    $zip->close();
                }
            }
        } catch (\Exception $e) {
            Log::error('Excel extraction error: '.$e->getMessage());
        }

        return $text;
    }

    private function localParse(string $rawText, string $fileType): array
    {
        if (in_array(strtolower($fileType), ['xlsx', 'xls'], true)) {
            $excelStructured = $this->parseStructuredExcelText($rawText);
            if (! empty($excelStructured['items'])) {
                return $excelStructured;
            }
        }

        $lines = explode("\n", $rawText);
        $structured = [
            'supplier_name' => null,
            'invoice_number' => null,
            'invoice_date' => null,
            'currency' => 'EGP',
            'items' => [],
            'grand_total' => 0.00,
        ];

        $keywords = [
            'vendor' => ['vendor', 'supplier', 'المورد', 'شركة', 'مؤسسة', 'بائع'],
            'invoice' => ['invoice', 'bill', 'receipt', 'فاتورة', 'رقم الفاتورة', 'المستند'],
            'date' => ['date', 'تاريخ', 'يوم'],
            'total' => ['total', 'grand total', 'الإجمالي', 'الاجمالي', 'المبلغ المستحق'],
            'item_start' => ['item', 'description', 'product', 'qty', 'المنتج', 'البيان', 'الكمية'],
        ];

        foreach ($lines as $line) {
            $line = trim($line);
            if (empty($line)) {
                continue;
            }
            $looksLikeHeaderRow = str_contains($line, '|')
                && (
                    str_contains(Str::lower($line), 'invoice_number')
                    || str_contains(Str::lower($line), 'invoice date')
                    || str_contains(Str::lower($line), 'supplier_name')
                    || str_contains(Str::lower($line), 'product_description')
                    || str_contains(Str::lower($line), 'quantity')
                    || str_contains(Str::lower($line), 'unit_price')
                );

            // 1. Try to find Supplier
            if (! $structured['supplier_name'] && ! $looksLikeHeaderRow) {
                foreach ($keywords['vendor'] as $kw) {
                    if (Str::contains(Str::lower($line), $kw) && ! Str::contains(Str::lower($line), 'address')) {
                        $candidate = trim(str_ireplace($kw, '', $line), ' :|');
                        if ($candidate !== '' && ! str_contains(Str::lower($candidate), 'invoice_')) {
                            $structured['supplier_name'] = $candidate;
                        }
                        break;
                    }
                }
            }

            // 2. Try to find Invoice Number
            if (! $structured['invoice_number'] && ! $looksLikeHeaderRow) {
                foreach ($keywords['invoice'] as $kw) {
                    if (Str::contains(Str::lower($line), $kw)) {
                        $candidate = trim(str_ireplace($kw, '', $line), ' :|');
                        if ($candidate !== '' && ! str_contains(Str::lower($candidate), 'number')) {
                            $structured['invoice_number'] = $candidate;
                        }
                        break;
                    }
                }
            }

            // 3. Try to find Date
            if (! $structured['invoice_date']) {
                if (preg_match('/(\d{2,4}[-\/\.]\d{1,2}[-\/\.]\d{2,4})/', $line, $matches)) {
                    $structured['invoice_date'] = $matches[1];
                }
            }

            // 4. Try to find Grand Total
            foreach ($keywords['total'] as $kw) {
                if (Str::contains(Str::lower($line), $kw)) {
                    if (preg_match('/(\d{1,3}(?:,\d{3})*(?:\.\d+)?)/', $line, $matches)) {
                        $structured['grand_total'] = floatval(str_replace(',', '', $matches[1]));
                    }
                }
            }

            // 5. Item Extraction (Simplified)
            // Look for lines that look like: Desc | Qty | Price | Total
            if (preg_match('/^(.+?)\|?\s*(\d+(?:\.\d+)?)\s*\|?\s*(\d+(?:\.\d+)?)\s*\|?\s*(\d+(?:\.\d+)?)$/', $line, $matches)) {
                $structured['items'][] = [
                    'description' => trim($matches[1], ' |'),
                    'quantity' => floatval($matches[2]),
                    'unit_price' => floatval($matches[3]),
                    'total' => floatval($matches[4]),
                ];
            } elseif (count(explode('|', $line)) >= 3) {
                // Alternative for pipe separated
                $parts = explode('|', $line);
                $potentialQty = floatval(trim(end($parts)));
                if ($potentialQty > 0 && count($parts) >= 2) {
                    // This is a crude heuristic
                }
            }
        }

        // If no items found, try another pattern for pure text lines
        if (empty($structured['items'])) {
            foreach ($lines as $line) {
                if (preg_match('/^(.+?)\s+(\d+)\s+(\d+(?:\.\d+)?)$/', $line, $matches)) {
                    $structured['items'][] = [
                        'description' => trim($matches[1]),
                        'quantity' => floatval($matches[2]),
                        'unit_price' => floatval($matches[3]),
                        'total' => floatval($matches[2]) * floatval($matches[3]),
                    ];
                }
            }
        }

        return $structured;
    }

    private function parseStructuredExcelText(string $rawText): array
    {
        $structured = [
            'supplier_name' => null,
            'invoice_number' => null,
            'invoice_date' => null,
            'currency' => 'EGP',
            'items' => [],
            'grand_total' => 0.00,
        ];

        $lines = array_values(array_filter(array_map('trim', explode("\n", $rawText)), fn ($line) => $line !== ''));
        if (empty($lines)) {
            return $structured;
        }

        $headerIndex = -1;
        $headerParts = [];
        foreach ($lines as $idx => $line) {
            if (! str_contains($line, '|')) {
                continue;
            }
            $parts = array_values(array_map(fn ($v) => trim((string) $v), explode('|', $line)));
            $normalized = array_map(fn ($v) => Str::lower(str_replace([' ', '-'], '_', $v)), $parts);
            $headerHints = ['invoice_number', 'invoice_date', 'supplier_name', 'product_description', 'quantity', 'unit_price'];
            $headerHintsAr = [
                'رقم_الفاتورة',
                'تاريخ_الفاتورة',
                'اسم_المورد',
                'وصف_المنتج',
                'الكمية',
                'سعر_الشراء',
                'العملة',
                'ملاحظات',
                'sku',
            ];
            $hits = 0;
            foreach ($normalized as $cell) {
                foreach ($headerHints as $hint) {
                    if (str_contains($cell, $hint)) {
                        $hits++;
                        break;
                    }
                }
                if ($hits >= 3) {
                    continue;
                }
                foreach ($headerHintsAr as $hint) {
                    if (str_contains($cell, $hint)) {
                        $hits++;
                        break;
                    }
                }
            }
            if ($hits >= 3) {
                $headerIndex = $idx;
                $headerParts = $parts;
                break;
            }
        }

        if ($headerIndex < 0 || empty($headerParts)) {
            return $structured;
        }

        $map = [];
        foreach ($headerParts as $i => $headerCell) {
            $h = Str::lower(trim(str_replace(['-', ' '], '_', $headerCell)));
            if (str_contains($h, 'invoice_number') || ($h === 'invoice' && ! isset($map['invoice_number']))) {
                $map['invoice_number'] = $i;
            } elseif (str_contains($h, 'invoice_date') || ($h === 'date' && ! isset($map['invoice_date']))) {
                $map['invoice_date'] = $i;
            } elseif (str_contains($h, 'supplier_name') || str_contains($h, 'supplier') || str_contains($h, 'vendor')) {
                $map['supplier_name'] = $i;
            } elseif (str_contains($h, 'product_description') || str_contains($h, 'description') || str_contains($h, 'product') || str_contains($h, 'item')) {
                $map['description'] = $i;
            } elseif ($h === 'sku' || str_contains($h, 'sku_code') || str_contains($h, 'product_sku')) {
                $map['sku'] = $i;
            } elseif (str_contains($h, 'quantity') || $h === 'qty') {
                $map['quantity'] = $i;
            } elseif (str_contains($h, 'unit_price') || ($h === 'price' && ! isset($map['unit_price']))) {
                $map['unit_price'] = $i;
            } elseif ($h === 'total' || str_contains($h, 'line_total')) {
                $map['total'] = $i;
            } elseif (str_contains($h, 'currency')) {
                $map['currency'] = $i;
            } elseif (str_contains($h, 'notes') || str_contains($h, 'note')) {
                $map['notes'] = $i;
            }
            // Arabic headers
            elseif ((str_contains($h, 'رقم') && str_contains($h, 'فاتورة')) && ! isset($map['invoice_number'])) {
                $map['invoice_number'] = $i;
            } elseif (str_contains($h, 'تاريخ') && ! isset($map['invoice_date'])) {
                $map['invoice_date'] = $i;
            } elseif (str_contains($h, 'مورد') && ! isset($map['supplier_name'])) {
                $map['supplier_name'] = $i;
            } elseif ((str_contains($h, 'وصف') || str_contains($h, 'منتج')) && ! isset($map['description'])) {
                $map['description'] = $i;
            } elseif ((str_contains($h, 'كود') || str_contains($h, 'سكيو') || str_contains($h, 'sku')) && ! isset($map['sku'])) {
                $map['sku'] = $i;
            } elseif (str_contains($h, 'كمية') && ! isset($map['quantity'])) {
                $map['quantity'] = $i;
            } elseif (str_contains($h, 'سعر') && ! isset($map['unit_price'])) {
                $map['unit_price'] = $i;
            } elseif ((str_contains($h, 'عملة') || str_contains($h, 'العملة')) && ! isset($map['currency'])) {
                $map['currency'] = $i;
            } elseif (str_contains($h, 'ملاحظات') && ! isset($map['notes'])) {
                $map['notes'] = $i;
            }
        }

        $dataLines = array_slice($lines, $headerIndex + 1);
        foreach ($dataLines as $line) {
            if (! str_contains($line, '|')) {
                continue;
            }

            $parts = array_values(array_map(fn ($v) => trim((string) $v), explode('|', $line)));
            if (empty(array_filter($parts, fn ($v) => $v !== ''))) {
                continue;
            }

            $description = isset($map['description']) ? trim((string) ($parts[$map['description']] ?? '')) : '';
            $sku = isset($map['sku']) ? trim((string) ($parts[$map['sku']] ?? '')) : '';
            $quantity = isset($map['quantity']) ? (float) str_replace(',', '', (string) ($parts[$map['quantity']] ?? '0')) : 0.0;
            $unitPrice = isset($map['unit_price']) ? (float) str_replace(',', '', (string) ($parts[$map['unit_price']] ?? '0')) : 0.0;
            $lineTotal = isset($map['total']) ? (float) str_replace(',', '', (string) ($parts[$map['total']] ?? '0')) : 0.0;
            if ($lineTotal <= 0 && $quantity > 0) {
                $lineTotal = $quantity * $unitPrice;
            }

            if (! $structured['invoice_number'] && isset($map['invoice_number'])) {
                $invNo = trim((string) ($parts[$map['invoice_number']] ?? ''));
                $structured['invoice_number'] = $invNo !== '' ? $invNo : $structured['invoice_number'];
            }
            if (! $structured['invoice_date'] && isset($map['invoice_date'])) {
                $invDate = trim((string) ($parts[$map['invoice_date']] ?? ''));
                $structured['invoice_date'] = $invDate !== '' ? $invDate : $structured['invoice_date'];
            }
            if (! $structured['supplier_name'] && isset($map['supplier_name'])) {
                $supplier = trim((string) ($parts[$map['supplier_name']] ?? ''));
                $structured['supplier_name'] = $supplier !== '' ? $supplier : $structured['supplier_name'];
            }
            if (($structured['currency'] === 'EGP' || ! $structured['currency']) && isset($map['currency'])) {
                $currency = trim((string) ($parts[$map['currency']] ?? ''));
                if ($currency !== '') {
                    $structured['currency'] = $currency;
                }
            }

            // Item row requires at least description + quantity (non-zero).
            if ($description === '' || $quantity <= 0) {
                continue;
            }

            $structured['items'][] = [
                'description' => $description,
                'sku' => $sku,
                'quantity' => $quantity,
                'unit_price' => $unitPrice,
                'total' => $lineTotal,
            ];
            $structured['grand_total'] += $lineTotal;
        }

        return $structured;
    }

    private function buildParsingPrompt(string $rawText): string
    {
        return <<<PROMPT
You are an invoice data extraction AI. Parse the following invoice/document text into a structured JSON object.

IMPORTANT: Return ONLY valid JSON, no markdown, no explanation.

Required JSON structure:
{
  "supplier_name": "string or null",
  "invoice_number": "string or null",
  "invoice_date": "YYYY-MM-DD or null",
  "currency": "EGP or USD or EUR etc",
  "items": [
    {
      "description": "product description",
      "quantity": 0,
      "unit_price": 0.00,
      "total": 0.00
    }
  ],
  "grand_total": 0.00
}

Rules:
- Extract supplier/vendor name
- Extract invoice number and date
- For each line item, extract description, quantity, unit price, and line total
- If unit_price is missing, calculate from total/quantity
- If total is missing, calculate from quantity*unit_price
- Currency defaults to EGP if not found
- If you cannot extract a field, use null
- Items array must always exist, even if empty

Document text:
---
{$rawText}
---

Return ONLY the JSON object:
PROMPT;
    }

    private function extractJsonFromResponse(string $response): ?string
    {
        // Try direct parse first
        $decoded = json_decode($response, true);
        if (json_last_error() === JSON_ERROR_NONE) {
            return $response;
        }

        // Extract from markdown code block
        if (preg_match('/```(?:json)?\s*\n?(.*?)\n?```/s', $response, $matches)) {
            return trim($matches[1]);
        }

        // Try to find JSON object in response
        if (preg_match('/\{.*\}/s', $response, $matches)) {
            return trim($matches[0]);
        }

        return null;
    }

    private function matchSupplier(string $name): ?Vendor
    {
        if (empty($name)) {
            return null;
        }

        $normalized = $this->normalizeSupplierName($name);
        if ($normalized === '') {
            return null;
        }

        $vendors = Vendor::query()->get(['id', 'name', 'email', 'phone', 'address', 'current_balance', 'is_active']);

        // Exact normalized match first.
        foreach ($vendors as $vendor) {
            if ($this->normalizeSupplierName((string) $vendor->name) === $normalized) {
                return $vendor;
            }
        }

        // Then contains match in either direction.
        foreach ($vendors as $vendor) {
            $vendorNorm = $this->normalizeSupplierName((string) $vendor->name);
            if ($vendorNorm === '') {
                continue;
            }
            if (str_contains($vendorNorm, $normalized) || str_contains($normalized, $vendorNorm)) {
                return $vendor;
            }
        }

        // If not found in vendors, try suppliers table then mirror as vendor.
        $suppliers = Supplier::query()->get(['id', 'name', 'email', 'phone', 'address', 'balance']);

        foreach ($suppliers as $supplier) {
            if ($this->normalizeSupplierName((string) $supplier->name) !== $normalized) {
                continue;
            }

            return Vendor::firstOrCreate(
                [
                    'name' => $supplier->name,
                    'email' => $supplier->email,
                ],
                [
                    'phone' => $supplier->phone,
                    'address' => $supplier->address,
                    'current_balance' => (float) ($supplier->balance ?? 0),
                    'is_active' => true,
                ]
            );
        }

        return null;
    }

    private function normalizeSupplierName(string $name): string
    {
        $value = Str::lower(trim($name));
        $value = str_replace(['"', "'", '`', '’', '“', '”', '|', '_', '-', '.', ','], ' ', $value);
        $value = str_replace(['أ', 'إ', 'آ'], 'ا', $value);
        $value = str_replace(['ى'], 'ي', $value);
        $value = str_replace(['ة'], 'ه', $value);
        $value = preg_replace('/\s+/u', ' ', $value) ?? $value;

        return trim($value);
    }

    /**
     * Find a SKU when the import line text contains a typical code (PHY32, UNM3-171M-02, …).
     * Skips auto-generated MP#### patterns.
     */
    private function findSkuByLooseCodesInText(string $text): ?Sku
    {
        $text = trim($text);
        if ($text === '' || ! preg_match_all('/\b([A-Za-z][A-Za-z0-9\-]{2,39})\b/u', $text, $matches)) {
            return null;
        }
        foreach (array_unique($matches[1]) as $token) {
            $t = trim((string) $token);
            if (strlen($t) < 4 || preg_match('/^MP\d+$/i', $t)) {
                continue;
            }
            $rawLower = Str::lower($t);
            $sku = Sku::query()
                ->with('offer')
                ->where(function ($q) use ($rawLower) {
                    $q->whereRaw('LOWER(sku) = ?', [$rawLower])
                        ->orWhereRaw('LOWER(marketplace_id) = ?', [$rawLower]);
                })
                ->first();
            if ($sku) {
                return $sku;
            }
        }

        return null;
    }

    private function matchProduct(string $description): array
    {
        $result = [
            'master_product_id' => null,
            'sku_id' => null,
            'matched' => false,
        ];

        if (empty($description)) {
            return $result;
        }

        $normalized = Str::lower(trim($description));

        // 0. Prefer explicit merchant codes embedded in the line (e.g. "... PHY32") so draft rows
        // bind to the real channel SKU instead of name-fuzzy master-only + later MPxxxx generic stock.
        $skuFromLine = $this->findSkuByLooseCodesInText($description);
        if ($skuFromLine && $skuFromLine->offer) {
            $result['sku_id'] = (int) $skuFromLine->id;
            $result['master_product_id'] = (int) $skuFromLine->offer->master_product_id;
            $result['matched'] = true;

            return $result;
        }

        // 1. Try match with Master Product name
        $product = MasterProduct::whereRaw('LOWER(internal_name) LIKE ?', ["%{$normalized}%"])->first();
        if ($product) {
            $result['master_product_id'] = $product->id;
            $result['matched'] = true;

            return $result;
        }

        // 2. Try match with SKU code (whole line as a single code — rare but cheap)
        $sku = Sku::whereRaw('LOWER(sku) = ?', [$normalized])
            ->orWhereRaw('LOWER(marketplace_id) = ?', [$normalized])
            ->first();
        if ($sku) {
            $result['sku_id'] = $sku->id;
            $result['matched'] = true;
            if ($sku->offer) {
                $result['master_product_id'] = $sku->offer->master_product_id;
            }

            return $result;
        }

        // 3. Fuzzy search on Master Product
        $words = array_filter(explode(' ', $normalized), fn ($w) => strlen($w) >= 3);
        foreach ($words as $word) {
            $product = MasterProduct::whereRaw('LOWER(internal_name) LIKE ?', ["%{$word}%"])->first();
            if ($product) {
                $result['master_product_id'] = $product->id;
                $result['matched'] = true;

                return $result;
            }
        }

        return $result;
    }

    private function matchProductStrictFromTemplate(array $item): array
    {
        $result = [
            'master_product_id' => null,
            'sku_id' => null,
            'matched' => false,
        ];

        $rawSku = trim((string) ($item['sku'] ?? ''));
        $description = trim((string) ($item['description'] ?? ''));

        if ($rawSku !== '') {
            $rawLower = Str::lower($rawSku);
            $normalized = preg_replace('/[^a-z0-9]/i', '', $rawLower) ?? '';
            $normalized = trim((string) $normalized);

            $sku = Sku::query()
                // Exact match first (fast + index-friendly)
                ->whereRaw('LOWER(sku) = ?', [$rawLower])
                ->orWhereRaw('LOWER(marketplace_id) = ?', [$rawLower])
                // Then normalize away separators (spaces, dashes, underscores, slashes)
                ->orWhereRaw(
                    "REPLACE(REPLACE(REPLACE(REPLACE(LOWER(sku), '-', ''), '_', ''), ' ', ''), '/', '') = ?",
                    [$normalized]
                )
                ->orWhereRaw(
                    "REPLACE(REPLACE(REPLACE(REPLACE(LOWER(marketplace_id), '-', ''), '_', ''), ' ', ''), '/', '') = ?",
                    [$normalized]
                )
                ->first();
            if ($sku) {
                $result['sku_id'] = (int) $sku->id;
                $result['matched'] = true;
                if ($sku->offer) {
                    $result['master_product_id'] = (int) $sku->offer->master_product_id;
                }

                return $result;
            }

            return $result;
        }

        if ($description !== '') {
            $product = MasterProduct::whereRaw('LOWER(internal_name) = ?', [Str::lower($description)])->first();
            if ($product) {
                $result['master_product_id'] = (int) $product->id;
                $result['matched'] = true;

                return $result;
            }
        }

        return $result;
    }

    private function addToInventory(int $skuId, int $locationId, float $quantity, PurchaseBatch $batch, string $batchCostId): void
    {
        $locationId = $this->resolveEffectiveInventoryLocationId($skuId, $locationId);

        // Upsert SkuInventory
        $inv = SkuInventory::firstOrCreate(
            ['sku_id' => $skuId, 'location_id' => $locationId],
            [
                'quantity' => 0,
                'reserved' => 0,
                'user_id' => $batch->user_id,
            ]
        );

        $inv->increment('quantity', $quantity);

        // Log transaction
        InventoryTransaction::create([
            'sku_id' => $skuId,
            'location_id' => $locationId,
            'type' => 'IN',
            'quantity' => $quantity,
            'reference_type' => PurchaseBatch::class,
            'reference_id' => $batch->id,
            'notes' => "Purchase batch {$batch->batch_number} received. Batch cost: {$batchCostId}",
            'user_id' => $batch->user_id,
        ]);

        StockUpdateBroadcaster::dispatch($skuId, $locationId, 'receive');
    }

    /**
     * Apply a stock delta for an already-received purchase batch.
     * Positive delta adds inventory at the batch receive location.
     * Negative delta deducts inventory (prefers receive location; may consume from other locations if needed).
     *
     * @throws \Exception when stock is insufficient for deduction.
     */
    public function applyReceivedStockDelta(PurchaseBatch $batch, int $skuId, int $receiveLocationId, float $deltaQty, ?string $note = null): void
    {
        if (abs($deltaQty) < 0.0000001) {
            return;
        }

        $batchCostId = (string) ('BC-'.($batch->batch_number ?? $batch->id));
        $note = $note ?: "Purchase batch {$batch->batch_number} adjustment";

        if ($deltaQty > 0) {
            $stockLocationId = $this->resolveEffectiveInventoryLocationId($skuId, $receiveLocationId);
            $this->addToInventory($skuId, $stockLocationId, (float) $deltaQty, $batch, $batchCostId);

            return;
        }

        $qtyToDeduct = abs((float) $deltaQty);
        $this->deductFromInventoryWithPreference($batch, $skuId, $receiveLocationId, $qtyToDeduct, $note);
    }

    /**
     * Deduct inventory for a SKU, preferring a location, then other locations.
     * Mirrors the cancellation rollback safety checks (never allow negative stock).
     */
    private function deductFromInventoryWithPreference(PurchaseBatch $batch, int $skuId, int $preferredLocationId, float $quantity, string $note): void
    {
        $inventories = SkuInventory::where('sku_id', $skuId)
            ->where('quantity', '>', 0)
            ->get();

        $totalAvailable = (float) $inventories->sum(fn ($inv) => (float) ($inv->quantity ?? 0));
        if ($totalAvailable + 1e-9 < $quantity) {
            throw new \Exception("Insufficient stock for SKU {$skuId}. Required {$quantity}, available {$totalAvailable}.");
        }

        $pool = $inventories
            ->sortBy(fn ($inv) => (int) ($inv->location_id !== $preferredLocationId))
            ->values();

        $remaining = (float) $quantity;
        foreach ($pool as $inv) {
            if ($remaining <= 0) {
                break;
            }
            $availableHere = (float) ($inv->quantity ?? 0);
            if ($availableHere <= 0) {
                continue;
            }
            $take = min($availableHere, $remaining);

            $inv->decrement('quantity', $take);

            InventoryTransaction::create([
                'sku_id' => (int) $skuId,
                'location_id' => (int) $inv->location_id,
                'type' => 'OUT',
                'quantity' => (float) $take,
                'reference_type' => PurchaseBatch::class,
                'reference_id' => (int) $batch->id,
                'notes' => $note,
                'user_id' => (int) ($batch->user_id ?? null),
            ]);

            StockUpdateBroadcaster::dispatch((int) $skuId, (int) $inv->location_id, 'adjust');

            $remaining -= $take;
        }
    }

    private function rollbackReceivedInventory(PurchaseBatch $batch): void
    {
        $locationId = (int) ($batch->location_id ?? 0);
        if ($locationId <= 0) {
            throw new \Exception('Cannot cancel received batch: missing receive location.');
        }

        $hasRemainingQuantityColumn = Schema::hasColumn('purchase_batch_items', 'remaining_quantity');
        $deductions = [];

        foreach ($batch->items as $item) {
            $receivedQty = (float) ($item->received_quantity ?? $item->quantity ?? 0);
            if ($receivedQty <= 0) {
                continue;
            }

            $skuId = $item->sku_id ?: $this->resolveSkuIdForBatchItem($item);
            if (! $skuId) {
                continue;
            }

            $inventories = SkuInventory::where('sku_id', $skuId)
                ->where('quantity', '>', 0)
                ->get();
            $totalAvailable = (float) $inventories->sum(fn ($inv) => (float) ($inv->quantity ?? 0));
            if ($totalAvailable < $receivedQty) {
                throw new \Exception(
                    "Cannot cancel received batch: stock already consumed for SKU {$skuId}. Required {$receivedQty}, available {$totalAvailable}."
                );
            }

            // Build deduction plan: consume from original receive location first, then other locations.
            $pool = $inventories
                ->sortBy(fn ($inv) => (int) ($inv->location_id !== $locationId))
                ->values();

            $remaining = $receivedQty;
            foreach ($pool as $inv) {
                if ($remaining <= 0) {
                    break;
                }
                $availableHere = (float) ($inv->quantity ?? 0);
                if ($availableHere <= 0) {
                    continue;
                }
                $take = min($availableHere, $remaining);
                $deductions[] = [
                    'sku_id' => (int) $skuId,
                    'location_id' => (int) $inv->location_id,
                    'quantity' => (float) $take,
                ];
                $remaining -= $take;
            }
        }

        foreach ($deductions as $deduction) {
            $inventory = SkuInventory::where('sku_id', $deduction['sku_id'])
                ->where('location_id', $deduction['location_id'])
                ->first();
            if (! $inventory) {
                continue;
            }
            $inventory->decrement('quantity', $deduction['quantity']);

            InventoryTransaction::create([
                'sku_id' => $deduction['sku_id'],
                'location_id' => $deduction['location_id'],
                'type' => 'OUT',
                'quantity' => $deduction['quantity'],
                'reference_type' => PurchaseBatch::class,
                'reference_id' => $batch->id,
                'notes' => "Cancellation rollback for purchase batch {$batch->batch_number}",
            ]);

            StockUpdateBroadcaster::dispatch(
                (int) $deduction['sku_id'],
                (int) $deduction['location_id'],
                'adjust'
            );
        }

        // Important for FIFO costing: once stock is rolled back, prevent any future OUT operations
        // from consuming layers belonging to this cancelled purchase.
        if ($hasRemainingQuantityColumn) {
            PurchaseBatchItem::query()
                ->where('purchase_batch_id', (int) $batch->id)
                ->update(['remaining_quantity' => 0]);
        }
    }
}
