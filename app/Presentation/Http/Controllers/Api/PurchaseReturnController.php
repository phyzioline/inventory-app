<?php

namespace App\Presentation\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use App\Application\Services\PurchaseImportService;
use App\Domain\Models\Wms\InventoryTransaction;
use App\Domain\Models\Wms\PurchaseBatch;
use App\Domain\Models\Wms\PurchaseReturn;
use App\Domain\Models\Wms\PurchaseReturnItem;
use App\Domain\Models\Wms\Receipt;
use App\Domain\Models\Wms\SkuInventory;

class PurchaseReturnController extends Controller
{
    public function __construct(private PurchaseImportService $purchaseImportService) {}

    /**
     * A credit_note return reduces what we owe the vendor; cash/bank_transfer
     * returns are handled entirely via the treasury Receipt instead.
     */
    private function creditNoteAmount(string $refundMethod, float $grandTotal): float
    {
        return $refundMethod === 'credit_note' ? $grandTotal : 0.0;
    }

    public function index(Request $request)
    {
        $query = PurchaseReturn::with(['batch', 'vendor', 'supplier', 'location'])
            ->orderByDesc('return_date')
            ->orderByDesc('id');

        if ($request->filled('purchase_batch_id')) {
            $query->where('purchase_batch_id', (int) $request->input('purchase_batch_id'));
        }
        if ($request->filled('supplier_id')) {
            $query->where('supplier_id', (int) $request->input('supplier_id'));
        }

        return response()->json($query->paginate(50));
    }

    public function show($id)
    {
        $row = PurchaseReturn::with(['items.sku', 'items.batchItem.masterProduct', 'batch.items.sku.offer.masterProduct', 'vendor', 'supplier', 'location'])
            ->findOrFail($id);

        return response()->json($row);
    }

