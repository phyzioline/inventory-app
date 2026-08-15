<?php

use App\Application\Services\ChannelStockResolver;
use App\Application\Services\PurchaseImportService;
use App\Domain\Models\Wms\Channel;
use App\Domain\Models\Wms\InventoryLocation;
use App\Domain\Models\Wms\InventoryOffer;
use App\Domain\Models\Wms\InventoryTransaction;
use App\Domain\Models\Wms\MasterProduct;
use App\Domain\Models\Wms\PurchaseBatch;
use App\Domain\Models\Wms\PurchaseBatchItem;
use App\Domain\Models\Wms\Sku;
use App\Domain\Models\Wms\SkuInventory;
use App\Models\User;

describe('Received purchase edit SKU mapping', function () {
    function seedStoreSku(User $user, int $storeChannelId, string $name, string $code): array
    {
        $master = MasterProduct::query()->create([
            'internal_name' => $name,
            'is_active' => true,
        ]);
        $master->update(['user_id' => $user->id]);

        $offer = InventoryOffer::query()->create([
            'master_product_id' => $master->id,
            'name' => $name,
            'type' => 'single',
        ]);
        $offer->update(['user_id' => $user->id]);

        $sku = Sku::query()->create([
            'offer_id' => $offer->id,
            'sku' => $code,
            'channel_id' => $storeChannelId,
            'cost_price' => 10,
            'selling_price' => 20,
            'is_active' => true,
        ]);
        $sku->update(['user_id' => $user->id]);

        return ['master' => $master, 'sku' => $sku];
    }

    it('treats untagged المحل warehouse as the store channel for SKU compatibility', function () {
        ChannelStockResolver::clearCache();

        $user = User::factory()->create();
        $this->actingAs($user);

        $store = Channel::query()->create([
            'name' => 'المحل',
            'slug' => 'store-compat-'.uniqid(),
            'type' => 'pos',
            'is_active' => true,
        ]);
        $store->update(['user_id' => $user->id]);

        $location = InventoryLocation::query()->create([
            'name' => 'المحل',
            'type' => 'physical',
            'channel_id' => null,
            'is_active' => true,
        ]);
        $location->update(['user_id' => $user->id]);

        $seeded = seedStoreSku($user, (int) $store->id, 'Needles', 'PHY-NEEDLES-'.uniqid());

        $svc = app(PurchaseImportService::class);
        expect($svc->resolveReceiveChannelIdForLocation((int) $location->id))->toBe((int) $store->id);
        expect($svc->isSkuCompatibleWithReceiveLocation($seeded['sku']->fresh(), (int) $location->id))->toBeTrue();
    });

    it('does not remap a newly added product onto another SKU already received on the same invoice', function () {
        ChannelStockResolver::clearCache();

        $user = User::factory()->create();
        $this->actingAs($user);

        $store = Channel::query()->create([
            'name' => 'المحل',
            'slug' => 'store-po-edit-'.uniqid(),
            'type' => 'pos',
            'is_active' => true,
        ]);
        $store->update(['user_id' => $user->id]);

        $location = InventoryLocation::query()->create([
            'name' => 'المحل',
            'type' => 'physical',
            'channel_id' => null,
            'is_active' => true,
        ]);
        $location->update(['user_id' => $user->id]);

        $needles = seedStoreSku($user, (int) $store->id, 'ابر توني مقاس 3', 'PHY464-T-'.uniqid());
        $tape = seedStoreSku($user, (int) $store->id, 'KT ارس', 'PHY180-T-'.uniqid());

        $batch = PurchaseBatch::create([
            'batch_number' => 'PB-TEST-'.uniqid(),
            'user_id' => $user->id,
            'status' => 'received',
            'location_id' => $location->id,
            'received_at' => now(),
            'currency' => 'EGP',
            'subtotal' => 0,
            'tax_amount' => 0,
            'grand_total' => 0,
        ]);

        $needlesLine = PurchaseBatchItem::create([
            'purchase_batch_id' => $batch->id,
            'master_product_id' => $needles['master']->id,
            'sku_id' => $needles['sku']->id,
            'raw_description' => 'ابر توني مقاس 3',
            'product_matched' => true,
            'quantity' => 15,
            'received_quantity' => 15,
            'unit_price' => 325,
            'total_price' => 4875,
            'batch_cost_id' => 'BC-'.$batch->batch_number,
        ]);

        $svc = app(PurchaseImportService::class);
        $svc->applyReceivedStockDelta(
            $batch,
            (int) $needles['sku']->id,
            (int) $location->id,
            15,
            'seed needles receive'
        );

        $this->postJson("/api/inventory/purchases/smart-import/batches/{$batch->id}/add-item", [
            'raw_description' => 'بند جديد',
            'quantity' => 0,
            'unit_price' => 0,
        ])->assertCreated();

        $tapeLine = PurchaseBatchItem::query()
            ->where('purchase_batch_id', $batch->id)
            ->where('id', '!=', $needlesLine->id)
            ->firstOrFail();

        $response = $this->putJson("/api/inventory/purchases/smart-import/batches/{$batch->id}", [
            'items' => [
                [
                    'id' => $needlesLine->id,
                    'master_product_id' => $needles['master']->id,
                    'sku_id' => $needles['sku']->id,
                    'quantity' => 15,
                    'unit_price' => 325,
                    'raw_description' => 'ابر توني مقاس 3',
                ],
                [
                    'id' => $tapeLine->id,
                    'master_product_id' => $tape['master']->id,
                    // Corrupt payload the way the old resolver did: reuse the needles SKU.
                    'sku_id' => $needles['sku']->id,
                    'quantity' => 20,
                    'unit_price' => 80,
                    'raw_description' => 'KT ارس',
                ],
            ],
        ]);

        $response->assertOk();

        expect((int) $tapeLine->fresh()->sku_id)->toBe((int) $tape['sku']->id);
        expect((int) $needlesLine->fresh()->sku_id)->toBe((int) $needles['sku']->id);

        $needlesQty = (float) SkuInventory::query()
            ->where('sku_id', $needles['sku']->id)
            ->where('location_id', $location->id)
            ->value('quantity');
        $tapeQty = (float) SkuInventory::query()
            ->where('sku_id', $tape['sku']->id)
            ->where('location_id', $location->id)
            ->value('quantity');

        expect($needlesQty)->toBe(15.0);
        expect($tapeQty)->toBe(20.0);

        $needlesNet = (float) InventoryTransaction::query()
            ->where('reference_type', PurchaseBatch::class)
            ->where('reference_id', $batch->id)
            ->where('sku_id', $needles['sku']->id)
            ->get()
            ->sum(fn ($t) => $t->type === 'IN' ? (float) $t->quantity : -(float) $t->quantity);
        expect($needlesNet)->toBe(15.0);
    });

    it('does not double-post stock when older purchase movements used the monolith class name', function () {
        ChannelStockResolver::clearCache();

        $user = User::factory()->create();
        $this->actingAs($user);

        $store = Channel::query()->create([
            'name' => 'المحل',
            'slug' => 'store-legacy-po-'.uniqid(),
            'type' => 'pos',
            'is_active' => true,
        ]);
        $store->update(['user_id' => $user->id]);

        $location = InventoryLocation::query()->create([
            'name' => 'المحل',
            'type' => 'physical',
            'channel_id' => null,
            'is_active' => true,
        ]);
        $location->update(['user_id' => $user->id]);

        $needles = seedStoreSku($user, (int) $store->id, 'kt 3ns tex', 'PHY53-T-'.uniqid());

        $batch = PurchaseBatch::create([
            'batch_number' => 'PB-LEGACY-'.uniqid(),
            'user_id' => $user->id,
            'status' => 'received',
            'location_id' => $location->id,
            'received_at' => now(),
            'currency' => 'EGP',
            'subtotal' => 0,
            'tax_amount' => 0,
            'grand_total' => 0,
        ]);

        $line = PurchaseBatchItem::create([
            'purchase_batch_id' => $batch->id,
            'master_product_id' => $needles['master']->id,
            'sku_id' => $needles['sku']->id,
            'raw_description' => 'kt 3ns tex',
            'product_matched' => true,
            'quantity' => 18,
            'received_quantity' => 18,
            'unit_price' => 300,
            'total_price' => 5400,
            'batch_cost_id' => 'BC-'.$batch->batch_number,
        ]);

        SkuInventory::query()->create([
            'sku_id' => $needles['sku']->id,
            'location_id' => $location->id,
            'quantity' => 18,
            'reserved' => 0,
            'user_id' => $user->id,
        ]);

        InventoryTransaction::query()->create([
            'sku_id' => $needles['sku']->id,
            'location_id' => $location->id,
            'type' => 'IN',
            'quantity' => 18,
            'reference_type' => 'Modules\\Inventory\\app\\Domain\\Models\\Wms\\PurchaseBatch',
            'reference_id' => $batch->id,
            'notes' => 'legacy morph receive',
            'user_id' => $user->id,
        ]);

        $this->putJson("/api/inventory/purchases/smart-import/batches/{$batch->id}", [
            'items' => [[
                'id' => $line->id,
                'master_product_id' => $needles['master']->id,
                'sku_id' => $needles['sku']->id,
                'quantity' => 18,
                'unit_price' => 300,
                'raw_description' => 'kt 3ns tex',
            ]],
        ])->assertOk();

        expect((float) SkuInventory::query()
            ->where('sku_id', $needles['sku']->id)
            ->where('location_id', $location->id)
            ->value('quantity'))->toBe(18.0);
    });
});
