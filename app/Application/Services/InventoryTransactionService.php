<?php

namespace App\Application\Services;

use Illuminate\Support\Facades\Log;
use App\Domain\Models\Wms\InventoryTransaction;
use App\Infrastructure\Support\StockUpdateBroadcaster;

class InventoryTransactionService
{
    /**
     * Record an inventory transaction.
     *
     * @param  string  $type  'IN' or 'OUT'
     * @param  float  $balanceAfter  Current inventory balance after this transaction (not stored, for logging)
     * @param  string  $referenceType  Type of reference (e.g., 'ADJUSTMENT', 'ORDER', 'TRANSFER')
     * @param  int|null  $referenceId  ID of the reference record
     * @param  string|null  $notes  Additional notes (not stored in current schema, for logging)
     */
    public function recordTransaction(
        int $skuId,
        int $locationId,
        string $type,
        float $quantity,
        float $balanceAfter,
        string $referenceType,
        ?int $referenceId = null,
        ?string $notes = null
    ): InventoryTransaction {
        try {
            $transaction = InventoryTransaction::create([
                'sku_id' => $skuId,
                'location_id' => $locationId,
                'type' => strtoupper($type), // Ensure uppercase
                'quantity' => abs($quantity), // Always positive
                'reference_type' => $referenceType,
                'reference_id' => $referenceId ? (string) $referenceId : null, // Convert to string as per schema
                'user_id' => auth()->id(),
            ]);

            // Log additional info if notes provided
            if ($notes) {
                Log::info('Inventory transaction recorded', [
                    'transaction_id' => $transaction->id,
                    'sku_id' => $skuId,
                    'balance_after' => $balanceAfter,
                    'notes' => $notes,
                ]);
            }

            StockUpdateBroadcaster::dispatch(
                $skuId,
                $locationId,
                StockUpdateBroadcaster::mapReferenceType($referenceType)
            );

            return $transaction;
        } catch (\Exception $e) {
            Log::error('Failed to record inventory transaction: '.$e->getMessage(), [
                'sku_id' => $skuId,
                'location_id' => $locationId,
                'type' => $type,
                'quantity' => $quantity,
                'balance_after' => $balanceAfter,
                'notes' => $notes,
            ]);
            throw $e;
        }
    }
}