    public function store(Request $request)
    {
        $validated = $request->validate([
            'purchase_batch_id' => 'required|integer|exists:purchase_batches,id',
            'return_date' => 'required|date',
            'refund_method' => 'nullable|string|in:credit_note,cash,bank_transfer',
            'reason' => 'nullable|string|max:255',
            'notes' => 'nullable|string',
            'items' => 'required|array|min:1',
            'items.*.purchase_batch_item_id' => 'nullable|integer|exists:purchase_batch_items,id',
            'items.*.sku_id' => 'required|integer|exists:skus,id',
            'items.*.quantity' => 'required|numeric|min:0.01',
            'items.*.unit_price' => 'nullable|numeric|min:0',
            'items.*.reason' => 'nullable|string|max:255',
        ]);

        /** @var PurchaseBatch $batch */
        $batch = PurchaseBatch::with(['items'])->findOrFail((int) $validated['purchase_batch_id']);
        $locationId = (int) ($batch->location_id ?? 0);

        DB::beginTransaction();
        try {
            $return = PurchaseReturn::create([
                'purchase_batch_id' => (int) $batch->id,
                'vendor_id' => $batch->vendor_id ? (int) $batch->vendor_id : null,
                'supplier_id' => null,
                'location_id' => $locationId > 0 ? $locationId : null,
                'return_number' => PurchaseReturn::generateReturnNumber(),
                'return_date' => $validated['return_date'],
                'reason' => $validated['reason'] ?? null,
                'refund_method' => $validated['refund_method'] ?? 'credit_note',
                'currency' => (string) ($batch->currency ?? 'EGP'),
                'notes' => $validated['notes'] ?? null,
                'subtotal' => 0,
                'tax_amount' => 0,
                'grand_total' => 0,
                'user_id' => Auth::id(),
            ]);

            $subtotal = 0.0;
            foreach ($validated['items'] as $row) {
                $skuId = (int) $row['sku_id'];
                $qty = (float) $row['quantity'];

                $batchItemId = ! empty($row['purchase_batch_item_id']) ? (int) $row['purchase_batch_item_id'] : null;
                $matchedBatchItem = null;
                if ($batchItemId) {
                    $matchedBatchItem = $batch->items->firstWhere('id', $batchItemId);
                }

                $unitPrice = isset($row['unit_price'])
                    ? (float) $row['unit_price']
                    : (float) ($matchedBatchItem?->unit_price ?? 0);

                $lineTotal = round($qty * $unitPrice, 2);
                $subtotal += $lineTotal;

                PurchaseReturnItem::create([
                    'purchase_return_id' => $return->id,
                    'purchase_batch_item_id' => $batchItemId,
                    'sku_id' => $skuId,
                    'quantity' => $qty,
                    'unit_price' => $unitPrice,
                    'total_price' => $lineTotal,
                    'reason' => $row['reason'] ?? null,
                    'meta' => [
                        'batch_number' => $batch->batch_number,
                        'invoice_number' => $batch->invoice_number,
                    ],
                    'user_id' => Auth::id(),
                ]);

                if ($locationId > 0) {
                    $inv = SkuInventory::firstOrCreate(
                        ['sku_id' => $skuId, 'location_id' => $locationId],
                        ['quantity' => 0, 'reserved' => 0]
                    );
                    $available = (float) ($inv->quantity ?? 0);
                    if ($available + 1e-9 < $qty) {
                        throw new \Exception("Insufficient stock for SKU {$skuId} in location {$locationId} (available {$available}, return {$qty}).");
                    }

                    $inv->decrement('quantity', $qty);

                    InventoryTransaction::create([
                        'sku_id' => $skuId,
                        'location_id' => $locationId,
                        'type' => 'OUT',
                        'quantity' => $qty,
                        'reference_type' => PurchaseReturn::class,
                        'reference_id' => $return->id,
                        'notes' => "Purchase return {$return->return_number} from batch {$batch->batch_number}",
                        'user_id' => Auth::id(),
                    ]);
                }
            }

            $return->update([
                'subtotal' => round($subtotal, 2),
                'grand_total' => round($subtotal, 2),
            ]);

            $method = (string) ($return->refund_method ?? 'credit_note');
            if ($return->vendor_id) {
                $this->purchaseImportService->adjustVendorPayableBalance(
                    (int) $return->vendor_id,
                    -$this->creditNoteAmount($method, round($subtotal, 2))
                );
            }
            $return->update(['balance_synced_at' => now()]);

            // If supplier refund is cash/bank, register as receipt (incoming).
            if (in_array($method, ['cash', 'bank_transfer'], true) && $subtotal > 0.00001) {
                Receipt::create([
                    'type' => 'supplier_refund',
                    'category' => 'general',
                    'amount' => round($subtotal, 2),
                    'description' => "Purchase return refund {$return->return_number} (batch {$batch->batch_number})",
                    'receipt_date' => $return->return_date,
                    'payment_method' => $method,
                    'reference_type' => PurchaseReturn::class,
                    'reference_id' => $return->id,
                    'external_reference' => $return->return_number,
                    'user_id' => Auth::id(),
                    'warehouse_id' => $return->location_id,
                    'payer_name' => $batch->supplier_name_raw ?: null,
                    'receipt_number' => null,
                ]);
            }

            DB::commit();

            return response()->json($return->load(['items.sku', 'batch']), 201);
        } catch (\Throwable $e) {
            DB::rollBack();

            return response()->json(['message' => $e->getMessage()], 422);
        }
    }

