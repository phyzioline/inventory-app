<?php

namespace App\Application\Services;

use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use App\Domain\Models\Wms\InventoryAdjustment;
use App\Domain\Models\Wms\InventoryTransaction;
use App\Domain\Models\Wms\PurchaseBatch;
use App\Domain\Models\Wms\PurchaseBatchItem;
use App\Domain\Models\Wms\Sku;
use App\Domain\Models\Wms\SkuInventory;

class InventoryAdjustmentService
{
    private function purchaseBatchItemsHasRemainingQuantity(): bool
    {
        return Schema::hasTable('purchase_batch_items')
            && Schema::hasColumn('purchase_batch_items', 'remaining_quantity');
    }

    /**
     * Adjust stock with FIFO costing.
     */
    public function adjust(array $data)
    {
        return DB::transaction(function () use ($data) {
            $skuId = $data['sku_id'];
            $locationId = $data['location_id'];
            $quantity = $data['quantity']; // Absolute number
            $type = $data['type']; // DAMAGE, LOST, THEFT, EXPIRED, CORRECTION, OPENING_BALANCE
            $notes = $data['notes'] ?? null;
            $userId = Auth::id() ?? 1;

            // Determine if this is an addition or removal
            $additionTypes = ['CORRECTION', 'OPENING_BALANCE', 'STOCK_IN'];
            $isAddition = in_array($type, $additionTypes) && $quantity > 0;

            // 1. Update SkuInventory
            $inventory = SkuInventory::firstOrCreate(
                ['sku_id' => $skuId, 'location_id' => $locationId],
                ['quantity' => 0]
            );

            if ($isAddition) {
                $inventory->increment('quantity', $quantity);
            } else {
                if ($inventory->quantity < $quantity) {
                    throw new \Exception("Insufficient inventory for adjustment. Current: {$inventory->quantity}");
                }
                $inventory->decrement('quantity', $quantity);
            }

            // 2. Create Transaction record
            InventoryTransaction::create([
                'sku_id' => $skuId,
                'location_id' => $locationId,
                'type' => $isAddition ? 'IN' : 'OUT',
                'quantity' => $quantity,
                'reference_type' => 'Adjustment',
                'notes' => "{$type}: {$notes}",
            ]);

            $totalImpactAmount = 0;
            $adjustments = [];

            if ($isAddition) {
                $sku = Sku::query()->with('offer')->find($skuId);
                $unitPrice = (float) ($sku?->cost_price ?? 0);
                $lineTotal = round($quantity * $unitPrice, 2);

                $header = PurchaseBatch::create([
                    'user_id' => $userId,
                    'batch_number' => PurchaseBatch::generateBatchNumber(),
                    'vendor_id' => null,
                    'status' => 'received',
                    'location_id' => $locationId,
                    'received_at' => now(),
                    'currency' => 'EGP',
                    'subtotal' => $lineTotal,
                    'grand_total' => $lineTotal,
                    'notes' => 'Stock-in via inventory adjustment ('.$type.')',
                ]);

                $linePayload = [
                    'purchase_batch_id' => $header->id,
                    'master_product_id' => $sku?->offer?->master_product_id,
                    'sku_id' => $skuId,
                    'quantity' => $quantity,
                    'received_quantity' => $quantity,
                    'unit_price' => $unitPrice,
                    'total_price' => $lineTotal,
                ];
                if ($this->purchaseBatchItemsHasRemainingQuantity()) {
                    $linePayload['remaining_quantity'] = $quantity;
                }

                $lineItem = PurchaseBatchItem::create($linePayload);

                $adjustment = InventoryAdjustment::create([
                    'sku_id' => $skuId,
                    'location_id' => $locationId,
                    'type' => $type,
                    'quantity' => $quantity,
                    'notes' => $notes,
                    'purchase_batch_item_id' => $lineItem->id,
                    'unit_cost' => $unitPrice,
                    'total_loss_amount' => 0,
                    'user_id' => $userId,
                ]);
                $adjustments[] = $adjustment;
            } else {
                $remainingToAdjust = $quantity;

                if ($this->purchaseBatchItemsHasRemainingQuantity()) {
                    $layers = PurchaseBatchItem::query()
                        ->where('sku_id', $skuId)
                        ->where('remaining_quantity', '>', 0)
                        ->orderBy('created_at', 'asc')
                        ->get();

                    if ($layers->isEmpty()) {
                        $sku = Sku::query()->find($skuId);
                        $unitPrice = (float) ($sku?->cost_price ?? 0);
                        $totalImpactAmount += $quantity * $unitPrice;
                        $adjustments[] = InventoryAdjustment::create([
                            'sku_id' => $skuId,
                            'location_id' => $locationId,
                            'type' => $type,
                            'quantity' => $quantity,
                            'notes' => ($notes ? $notes.' ' : '').'(No purchase FIFO rows; loss from SKU unit cost)',
                            'purchase_batch_item_id' => null,
                            'unit_cost' => $unitPrice,
                            'total_loss_amount' => $quantity * $unitPrice,
                            'user_id' => $userId,
                        ]);
                        $remainingToAdjust = 0;
                    }

                    foreach ($layers as $layer) {
                        if ($remainingToAdjust <= 0) {
                            break;
                        }

                        $layerRemaining = (float) ($layer->remaining_quantity ?? 0);
                        $takeFromThisBatch = min($layerRemaining, $remainingToAdjust);
                        $layer->decrement('remaining_quantity', $takeFromThisBatch);

                        $unit = (float) ($layer->unit_price ?? 0);
                        $loss = $takeFromThisBatch * $unit;
                        $totalImpactAmount += $loss;

                        $adjustments[] = InventoryAdjustment::create([
                            'sku_id' => $skuId,
                            'location_id' => $locationId,
                            'type' => $type,
                            'quantity' => $takeFromThisBatch,
                            'notes' => $notes,
                            'purchase_batch_item_id' => $layer->id,
                            'unit_cost' => $unit,
                            'total_loss_amount' => $loss,
                            'user_id' => $userId,
                        ]);

                        $remainingToAdjust -= $takeFromThisBatch;
                    }
                } else {
                    $sku = Sku::query()->find($skuId);
                    $unitPrice = (float) ($sku?->cost_price ?? 0);
                    $totalImpactAmount += $quantity * $unitPrice;
                    $adjustments[] = InventoryAdjustment::create([
                        'sku_id' => $skuId,
                        'location_id' => $locationId,
                        'type' => $type,
                        'quantity' => $quantity,
                        'notes' => ($notes ? $notes.' ' : '').'(FIFO layers unavailable; loss from SKU unit cost)',
                        'purchase_batch_item_id' => null,
                        'unit_cost' => $unitPrice,
                        'total_loss_amount' => $quantity * $unitPrice,
                        'user_id' => $userId,
                    ]);
                    $remainingToAdjust = 0;
                }

                if ($remainingToAdjust > 0) {
                    $adjustments[] = InventoryAdjustment::create([
                        'sku_id' => $skuId,
                        'location_id' => $locationId,
                        'type' => $type,
                        'quantity' => $remainingToAdjust,
                        'notes' => ($notes ? $notes.' ' : '').'(No batch layer for '.$remainingToAdjust.' units)',
                        'user_id' => $userId,
                    ]);
                }
            }

            return [
                'success' => true,
                'adjustments' => $adjustments,
                'total_impact' => $totalImpactAmount,
            ];
        });
    }
}
