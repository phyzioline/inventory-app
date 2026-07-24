<?php

declare(strict_types=1);

namespace App\Application\Services;

use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use App\Application\DTOs\InvoiceEditDTO;
use App\Application\DTOs\InvoiceItemDTO;
use App\Domain\Events\CashboxAdjustmentEvent;
use App\Domain\Events\InventoryAdjustmentEvent;
use App\Domain\Events\ReceivableAdjustmentEvent;
use App\Domain\Models\Wms\InventoryOrder;
use App\Domain\Models\Wms\InventoryOrderItem;
use App\Domain\Models\Wms\InventoryTransaction;
use App\Domain\Models\Wms\InvoiceEditLog;
use App\Domain\Models\Wms\Receipt;
use App\Domain\Models\Wms\Sku;
use App\Domain\Models\Wms\SkuInventory;
use App\Domain\ValueObjects\InvoiceSnapshot;

/**
 * Orchestrates the full financial correction flow for a sales invoice edit:
 *
 *  1. Load immutable snapshot (before)
 *  2. Apply inventory deltas (old vs new items) — stock never goes negative
 *  3. Rebuild order line items
 *  4. Recompute totals server-side (source of truth)
 *  5. Sync cashbox: auto-receipt on increase, reversal on decrease
 *  6. Write InvoiceEditLog (before/after snapshot, item/payment deltas, reason)
 *  7. Dispatch domain events for downstream listeners
 *
 * Golden rule: "No invoice update is a modification — it is a financial correction transaction."
 */
class InvoiceEditService
{
    public function __construct(
        private readonly FinanceAccountLedgerService $ledger,
        private readonly ReceiptApplicationService $receiptService,
    ) {}

    // ──────────────────────────────────────────────────────────────
    // Public API
    // ──────────────────────────────────────────────────────────────

    public function edit(InvoiceEditDTO $dto): InventoryOrder
    {
        return DB::transaction(function () use ($dto) {

            /** @var InventoryOrder $order */
            $order = InventoryOrder::with(['items'])->lockForUpdate()->findOrFail($dto->orderId);

            // ── Step 1: Snapshot ──────────────────────────────────
            $before = InvoiceSnapshot::fromOrder($order);

            // ── Step 2 & 3: Inventory deltas + rebuild items ──────
            $skuDeltas = [];
            if (! empty($dto->items)) {
                $skuDeltas = $this->applyInventoryDeltas($order, $dto->items);
                $this->rebuildOrderItems($order, $dto->items);
            }

            // ── Step 4: Recompute financials ─────────────────────
            $freshItems = InventoryOrderItem::where('inventory_order_id', $order->id)->get();
            $subtotal = (float) $freshItems->sum(
                fn ($i) => (float) ($i->total_price ?? ((float) $i->quantity * (float) $i->unit_price))
            );
            $taxAmount = $dto->taxAmount ?? (float) ($order->tax_amount ?? 0);
            $discountAmount = $dto->discountAmount ?? (float) ($order->discount_amount ?? 0);
            $grandTotal = max(0.0, $subtotal + $taxAmount - $discountAmount);

            $paymentType = $dto->paymentType ?? (string) ($order->payment_type ?? 'cash');
            if ($dto->paidAmount !== null) {
                $paidAmount = $paymentType === 'cash'
                    ? $grandTotal
                    : max(0.0, min((float) $dto->paidAmount, $grandTotal));
            } else {
                $paidAmount = $paymentType === 'cash'
                    ? $grandTotal
                    : (float) ($order->paid_amount ?? 0);
            }
            $remainingAmount = max(0.0, $grandTotal - $paidAmount);
            $isFullyPaid = $remainingAmount <= 0.0001;

            $order->update([
                'total_amount' => $grandTotal,
                'tax_amount' => $taxAmount,
                'discount_amount' => $discountAmount,
                'payment_type' => $paymentType,
                'paid_amount' => $paidAmount,
                'remaining_amount' => $remainingAmount,
                'financial_status' => $isFullyPaid ? 'charged' : 'pending',
                'settlement_status' => $isFullyPaid ? 'settled' : 'pending',
                'status' => $isFullyPaid && in_array($order->status, ['pending', 'processing'], true)
                                        ? 'sold'
                                        : $order->status,
            ]);

            // ── Step 5: Sync cashbox ──────────────────────────────
            $paymentDelta = $this->syncAutoReceipt(
                $order,
                $before->paidAmount,
                $paidAmount,
                $paymentType,
            );

            // ── Step 6: Audit log ─────────────────────────────────
            $order->refresh()->load('items');
            $after = InvoiceSnapshot::fromOrder($order);

            InvoiceEditLog::create([
                'inventory_order_id' => $order->id,
                'user_id' => $dto->userId,
                'before_snapshot' => $before->toArray(),
                'after_snapshot' => $after->toArray(),
                'items_delta' => ! empty($skuDeltas) ? $skuDeltas : null,
                'payment_delta' => $paymentDelta,
                'reason' => $dto->reason,
            ]);

            // ── Step 7: Domain events ─────────────────────────────
            if (! empty($skuDeltas)) {
                event(new InventoryAdjustmentEvent($order, $skuDeltas));
            }

            $payDelta = (float) ($paymentDelta['delta'] ?? 0);
            if (abs($payDelta) > 0.00001) {
                event(new CashboxAdjustmentEvent(
                    $order,
                    $before->paidAmount,
                    $paidAmount,
                    $payDelta,
                    $paymentType,
                ));
            }

            $remainingDelta = abs($before->remainingAmount - (float) ($order->remaining_amount ?? 0));
            if ($remainingDelta > 0.00001) {
                event(new ReceivableAdjustmentEvent(
                    $order,
                    $before->remainingAmount,
                    (float) ($order->remaining_amount ?? 0),
                ));
            }

            return $order->load(['items.sku.offer.masterProduct', 'channel', 'editLogs']);
        });
    }

