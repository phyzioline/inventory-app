<?php

namespace App\Application\Services;

use App\Application\Support\TenantContext;
use App\Domain\Models\Wms\InventoryTransaction;
use App\Domain\Models\Wms\Sku;
use App\Domain\Models\Wms\SkuInventory;
use App\Infrastructure\Support\StockUpdateBroadcaster;
use Illuminate\Database\QueryException;
use RuntimeException;

/**
 * Cross-SKU / cross-location stock moves with TRANSFER + IN ledger rows
 * so Transfers UI and SKU movement tracker (تتبع) stay accurate.
 */
class StockRehomeTransferService
{
    /**
     * Move quantity from one SKU/location to another with transfer ledger.
     * Must be called inside an open DB transaction.
     *
     * @return array{
     *   moved: int,
     *   out_transaction_id: int,
     *   in_transaction_id: int,
     *   from_sku_id: int,
     *   to_sku_id: int,
     *   to_sku_code: string,
     * }
     */
    public function transferWithLedger(
        Sku $fromSku,
        int $fromLocationId,
        Sku $toSku,
        int $toLocationId,
        int $quantity,
        string $notes,
        ?string $clientTransferId = null,
    ): array {
        $qty = (int) $quantity;
        if ($qty <= 0 || $fromLocationId <= 0 || $toLocationId <= 0) {
            throw new RuntimeException('Invalid transfer quantity or location.');
        }

        if ((int) $fromSku->id === (int) $toSku->id && $fromLocationId === $toLocationId) {
            throw new RuntimeException('Source and destination are identical.');
        }

        $clientId = trim((string) ($clientTransferId ?? ''));
        if ($clientId !== '') {
            $existingOut = InventoryTransaction::query()
                ->where('type', 'TRANSFER')
                ->where('reference_type', 'transfer_out:'.$clientId)
                ->where('sku_id', (int) $fromSku->id)
                ->where('location_id', $fromLocationId)
                ->where('quantity', $qty)
                ->lockForUpdate()
                ->first();

            if ($existingOut) {
                $existingIn = null;
                if (! empty($existingOut->reference_id)) {
                    $existingIn = InventoryTransaction::query()->find((string) $existingOut->reference_id);
                }

                return [
                    'moved' => $qty,
                    'out_transaction_id' => (int) $existingOut->id,
                    'in_transaction_id' => (int) ($existingIn?->id ?? 0),
                    'from_sku_id' => (int) $fromSku->id,
                    'to_sku_id' => (int) $toSku->id,
                    'to_sku_code' => (string) ($toSku->sku ?? ''),
                    'idempotent' => true,
                ];
            }
        }

        $source = $this->lockedInventoryRow((int) $fromSku->id, $fromLocationId);
        if ((int) $source->quantity < $qty) {
            throw new RuntimeException(
                'Insufficient stock at source location (have '.(int) $source->quantity.', need '.$qty.').'
            );
        }

        $crossSuffix = (int) $fromSku->id !== (int) $toSku->id
            ? (' [cross-SKU: '.$fromSku->id.' → '.$toSku->id.']')
            : '';
        $notesSuffix = trim($notes);
        $notesOut = 'Transfer OUT to Location #'.$toLocationId.'. '.$notesSuffix.$crossSuffix;
        $notesIn = 'Transfer IN from Location #'.$fromLocationId.'. '.$notesSuffix.$crossSuffix;
        $refTypeOut = $clientId !== '' ? ('transfer_out:'.$clientId) : 'transfer_out';
        $refTypeIn = $clientId !== '' ? ('transfer_in:'.$clientId) : 'transfer_in';

        $source->decrement('quantity', $qty);
        $source->refresh();
        if ((int) $source->quantity < 0) {
            throw new RuntimeException('Source inventory became negative after transfer decrement.');
        }

        $ownerUserId = (int) ($fromSku->user_id ?? $toSku->user_id ?? TenantContext::id() ?? 0);

        $outTx = InventoryTransaction::create([
            'sku_id' => (int) $fromSku->id,
            'location_id' => $fromLocationId,
            'type' => 'TRANSFER',
            'quantity' => $qty,
            'balance_after' => (float) $source->quantity,
            'notes' => $notesOut,
            'reference_type' => $refTypeOut,
            'reference_id' => null,
        ]);
        $this->ensureTransactionOwner($outTx, $ownerUserId);

        $dest = $this->lockedInventoryRow((int) $toSku->id, $toLocationId);
        $dest->increment('quantity', $qty);
        $dest->refresh();

        $inTx = InventoryTransaction::create([
            'sku_id' => (int) $toSku->id,
            'location_id' => $toLocationId,
            'type' => 'IN',
            'quantity' => $qty,
            'balance_after' => (float) $dest->quantity,
            'notes' => $notesIn,
            'reference_type' => $refTypeIn,
            'reference_id' => (string) $outTx->id,
        ]);
        $this->ensureTransactionOwner($inTx, $ownerUserId);

        $outTx->update(['reference_id' => (string) $inTx->id]);

        $this->safeBroadcast([
            ['sku_id' => (int) $fromSku->id, 'location_id' => $fromLocationId],
            ['sku_id' => (int) $toSku->id, 'location_id' => $toLocationId],
        ]);

        return [
            'moved' => $qty,
            'out_transaction_id' => (int) $outTx->id,
            'in_transaction_id' => (int) $inTx->id,
            'from_sku_id' => (int) $fromSku->id,
            'to_sku_id' => (int) $toSku->id,
            'to_sku_code' => (string) ($toSku->sku ?? ''),
            'idempotent' => false,
        ];
    }