    public function update(Request $request, $id)
    {
        $return = PurchaseReturn::with(['items', 'batch.items'])->findOrFail($id);

        $validated = $request->validate([
            'return_date' => 'sometimes|date',
            'refund_method' => 'nullable|string|in:credit_note,cash,bank_transfer',
            'reason' => 'nullable|string|max:255',
            'notes' => 'nullable|string',
            'items' => 'sometimes|array|min:1',
            'items.*.id' => 'nullable|integer|exists:purchase_return_items,id',
            'items.*.purchase_batch_item_id' => 'nullable|integer|exists:purchase_batch_items,id',
            'items.*.sku_id' => 'required_with:items|integer|exists:skus,id',
            'items.*.quantity' => 'required_with:items|numeric|min:0',
            'items.*.unit_price' => 'nullable|numeric|min:0',
            'items.*.reason' => 'nullable|string|max:255',
        ]);

        /** @var PurchaseBatch $batch */
        $batch = $return->batch ?? PurchaseBatch::with(['items'])->findOrFail((int) $return->purchase_batch_id);
        $locationId = (int) ($return->location_id ?? $batch->location_id ?? 0);
        $oldGrandTotal = (float) $return->grand_total;
        $oldRefundMethod = (string) ($return->refund_method ?? 'credit_note');
        $vendorId = $return->vendor_id ? (int) $return->vendor_id : null;

        DB::beginTransaction();
        try {
            $headerPayload = array_filter([
                'return_date' => $validated['return_date'] ?? null,
                'refund_method' => $validated['refund_method'] ?? null,
            ], fn ($v) => $v !== null);
            if ($request->has('reason')) {
                $headerPayload['reason'] = $validated['reason'] ?? null;
            }
            if ($request->has('notes')) {
                $headerPayload['notes'] = $validated['notes'] ?? null;
            }
            if (! empty($headerPayload)) {
                $return->update($headerPayload);
            }

            if ($request->has('items')) {
                $existingById = $return->items->keyBy('id');
                $keptIds = [];

                $subtotal = 0.0;
                foreach ($validated['items'] as $row) {
                    $qty = (float) ($row['quantity'] ?? 0);
                    if ($qty <= 0) {
                        continue;
                    }

                    $skuId = (int) $row['sku_id'];
                    $batchItemId = ! empty($row['purchase_batch_item_id']) ? (int) $row['purchase_batch_item_id'] : null;
                    $matchedBatchItem = $batchItemId
                        ? $batch->items->firstWhere('id', $batchItemId)
                        : null;

                    $unitPrice = isset($row['unit_price'])
                        ? (float) $row['unit_price']
                        : (float) ($matchedBatchItem?->unit_price ?? 0);
                    $lineTotal = round($qty * $unitPrice, 2);
                    $subtotal += $lineTotal;

                    $lineId = ! empty($row['id']) ? (int) $row['id'] : null;
                    $existing = $lineId ? $existingById->get($lineId) : null;

                    if ($existing && (int) $existing->purchase_return_id !== (int) $return->id) {
                        throw new \Exception('Invalid return line reference.');
                    }

                    $oldQty = $existing ? (float) $existing->quantity : 0.0;
                    $deltaQty = $qty - $oldQty;

                    if ($existing) {
                        $existing->update([
                            'purchase_batch_item_id' => $batchItemId ?: $existing->purchase_batch_item_id,
                            'sku_id' => $skuId,
                            'quantity' => $qty,
                            'unit_price' => $unitPrice,
                            'total_price' => $lineTotal,
                            'reason' => $row['reason'] ?? $existing->reason,
                        ]);
                        $keptIds[] = (int) $existing->id;
                    } else {
                        $created = PurchaseReturnItem::create([
                            'purchase_return_id' => $return->id,
                            'purchase_batch_item_id' => $batchItemId,
                            'sku_id' => $skuId,
                            'quantity' => $qty,
                            'unit_price' => $unitPrice,
                            'total_price' => $lineTotal,
                            'reason' => $row['reason'] ?? null,
                            'meta' => [
                                'batch_number' => $batch->batch_number,
                                'invoice_number' => $batch->invoice_number,
                            ],
                            'user_id' => Auth::id(),
                        ]);
                        $keptIds[] = (int) $created->id;
                        $deltaQty = $qty;
                    }

                    if ($locationId > 0 && abs($deltaQty) > 0.0000001) {
                        $this->applyPurchaseReturnStockDelta($return, $skuId, $locationId, $deltaQty, $batch);
                    }
                }

                foreach ($return->items as $oldLine) {
                    if (in_array((int) $oldLine->id, $keptIds, true)) {
                        continue;
                    }
                    $removeQty = (float) $oldLine->quantity;
                    if ($locationId > 0 && $removeQty > 0.0000001) {
                        $this->applyPurchaseReturnStockDelta(
                            $return,
                            (int) $oldLine->sku_id,
                            $locationId,
                            -$removeQty,
                            $batch
                        );
                    }
                    $oldLine->delete();
                }

                $return->update([
                    'subtotal' => round($subtotal, 2),
                    'grand_total' => round($subtotal, 2),
                ]);
            }

            $return->refresh();
            $this->syncSupplierRefundReceipt($return, $batch, (float) $return->grand_total);

            if ($vendorId) {
                $newRefundMethod = (string) ($return->refund_method ?? 'credit_note');
                $oldCredit = $this->creditNoteAmount($oldRefundMethod, $oldGrandTotal);
                $newCredit = $this->creditNoteAmount($newRefundMethod, (float) $return->grand_total);
                $this->purchaseImportService->adjustVendorPayableBalance($vendorId, $oldCredit - $newCredit);
                $return->update(['balance_synced_at' => now()]);
            }

            DB::commit();

            return response()->json(
                $return->load(['items.sku', 'items.batchItem.masterProduct', 'batch', 'vendor', 'supplier', 'location'])
            );
        } catch (\Throwable $e) {
            DB::rollBack();

            return response()->json(['message' => $e->getMessage()], 422);
        }
    }

