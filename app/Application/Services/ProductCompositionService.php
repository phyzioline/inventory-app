<?php

namespace App\Application\Services;

use App\Application\Support\TenantContext;
use App\Domain\Models\Wms\InventoryOffer;
use App\Domain\Models\Wms\InventoryTransaction;
use App\Domain\Models\Wms\ProductComposition;
use App\Domain\Models\Wms\Sku;
use App\Infrastructure\Support\StockUpdateBroadcaster;
use Illuminate\Validation\ValidationException;

/**
 * Manual "Product B = N x Product A" links between InventoryOffers, plus the manual
 * Unpack/Pack stock-conversion action that moves real stock between the two SKUs at a
 * chosen location, multiplied by the link's ratio.
 *
 * Deliberately NOT a cascading BOM engine: normal sale-time deduction is untouched —
 * a "kit" offer keeps its own real, independently-held SkuInventory. This service only
 * powers a manual, user-triggered conversion (see CLAUDE.md-adjacent design notes in
 * the implementation plan for this feature).
 */
class ProductCompositionService
{
    public function __construct(
        private readonly StockRehomeTransferService $stockRehome,
    ) {}

    public function attachComponent(InventoryOffer $parent, InventoryOffer $component, int $quantityPer, ?string $notes = null): ProductComposition
    {
        if ((int) $parent->id === (int) $component->id) {
            throw ValidationException::withMessages([
                'component_offer_id' => ['لا يمكن ربط عرض بنفسه.'],
            ]);
        }

        if ($quantityPer < 1) {
            throw ValidationException::withMessages([
                'quantity_per' => ['الكمية يجب أن تكون 1 على الأقل.'],
            ]);
        }

        $duplicate = ProductComposition::query()
            ->where('parent_offer_id', $parent->id)
            ->where('component_offer_id', $component->id)
            ->exists();
        if ($duplicate) {
            throw ValidationException::withMessages([
                'component_offer_id' => ['هذا الربط موجود بالفعل.'],
            ]);
        }

        // Flat kits only: a component may not itself already be a parent/kit (no nested BOM),
        // and a parent may not already be used as someone else's component (no cycles either way).
        if ($component->components()->exists()) {
            throw ValidationException::withMessages([
                'component_offer_id' => ['لا يمكن استخدام عرض له مكوّنات خاصة به كمكوّن — غير مسموح بتركيب متداخل.'],
            ]);
        }

        if ($parent->usedInCompositions()->exists()) {
            throw ValidationException::withMessages([
                'parent_offer_id' => ['هذا العرض مستخدم بالفعل كمكوّن ضمن عرض آخر، فلا يمكن أن يصبح تركيبة بنفسه — غير مسموح بتركيب متداخل.'],
            ]);
        }

        return ProductComposition::create([
            'parent_offer_id' => $parent->id,
            'component_offer_id' => $component->id,
            'quantity_per' => $quantityPer,
            'notes' => $notes,
        ]);
    }

    public function updateComponent(ProductComposition $composition, int $quantityPer, ?string $notes = null): ProductComposition
    {
        if ($quantityPer < 1) {
            throw ValidationException::withMessages([
                'quantity_per' => ['الكمية يجب أن تكون 1 على الأقل.'],
            ]);
        }

        $composition->update([
            'quantity_per' => $quantityPer,
            'notes' => $notes,
        ]);

        return $composition;
    }

    public function detachComponent(ProductComposition $composition): void
    {
        $composition->delete();
    }

