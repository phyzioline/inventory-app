<?php

namespace App\Domain\ValueObjects;

use App\Domain\Models\Wms\InventoryOrder;

/**
 * Immutable point-in-time snapshot of an invoice's financial state.
 * Stored in inv_invoice_edit_logs before_snapshot / after_snapshot columns.
 */
final class InvoiceSnapshot
{
    public function __construct(
        public readonly int $orderId,
        public readonly float $totalAmount,
        public readonly float $taxAmount,
        public readonly float $discountAmount,
        public readonly float $paidAmount,
        public readonly float $remainingAmount,
        public readonly string $paymentType,
        public readonly string $status,
        public readonly string $financialStatus,
        public readonly string $settlementStatus,
        public readonly array $items,
    ) {}

    public static function fromOrder(InventoryOrder $order): self
    {
        $items = $order->relationLoaded('items')
            ? $order->items->map(fn ($item) => [
                'id' => $item->id,
                'sku_id' => $item->sku_id,
                'sku_code' => $item->sku_code,
                'product_name' => $item->product_name,
                'quantity' => (float) $item->quantity,
                'unit_price' => (float) $item->unit_price,
                'total_price' => (float) $item->total_price,
            ])->values()->all()
            : [];

        return new self(
            orderId: (int) $order->id,
            totalAmount: (float) ($order->total_amount ?? 0),
            taxAmount: (float) ($order->tax_amount ?? 0),
            discountAmount: (float) ($order->discount_amount ?? 0),
            paidAmount: (float) ($order->paid_amount ?? 0),
            remainingAmount: (float) ($order->remaining_amount ?? 0),
            paymentType: (string) ($order->payment_type ?? 'cash'),
            status: (string) ($order->status ?? 'pending'),
            financialStatus: (string) ($order->financial_status ?? 'pending'),
            settlementStatus: (string) ($order->settlement_status ?? 'pending'),
            items: $items,
        );
    }

    public function toArray(): array
    {
        return [
            'order_id' => $this->orderId,
            'total_amount' => $this->totalAmount,
            'tax_amount' => $this->taxAmount,
            'discount_amount' => $this->discountAmount,
            'paid_amount' => $this->paidAmount,
            'remaining_amount' => $this->remainingAmount,
            'payment_type' => $this->paymentType,
            'status' => $this->status,
            'financial_status' => $this->financialStatus,
            'settlement_status' => $this->settlementStatus,
            'items' => $this->items,
        ];
    }
}