    /**
     * Positive delta = more stock leaving the warehouse (return qty increased).
     * Negative delta = stock returned to warehouse (return qty decreased or line removed).
     */
    private function applyPurchaseReturnStockDelta(
        PurchaseReturn $return,
        int $skuId,
        int $locationId,
        float $deltaQty,
        PurchaseBatch $batch
    ): void {
        if (abs($deltaQty) < 0.0000001) {
            return;
        }

        $inv = SkuInventory::firstOrCreate(
            ['sku_id' => $skuId, 'location_id' => $locationId],
            ['quantity' => 0, 'reserved' => 0]
        );

        if ($deltaQty > 0) {
            $available = (float) ($inv->quantity ?? 0);
            if ($available + 1e-9 < $deltaQty) {
                throw new \Exception("Insufficient stock for SKU {$skuId} in location {$locationId} (available {$available}, additional return {$deltaQty}).");
            }
            $inv->decrement('quantity', $deltaQty);
            InventoryTransaction::create([
                'sku_id' => $skuId,
                'location_id' => $locationId,
                'type' => 'OUT',
                'quantity' => $deltaQty,
                'reference_type' => PurchaseReturn::class,
                'reference_id' => $return->id,
                'notes' => "Purchase return {$return->return_number} adjustment (batch {$batch->batch_number})",
                'user_id' => Auth::id(),
            ]);

            return;
        }

        $restoreQty = abs($deltaQty);
        $inv->increment('quantity', $restoreQty);
        InventoryTransaction::create([
            'sku_id' => $skuId,
            'location_id' => $locationId,
            'type' => 'IN',
            'quantity' => $restoreQty,
            'reference_type' => PurchaseReturn::class,
            'reference_id' => $return->id,
            'notes' => "Purchase return {$return->return_number} reversal (batch {$batch->batch_number})",
            'user_id' => Auth::id(),
        ]);
    }

    private function syncSupplierRefundReceipt(PurchaseReturn $return, PurchaseBatch $batch, float $grandTotal): void
    {
        $method = (string) ($return->refund_method ?? 'credit_note');
        $existing = Receipt::query()
            ->where('reference_type', PurchaseReturn::class)
            ->where('reference_id', $return->id)
            ->first();

        if (in_array($method, ['cash', 'bank_transfer'], true) && $grandTotal > 0.00001) {
            $payload = [
                'type' => 'supplier_refund',
                'category' => 'general',
                'amount' => round($grandTotal, 2),
                'description' => "Purchase return refund {$return->return_number} (batch {$batch->batch_number})",
                'receipt_date' => $return->return_date,
                'payment_method' => $method,
                'reference_type' => PurchaseReturn::class,
                'reference_id' => $return->id,
                'external_reference' => $return->return_number,
                'warehouse_id' => $return->location_id,
                'payer_name' => $batch->supplier_name_raw ?: null,
            ];
            if ($existing) {
                $existing->update($payload);
            } else {
                Receipt::create(array_merge($payload, [
                    'user_id' => Auth::id(),
                    'receipt_number' => null,
                ]));
            }

            return;
        }

        if ($existing) {
            $existing->delete();
        }
    }
}