    /**
     * Unpack N parent-offer units into N x ratio component-offer units.
     * Must be called inside an open DB transaction.
     *
     * @return array{source_deducted:int, destination_produced:int, out_transaction_id:int, in_transaction_id:int, idempotent:bool, unpacked:int, produced:int, ratio:int}
     */
    public function unpack(
        InventoryOffer $parentOffer,
        InventoryOffer $componentOffer,
        Sku $parentSku,
        int $parentLocationId,
        Sku $componentSku,
        int $componentLocationId,
        int $unpackQty,
        ?string $notes = null,
        ?string $clientOperationId = null,
    ): array {
        if ($unpackQty <= 0 || $parentLocationId <= 0 || $componentLocationId <= 0) {
            throw ValidationException::withMessages(['quantity' => ['كمية أو موقع غير صالح.']]);
        }

        $this->assertSkuBelongsToOffer($parentSku, $parentOffer);
        $this->assertSkuBelongsToOffer($componentSku, $componentOffer);

        $composition = $this->findComposition($parentOffer, $componentOffer);
        $ratio = (int) $composition->quantity_per;
        $produced = $unpackQty * $ratio;

        $noteText = trim(
            'فك: '.$unpackQty.' × '.$parentOffer->name.' → '.$produced.' × '.$componentOffer->name
            .($notes ? '. '.$notes : '')
        );

        $result = $this->applyConversion(
            $parentSku, $parentLocationId, $unpackQty,
            $componentSku, $componentLocationId, $produced,
            'bundle_unpack', $noteText, $clientOperationId,
        );

        return array_merge($result, [
            'unpacked' => $unpackQty,
            'produced' => $produced,
            'ratio' => $ratio,
        ]);
    }

    /**
     * Pack N component-offer units (must be an exact multiple of the ratio) back into
     * parent-offer units. Must be called inside an open DB transaction.
     *
     * @return array{source_deducted:int, destination_produced:int, out_transaction_id:int, in_transaction_id:int, idempotent:bool, packed:int, produced:int, ratio:int}
     */
    public function pack(
        InventoryOffer $parentOffer,
        InventoryOffer $componentOffer,
        Sku $componentSku,
        int $componentLocationId,
        Sku $parentSku,
        int $parentLocationId,
        int $packQty,
        ?string $notes = null,
        ?string $clientOperationId = null,
    ): array {
        if ($packQty <= 0 || $parentLocationId <= 0 || $componentLocationId <= 0) {
            throw ValidationException::withMessages(['quantity' => ['كمية أو موقع غير صالح.']]);
        }

        $this->assertSkuBelongsToOffer($parentSku, $parentOffer);
        $this->assertSkuBelongsToOffer($componentSku, $componentOffer);

        $composition = $this->findComposition($parentOffer, $componentOffer);
        $ratio = (int) $composition->quantity_per;

        if ($packQty % $ratio !== 0) {
            $nearest = intdiv($packQty, $ratio) * $ratio;
            throw ValidationException::withMessages([
                'quantity' => ["كمية التجميع يجب أن تكون من مضاعفات {$ratio} (أقرب كمية صالحة: {$nearest})."],
            ]);
        }

        $producedParentUnits = intdiv($packQty, $ratio);
        $noteText = trim(
            'تجميع: '.$packQty.' × '.$componentOffer->name.' → '.$producedParentUnits.' × '.$parentOffer->name
            .($notes ? '. '.$notes : '')
        );

        $result = $this->applyConversion(
            $componentSku, $componentLocationId, $packQty,
            $parentSku, $parentLocationId, $producedParentUnits,
            'bundle_pack', $noteText, $clientOperationId,
        );

        return array_merge($result, [
            'packed' => $packQty,
            'produced' => $producedParentUnits,
            'ratio' => $ratio,
        ]);
    }

    private function findComposition(InventoryOffer $parentOffer, InventoryOffer $componentOffer): ProductComposition
    {
        $composition = ProductComposition::query()
            ->where('parent_offer_id', $parentOffer->id)
            ->where('component_offer_id', $componentOffer->id)
            ->first();

        if (! $composition) {
            throw ValidationException::withMessages([
                'component_offer_id' => ['لا يوجد ربط تركيب بين هذين العرضين.'],
            ]);
        }

        return $composition;
    }

    private function assertSkuBelongsToOffer(Sku $sku, InventoryOffer $offer): void
    {
        if ((int) $sku->offer_id !== (int) $offer->id) {
            throw ValidationException::withMessages([
                'sku_id' => ['الـ SKU المحدد لا ينتمي لهذا العرض.'],
            ]);
        }
    }