    // ──────────────────────────────────────────────────────────────
    // Private: Inventory
    // ──────────────────────────────────────────────────────────────

    /**
     * Compute old-vs-new qty diff per SKU and apply stock movements.
     * Throws ValidationException if any SKU would go negative.
     *
     * @param  InvoiceItemDTO[]  $newItems
     * @return array<int, float> sku_id => net delta (+ = more OUT, - = returned IN)
     */
    private function applyInventoryDeltas(InventoryOrder $order, array $newItems): array
    {
        $locationId = $this->resolveOrderLocation($order);
        if ($locationId === null) {
            return [];
        }

        $oldQty = [];
        foreach ($order->items as $item) {
            $sid = (int) ($item->sku_id ?? 0);
            if ($sid > 0) {
                $oldQty[$sid] = ($oldQty[$sid] ?? 0.0) + (float) ($item->quantity ?? 0);
            }
        }

        $newQty = [];
        foreach ($newItems as $item) {
            if ($item->skuId && $item->skuId > 0) {
                $newQty[$item->skuId] = ($newQty[$item->skuId] ?? 0.0) + $item->quantity;
            }
        }

        $allIds = array_unique(array_merge(array_keys($oldQty), array_keys($newQty)));
        $deltas = [];

        foreach ($allIds as $sid) {
            $sid = (int) $sid;
            $diff = ($newQty[$sid] ?? 0.0) - ($oldQty[$sid] ?? 0.0);
            if (abs($diff) <= 0.00001) {
                continue;
            }

            $inv = SkuInventory::firstOrCreate(
                ['sku_id' => $sid, 'location_id' => $locationId],
                ['quantity' => 0, 'reserved' => 0, 'user_id' => Auth::id()]
            );

            if ($diff > 0) {
                // More units sold — deduct from stock
                if ((float) ($inv->quantity ?? 0) + 1e-9 < $diff) {
                    throw ValidationException::withMessages([
                        'items' => ["Insufficient stock for SKU #{$sid}. Available: {$inv->quantity}, need extra: {$diff}."],
                    ]);
                }
                $inv->decrement('quantity', $diff);
                InventoryTransaction::create([
                    'sku_id' => $sid,
                    'location_id' => $locationId,
                    'type' => 'OUT',
                    'quantity' => $diff,
                    'reference_type' => 'OrderEdit',
                    'reference_id' => (string) $order->id,
                    'user_id' => Auth::id(),
                    'notes' => 'Invoice edit: quantity increase',
                ]);
            } else {
                // Fewer units — return stock
                $inv->increment('quantity', abs($diff));
                InventoryTransaction::create([
                    'sku_id' => $sid,
                    'location_id' => $locationId,
                    'type' => 'IN',
                    'quantity' => abs($diff),
                    'reference_type' => 'OrderEdit',
                    'reference_id' => (string) $order->id,
                    'user_id' => Auth::id(),
                    'notes' => 'Invoice edit: quantity decrease',
                ]);
            }

            $deltas[$sid] = $diff;
        }

        return $deltas;
    }

