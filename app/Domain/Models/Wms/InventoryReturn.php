<?php

namespace App\Domain\Models\Wms;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use App\Application\Services\ChannelStockResolver;
use App\Infrastructure\Traits\IsIsolatedByUser;

class InventoryReturn extends Model
{
    use IsIsolatedByUser;

    protected $attributes = [
        'financial_deduction' => 0,
        'extra_shipping_fee' => 0,
        'refund_amount' => 0,
        'refund_method' => 'credit_note',
        'return_status' => 'return_requested',
        'inventory_status' => 'on_hold',
        'return_quantity' => 1,
    ];

    protected $fillable = [
        'inventory_order_id', 'platform_return_id', 'sku_code', 'return_quantity',
        'return_date', 'last_update_date', 'external_status', 'refund_amount', 'refund_method',
        'financial_deduction', 'extra_shipping_fee', 'source_channel', 'channel',
        'return_location', 'merchant_identifier', 'fulfillment_channel', 'metadata',
        'status', 'return_status', 'inventory_status', 'reason', 'disposition', 'user_id',
    ];

    protected $casts = [
        'return_quantity' => 'integer',
        'refund_amount' => 'decimal:2',
        'financial_deduction' => 'decimal:2',
        'extra_shipping_fee' => 'decimal:2',
        'return_date' => 'datetime',
        'last_update_date' => 'datetime',
        'metadata' => 'array',
    ];

    public static function mergeCreateDefaults(array $payload): array
    {
        $defaults = [
            'return_status' => 'return_requested',
            'inventory_status' => 'on_hold',
            'financial_deduction' => 0,
            'extra_shipping_fee' => 0,
            'refund_amount' => 0,
            'refund_method' => 'credit_note',
            'return_quantity' => 1,
        ];
        $external = strtolower(trim((string) ($payload['external_status'] ?? '')));
        if (str_contains($external, 'refund')) {
            $defaults['return_status'] = 'refunded';
        }
        if (str_contains($external, 'restock') || str_contains($external, 'returned to fba')) {
            $defaults['return_status'] = 'restocked';
            $defaults['inventory_status'] = 'restocked';
        }

        return array_merge($defaults, $payload);
    }

    public function inventoryOrder(): BelongsTo
    {
        return $this->belongsTo(\App\Domain\Models\Wms\InventoryOrder::class);
    }

    public function processReturn(): bool
    {
        DB::beginTransaction();
        try {
            $order = $this->inventoryOrder?->load('items.sku');
            if (! $order) {
                return false;
            }
            $channelId = (int) ($order->channel_id ?? 0);
            $isMerchantOrder = ChannelStockResolver::deductsFromMainStoreBucket($channelId);
            $defaultLocationId = (int) (ChannelStockResolver::resolveDeductionLocationIdForChannel($channelId) ?? 0);
            if ($defaultLocationId <= 0) {
                $defaultLocationId = (int) ($order->fulfillment_warehouse_id ?? $order->warehouse_id ?? $order->credit_warehouse_id ?? 1);
            }
            if ($defaultLocationId <= 0) {
                $defaultLocationId = 1;
            }
            $remainingQty = max(1, (int) ($this->return_quantity ?? 1));
            $candidateItems = $order->items;
            if (! empty($this->sku_code)) {
                $candidateItems = $candidateItems->filter(function ($item) {
                    return ($item->sku?->sku ?? null) === $this->sku_code || ($item->sku_code ?? null) === $this->sku_code;
                })->values();
            }
            foreach ($candidateItems as $item) {
                if ($remainingQty <= 0) {
                    break;
                }
                $itemQty = (int) ($item->quantity ?? 0);
                if ($itemQty <= 0) {
                    continue;
                }
                $qtyToProcess = min($remainingQty, $itemQty);
                $listingSku = $item->sku;
                $restockSkuId = (int) $item->sku_id;
                $restockLocationId = $defaultLocationId;
                if ($isMerchantOrder && $listingSku) {
                    $storeSkuId = (int) (ChannelStockResolver::resolveStoreSkuIdForListingSku($listingSku) ?? 0);
                    $storeChannelId = ChannelStockResolver::resolveMainStoreChannelId();
                    if ($storeSkuId > 0 && $storeChannelId > 0) {
                        $restockSkuId = $storeSkuId;
                        $restockLocationId = (int) (
                            ChannelStockResolver::resolveDeductionLocationIdAtChannel($storeSkuId, $storeChannelId, $qtyToProcess)
                            ?? ChannelStockResolver::resolveFirstLocationIdForChannel($storeChannelId)
                            ?? $defaultLocationId
                        );
                    }
                }
                if ($this->disposition === 'sellable' && $listingSku && $restockSkuId > 0 && $restockLocationId > 0) {
                    $skuInventory = \App\Domain\Models\Wms\SkuInventory::firstOrCreate(
                        ['sku_id' => $restockSkuId, 'location_id' => $restockLocationId],
                        ['quantity' => 0, 'reserved' => 0]
                    );
                    $skuInventory->increment('quantity', $qtyToProcess);
                    \App\Domain\Models\Wms\InventoryTransaction::create([
                        'sku_id' => $restockSkuId,
                        'location_id' => $restockLocationId,
                        'type' => 'IN',
                        'quantity' => $qtyToProcess,
                        'reference_type' => 'Return',
                        'reference_id' => $this->id,
                        'notes' => $isMerchantOrder
                            ? "Merchant return restocked to main store for order {$order->platform_order_id}"
                            : "Sellable return processed for order {$order->platform_order_id}",
                    ]);
                } elseif (in_array($this->disposition, ['damaged', 'unsellable']) && $listingSku && $restockSkuId > 0 && $restockLocationId > 0) {
                    $adjustmentService = new \App\Application\Services\InventoryAdjustmentService;
                    $adjustmentService->adjust([
                        'sku_id' => $restockSkuId,
                        'location_id' => $restockLocationId,
                        'quantity' => $qtyToProcess,
                        'type' => strtoupper($this->disposition),
                        'notes' => "Return for order {$order->platform_order_id} - Disposition: {$this->disposition}",
                    ]);
                }
                $remainingQty -= $qtyToProcess;
            }

            $updates = ['status' => 'completed', 'return_status' => 'restocked', 'inventory_status' => 'restocked', 'last_update_date' => now()];

            if ((float) ($this->refund_amount ?? 0) <= 0.0) {
                $diagnostics = $this->resolveCustomerCreditAmountWithDiagnostics();
                $credit = $diagnostics['amount'];

                if ($diagnostics['fallback_used']) {
                    Log::warning('inventory_return.credit_sku_fallback_used', [
                        'return_id' => $this->id,
                        'inventory_order_id' => $this->inventory_order_id,
                        'sku_code' => $this->sku_code,
                    ]);
                }

                if ($credit > 0.0) {
                    $this->refund_amount = $credit;
                    $updates['refund_amount'] = $credit;
                    $order->remaining_amount = round((float) ($order->remaining_amount ?? 0) - $credit, 2);
                    $order->save();
                } else {
                    Log::warning('inventory_return.zero_customer_credit', [
                        'return_id' => $this->id,
                        'inventory_order_id' => $this->inventory_order_id,
                        'sku_code' => $this->sku_code,
                        'matched_items' => $diagnostics['matched_items'],
                    ]);
                    $updates['metadata'] = array_merge((array) ($this->metadata ?? []), ['needs_refund_review' => true]);
                }
            }

            $this->update($updates);
            DB::commit();

            return true;
        } catch (\Exception $e) {
            DB::rollBack();

            return false;
        }
    }