    /**
     * Generic N:M stock conversion with paired TRANSFER/IN ledger rows, mirroring
     * StockRehomeTransferService::transferWithLedger()'s pattern but with independent
     * source/destination quantities instead of a strict 1:1 move.
     *
     * @return array{source_deducted:int, destination_produced:int, out_transaction_id:int, in_transaction_id:int, idempotent:bool}
     */
    private function applyConversion(
        Sku $sourceSku,
        int $sourceLocationId,
        int $sourceQty,
        Sku $destSku,
        int $destLocationId,
        int $destQty,
        string $refPrefix,
        string $notes,
        ?string $clientOperationId,
    ): array {
        $clientId = trim((string) ($clientOperationId ?? ''));

        if ($clientId !== '') {
            $existingOut = InventoryTransaction::query()
                ->where('type', 'TRANSFER')
                ->where('reference_type', $refPrefix.'_out:'.$clientId)
                ->where('sku_id', (int) $sourceSku->id)
                ->where('location_id', $sourceLocationId)
                ->where('quantity', $sourceQty)
                ->lockForUpdate()
                ->first();

            if ($existingOut) {
                $existingIn = $existingOut->reference_id
                    ? InventoryTransaction::query()->find((string) $existingOut->reference_id)
                    : null;

                return [
                    'source_deducted' => $sourceQty,
                    'destination_produced' => $destQty,
                    'out_transaction_id' => (int) $existingOut->id,
                    'in_transaction_id' => (int) ($existingIn?->id ?? 0),
                    'idempotent' => true,
                ];
            }
        }

        $source = $this->stockRehome->lockedInventoryRow((int) $sourceSku->id, $sourceLocationId);
        if ((int) $source->quantity < $sourceQty) {
            throw ValidationException::withMessages([
                'quantity' => ["المخزون غير كافٍ (المتاح: {$source->quantity}, المطلوب: {$sourceQty})."],
            ]);
        }

        $ownerUserId = (int) ($sourceSku->user_id ?? $destSku->user_id ?? TenantContext::id() ?? 0);

        $source->decrement('quantity', $sourceQty);
        $source->refresh();
        if ((int) $source->quantity < 0) {
            throw ValidationException::withMessages(['quantity' => ['أصبح المخزون سالباً بعد الخصم — تم إيقاف العملية.']]);
        }

        $outTx = InventoryTransaction::create([
            'sku_id' => (int) $sourceSku->id,
            'location_id' => $sourceLocationId,
            'type' => 'TRANSFER',
            'quantity' => $sourceQty,
            'balance_after' => (float) $source->quantity,
            'notes' => $notes,
            'reference_type' => $clientId !== '' ? ($refPrefix.'_out:'.$clientId) : ($refPrefix.'_out'),
            'reference_id' => null,
        ]);
        $this->ensureTransactionOwner($outTx, $ownerUserId);

        $dest = $this->stockRehome->lockedInventoryRow((int) $destSku->id, $destLocationId);
        $dest->increment('quantity', $destQty);
        $dest->refresh();

        $inTx = InventoryTransaction::create([
            'sku_id' => (int) $destSku->id,
            'location_id' => $destLocationId,
            'type' => 'IN',
            'quantity' => $destQty,
            'balance_after' => (float) $dest->quantity,
            'notes' => $notes,
            'reference_type' => $clientId !== '' ? ($refPrefix.'_in:'.$clientId) : ($refPrefix.'_in'),
            'reference_id' => (string) $outTx->id,
        ]);
        $this->ensureTransactionOwner($inTx, $ownerUserId);

        $outTx->update(['reference_id' => (string) $inTx->id]);

        $this->safeBroadcast([
            ['sku_id' => (int) $sourceSku->id, 'location_id' => $sourceLocationId],
            ['sku_id' => (int) $destSku->id, 'location_id' => $destLocationId],
        ]);

        return [
            'source_deducted' => $sourceQty,
            'destination_produced' => $destQty,
            'out_transaction_id' => (int) $outTx->id,
            'in_transaction_id' => (int) $inTx->id,
            'idempotent' => false,
        ];
    }

    private function ensureTransactionOwner(InventoryTransaction $tx, int $ownerUserId): void
    {
        if ($ownerUserId <= 0 || (int) ($tx->user_id ?? 0) > 0) {
            return;
        }

        $tx->forceFill(['user_id' => $ownerUserId])->save();
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