    /**
     * Move all positive qty rows for a listing SKU at channel locations into the main-store SKU,
     * writing TRANSFER ledger rows (visible in الترحيلات / تتبع الحركة).
     *
     * @return array{moved: float, transfers: list<array<string, mixed>>, store_sku_code: string|null}
     */
    public function rehomeChannelStockToStoreWithLedger(
        Sku $listingSku,
        int $sourceChannelId,
        string $reasonNotes,
        string $clientIdPrefix = 'rehome',
    ): array {
        $empty = ['moved' => 0.0, 'transfers' => [], 'store_sku_code' => null];

        if ((int) $listingSku->id <= 0 || $sourceChannelId <= 0) {
            return $empty;
        }

        $storeChannelId = ChannelStockResolver::resolveMainStoreChannelId();
        $storeSkuId = ChannelStockResolver::resolveStoreSkuIdForListingSku($listingSku);
        if ($storeSkuId === null || $storeSkuId <= 0 || $storeChannelId <= 0) {
            return $empty;
        }

        $storeSku = Sku::query()->find($storeSkuId);
        if (! $storeSku) {
            return $empty;
        }

        $sourceLocationIds = ChannelStockResolver::resolveLocationIdsForChannel($sourceChannelId);
        if ($sourceLocationIds === []) {
            return $empty;
        }

        $storeLocationId = ChannelStockResolver::resolveDeductionLocationIdAtChannel((int) $storeSkuId, $storeChannelId, 1)
            ?? ChannelStockResolver::resolveFirstLocationIdForChannel($storeChannelId);
        if ($storeLocationId === null || $storeLocationId <= 0) {
            return $empty;
        }

        $rows = SkuInventory::query()
            ->where('sku_id', (int) $listingSku->id)
            ->whereIn('location_id', $sourceLocationIds)
            ->where('quantity', '>', 0)
            ->lockForUpdate()
            ->get();

        $moved = 0.0;
        $transfers = [];
        $index = 0;

        foreach ($rows as $row) {
            $qty = (int) round((float) ($row->quantity ?? 0));
            if ($qty <= 0) {
                continue;
            }

            $clientId = sprintf(
                '%s:%d:%d:%d:%d',
                $clientIdPrefix,
                (int) $listingSku->id,
                (int) $row->location_id,
                (int) $storeSkuId,
                $index
            );
            $index++;

            $result = $this->transferWithLedger(
                $listingSku,
                (int) $row->location_id,
                $storeSku,
                (int) $storeLocationId,
                $qty,
                $reasonNotes,
                $clientId,
            );

            $moved += (float) $result['moved'];
            $transfers[] = $result;
        }

        return [
            'moved' => $moved,
            'transfers' => $transfers,
            'store_sku_code' => (string) ($storeSku->sku ?? ''),
        ];
    }

    /**
     * FBA → Merchant conversion: move FBA warehouse stock to the linked store SKU before channel change.
     *
     * @return array{moved: float, store_sku_code: string|null, transfers: list<array<string, mixed>>}
     */
    public function rehomeFbaStockToStoreForMerchantConversion(Sku $sku, int $fbaChannelId): array
    {
        return $this->rehomeChannelStockToStoreWithLedger(
            $sku,
            $fbaChannelId,
            'Auto-rehome FBA stock → المحل on FBA→Merchant channel change',
            'fba2merchant',
        );
    }

    /**
     * Phantom merchant-bucket stock → main store (with ledger).
     *
     * @return array{moved: float, store_sku_code: string|null, transfers: list<array<string, mixed>>}
     */
    public function reconcilePhantomMerchantStockWithLedger(Sku $listingSku, int $merchantChannelId): array
    {
        if (! ChannelStockResolver::deductsFromMainStoreBucket($merchantChannelId)) {
            return ['moved' => 0.0, 'transfers' => [], 'store_sku_code' => null];
        }

        return $this->rehomeChannelStockToStoreWithLedger(
            $listingSku,
            $merchantChannelId,
            'Reconcile phantom merchant stock → المحل',
            'phantom-merchant',
        );
    }

    private function ensureTransactionOwner(InventoryTransaction $tx, int $ownerUserId): void
    {
        if ($ownerUserId <= 0 || (int) ($tx->user_id ?? 0) > 0) {
            return;
        }

        $tx->forceFill(['user_id' => $ownerUserId])->save();
    }

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
     * @param  list<array{sku_id: int, location_id: int}>  $pairs
     */
    private function safeBroadcast(array $pairs): void
    {
        try {
            StockUpdateBroadcaster::broadcastTransferPairs($pairs);
        } catch (\Throwable $e) {
            report($e);
        }
    }
}
