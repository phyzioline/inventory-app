<?php

namespace App\Application\Services;

use App\Domain\Models\Wms\Channel;
use App\Domain\Models\Wms\InventoryOrder;
use App\Domain\Models\Wms\InventoryOrderItem;
use App\Domain\Models\Wms\InventoryTransaction;
use App\Domain\Models\Wms\Quotation;
use App\Domain\Models\Wms\Sku;
use App\Domain\Models\Wms\SkuInventory;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/**
 * Convert a quotation to a credit sales order with stock availability guard + OUT deduction.
 */
class QuotationConversionService
{
    /**
     * @return array{order: InventoryOrder}
     *
     * @throws QuotationConversionException
     */
    public function convert(Quotation $quotation, ?int $userId, ?int $requestedChannelId = null): array
    {
        if ($quotation->status === 'converted') {
            throw new QuotationConversionException(
                'Quotation already converted to order',
                'already_converted'
            );
        }

        $channelId = (int) ($requestedChannelId ?: ChannelStockResolver::resolveMainStoreChannelId());
        if ($channelId <= 0) {
            $channelId = (int) (Channel::query()->where('is_active', true)->orderBy('id')->value('id') ?? 0);
        }
        if ($channelId <= 0) {
            throw new QuotationConversionException(
                'No sales channel configured for order conversion',
                'no_channel'
            );
        }

        $quotation->loadMissing('items.sku');
        if ($quotation->items->isEmpty()) {
            throw new QuotationConversionException(
                'Quotation has no line items',
                'empty_quotation'
            );
        }

        $insufficient = $this->collectInsufficientLines($quotation, $channelId);
        if ($insufficient !== []) {
            throw new QuotationConversionException(
                'Cannot convert quotation: insufficient stock for one or more items',
                'insufficient_stock',
                $insufficient
            );
        }

        return DB::transaction(function () use ($quotation, $userId, $channelId) {
            $total = (float) $quotation->total_amount;
            $platformOrderId = 'QT-'.preg_replace('/[^A-Za-z0-9\-]/', '', (string) $quotation->reference_number);
            if ($platformOrderId === 'QT-') {
                $platformOrderId = 'QT-'.strtoupper(Str::random(10));
            }

            $order = InventoryOrder::create([
                'channel_id' => $channelId,
                'platform_order_id' => $platformOrderId,
                'user_id' => $userId,
                'customer_id' => $quotation->customer_id,
                'customer_name' => $quotation->customer_name ?? 'Guest',
                'order_date' => now(),
                'currency' => 'EGP',
                'total_amount' => $total,
                'shipping_amount' => 0,
                'tax_amount' => (float) ($quotation->tax_amount ?? 0),
                'discount_amount' => (float) ($quotation->discount_amount ?? 0),
                'payment_type' => 'credit',
                'paid_amount' => 0,
                'remaining_amount' => $total,
                'status' => 'pending',
                'financial_status' => 'pending',
                'settlement_status' => 'pending',
            ]);

            foreach ($quotation->items as $item) {
                $sku = $item->sku ?? ($item->sku_id ? Sku::query()->find($item->sku_id) : null);
                $qty = (int) $item->quantity;
                $unit = (float) $item->unit_price;
                $skuId = (int) ($item->sku_id ?? 0);

                InventoryOrderItem::create([
                    'inventory_order_id' => $order->id,
                    'sku_id' => $item->sku_id,
                    'sku_code' => $sku?->sku ?? (string) ($item->sku_id ?? 'UNKNOWN'),
                    'product_name' => $sku?->name ?? $sku?->sku ?? 'Quotation line',
                    'quantity' => $qty,
                    'unit_price' => $unit,
                    'total_price' => (float) ($item->total ?? ($qty * $unit)),
                    'user_id' => $userId,
                    'stock_deduction_status' => 'deducted',
                    'stock_shortage_reason' => null,
                ]);

                $this->deductStockForLine($skuId, $channelId, $qty, (int) $order->id, $userId);
            }

            $quotation->update(['status' => 'converted']);

            return [
                'order' => $order->load('items.sku'),
            ];
        });
    }

    /**
     * @return list<array{sku_id: int, sku_code: string, product_name: string, needed: int, available: float}>
     */
    private function collectInsufficientLines(Quotation $quotation, int $channelId): array
    {
        $insufficient = [];

        foreach ($quotation->items as $item) {
            $skuId = (int) ($item->sku_id ?? 0);
            $needed = (int) $item->quantity;
            $sku = $item->sku ?? ($skuId > 0 ? Sku::query()->find($skuId) : null);
            $available = $skuId > 0
                ? ChannelStockResolver::availableQuantityForSkuId($skuId, $channelId)
                : 0.0;

            $canFulfill = $skuId > 0
                && $needed > 0
                && ChannelStockResolver::hasFulfillableLocationForSku($skuId, $channelId, $needed);

            if (! $canFulfill) {
                $insufficient[] = [
                    'sku_id' => $skuId,
                    'sku_code' => (string) ($sku?->sku ?? $item->sku_id ?? 'UNKNOWN'),
                    'product_name' => (string) ($sku?->name ?? $sku?->sku ?? 'Quotation line'),
                    'needed' => $needed,
                    'available' => round((float) $available, 2),
                ];
            }
        }

        return $insufficient;
    }

    private function deductStockForLine(int $skuId, int $channelId, int $qty, int $orderId, ?int $userId): void
    {
        if ($skuId <= 0 || $qty <= 0) {
            throw new QuotationConversionException(
                'Invalid quotation line for stock deduction',
                'invalid_line'
            );
        }

        $locationId = ChannelStockResolver::resolveDeductionLocationIdForSku($skuId, $channelId, $qty);
        if (! $locationId) {
            throw new QuotationConversionException(
                "No stock location with enough quantity for SKU {$skuId}",
                'insufficient_stock'
            );
        }

        $inventory = SkuInventory::query()
            ->where('sku_id', $skuId)
            ->where('location_id', $locationId)
            ->lockForUpdate()
            ->first();

        if (! $inventory || (float) $inventory->quantity + 1e-9 < $qty) {
            $available = (float) ($inventory->quantity ?? 0);
            throw new QuotationConversionException(
                "Insufficient stock for SKU {$skuId} at location {$locationId}. Available: {$available}, needed: {$qty}.",
                'insufficient_stock'
            );
        }

        $inventory->decrement('quantity', $qty);

        InventoryTransaction::create([
            'sku_id' => $skuId,
            'location_id' => $locationId,
            'type' => 'OUT',
            'quantity' => $qty,
            'reference_type' => 'Order',
            'reference_id' => (string) $orderId,
            'user_id' => $userId,
            'notes' => 'Quotation conversion fulfillment',
        ]);
    }
}