    /**
     * Value owed back to the customer for the returned quantity (full line value,
     * regardless of disposition — unlike calculateLoss(), which reports the
     * seller's P&L loss, not what the customer is owed).
     */
    public function resolveCustomerCreditAmount(): float
    {
        return $this->resolveCustomerCreditAmountWithDiagnostics()['amount'];
    }

    /**
     * Same calculation as {@see resolveCustomerCreditAmount()}, plus diagnostics so callers
     * can tell a genuine zero-value return apart from a matching failure that silently
     * produced zero (which is exactly what let manual returns skip the customer ledger).
     *
     * @return array{amount: float, matched_items: int, fallback_used: bool}
     */
    public function resolveCustomerCreditAmountWithDiagnostics(): array
    {
        $order = $this->inventoryOrder;
        if (! $order) {
            return ['amount' => 0.0, 'matched_items' => 0, 'fallback_used' => false];
        }

        $allItems = $order->items ?? collect();
        $orderItems = $allItems;
        $fallbackUsed = false;

        if (! empty($this->sku_code)) {
            $needle = strtoupper(trim((string) $this->sku_code));
            $matched = $allItems->filter(function ($item) use ($needle) {
                $sku = strtoupper(trim((string) ($item->sku?->sku ?? '')));
                $skuCode = strtoupper(trim((string) ($item->sku_code ?? '')));

                return ($sku !== '' && $sku === $needle) || ($skuCode !== '' && $skuCode === $needle);
            });

            if ($matched->isEmpty()) {
                // No line item matched this SKU (casing/whitespace drift, or a mapping gap) —
                // fall back to all order items rather than resolving a guaranteed-wrong zero.
                $fallbackUsed = true;
            } else {
                $orderItems = $matched;
            }
        }

        $lineTotal = 0.0;
        $matchedItems = 0;
        $remainingQty = max(1, (int) ($this->return_quantity ?? 1));
        foreach ($orderItems as $item) {
            if ($remainingQty <= 0) {
                break;
            }
            $itemQty = (int) ($item->quantity ?? 0);
            if ($itemQty <= 0) {
                continue;
            }
            $qty = min($remainingQty, $itemQty);
            $unit = (float) ($item->unit_price ?? 0);
            $lineTotal += $qty * $unit;
            $remainingQty -= $qty;
            $matchedItems++;
        }

        return [
            'amount' => $lineTotal > 0 ? round($lineTotal, 2) : 0.0,
            'matched_items' => $matchedItems,
            'fallback_used' => $fallbackUsed,
        ];
    }

    public function calculateLoss(): float
    {
        $order = $this->inventoryOrder;
        if (! $order) {
            return 0;
        }
        $lineTotal = 0.0;
        $remainingQty = max(1, (int) ($this->return_quantity ?? 1));
        $orderItems = $order->items ?? collect();
        if (! empty($this->sku_code)) {
            $orderItems = $orderItems->filter(function ($item) {
                return ($item->sku?->sku ?? null) === $this->sku_code || ($item->sku_code ?? null) === $this->sku_code;
            });
        }
        foreach ($orderItems as $item) {
            if ($remainingQty <= 0) {
                break;
            }
            $itemQty = (int) ($item->quantity ?? 0);
            if ($itemQty <= 0) {
                continue;
            }
            $qty = min($remainingQty, $itemQty);
            $unit = (float) ($item->unit_price ?? 0);
            $lineTotal += $qty * $unit;
            $remainingQty -= $qty;
        }
        $effectiveTotal = $lineTotal > 0 ? $lineTotal : (float) $order->total_amount;
        if (in_array($this->disposition, ['damaged', 'unsellable'])) {
            return $effectiveTotal;
        }

        return (float) $order->shipping_amount;
    }
}