    /**
     * @param  InvoiceItemDTO[]  $newItems
     */
    private function rebuildOrderItems(InventoryOrder $order, array $newItems): void
    {
        InventoryOrderItem::where('inventory_order_id', $order->id)->delete();

        foreach ($newItems as $item) {
            if (! $item->skuId || $item->skuId <= 0) {
                continue;
            }

            $sku = Sku::with(['offer.masterProduct'])->find($item->skuId);

            InventoryOrderItem::create([
                'inventory_order_id' => $order->id,
                'sku_id' => $item->skuId,
                'sku_code' => $sku?->sku ?? ('SKU-'.$item->skuId),
                'product_name' => $sku?->offer?->masterProduct?->internal_name
                                        ?? $sku?->name
                                        ?? $sku?->sku
                                        ?? 'Item',
                'quantity' => $item->quantity,
                'unit_price' => $item->unitPrice,
                'total_price' => round($item->quantity * $item->unitPrice, 2),
                'user_id' => Auth::id(),
            ]);
        }
    }

    // ──────────────────────────────────────────────────────────────
    // Private: Cashbox
    // ──────────────────────────────────────────────────────────────

    /**
     * Keep the cashbox in sync with the invoice's paid_amount.
     *
     * Positive delta  → new receipt (cash in)
     * Negative delta  → reversal receipt (cash out / correction)
     * New paid = 0    → void all auto-receipts for this order
     *
     * Auto-receipts are marked with external_reference = 'auto_receipt'
     * so they can be distinguished from manually-recorded receipts.
     *
     * @return array{previous: float, new: float, delta: float}
     */
    private function syncAutoReceipt(
        InventoryOrder $order,
        float $previousPaid,
        float $newPaid,
        string $paymentMethod,
    ): array {
        $delta = round($newPaid - $previousPaid, 2);

        if (abs($delta) <= 0.00001) {
            return ['previous' => $previousPaid, 'new' => $newPaid, 'delta' => 0.0];
        }

        $userId = (int) Auth::id();
        $this->ledger->ensureDefaultAccountsForUser($userId);
        $financeAccountId = $this->ledger->resolveFinanceAccountId(null, $paymentMethod, $userId);
        $payerName = (string) ($order->customer_name ?? 'Customer');
        $invoiceRef = $order->platform_order_id ?? $order->id;

        if ($newPaid <= 0.00001) {
            // Payment fully removed — void all auto-receipts for this order
            Receipt::where('reference_type', InventoryOrder::class)
                ->where('reference_id', $order->id)
                ->where('external_reference', 'auto_receipt')
                ->delete();
        } elseif ($delta > 0) {
            // Payment increased — create receipt for the positive delta
            Receipt::create([
                'receipt_number' => $this->receiptService->generateNextReceiptNumber(),
                'type' => 'Customer Payment',
                'category' => 'customer_collection',
                'amount' => round($delta, 2),
                'description' => 'تعديل فاتورة — دفعة إضافية #'.$invoiceRef,
                'receipt_date' => now()->toDateString(),
                'payment_method' => $paymentMethod,
                'finance_account_id' => $financeAccountId,
                'reference_type' => InventoryOrder::class,
                'reference_id' => $order->id,
                'payer_name' => $payerName,
                'user_id' => $userId,
                'warehouse_id' => null,
                'external_reference' => 'auto_receipt',
            ]);
        } else {
            // Payment decreased — create reversal receipt (negative amount = cash out)
            Receipt::create([
                'receipt_number' => $this->receiptService->generateNextReceiptNumber(),
                'type' => 'Payment Reversal',
                'category' => 'customer_collection',
                'amount' => round($delta, 2), // negative
                'description' => 'تعديل فاتورة — رد مدفوع #'.$invoiceRef,
                'receipt_date' => now()->toDateString(),
                'payment_method' => $paymentMethod,
                'finance_account_id' => $financeAccountId,
                'reference_type' => InventoryOrder::class,
                'reference_id' => $order->id,
                'payer_name' => $payerName,
                'user_id' => $userId,
                'warehouse_id' => null,
                'external_reference' => 'auto_receipt_reversal',
            ]);
        }

        return ['previous' => $previousPaid, 'new' => $newPaid, 'delta' => $delta];
    }

    // ──────────────────────────────────────────────────────────────
    // Private: Helpers
    // ──────────────────────────────────────────────────────────────

    private function resolveOrderLocation(InventoryOrder $order): ?int
    {
        foreach (['fulfillment_warehouse_id', 'warehouse_id', 'location_id', 'inventory_location_id'] as $field) {
            $val = (int) ($order->{$field} ?? 0);
            if ($val > 0) {
                return $val;
            }
        }

        $tx = InventoryTransaction::where('reference_id', (string) $order->id)
            ->whereIn('reference_type', ['Order', 'AutoTransferBeforeSale', 'OrderEdit'])
            ->orderByDesc('id')
            ->first();

        return ($tx && (int) ($tx->location_id ?? 0) > 0) ? (int) $tx->location_id : null;
    }
}
