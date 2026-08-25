<?php

use App\Models\User;
use App\Application\Services\ChannelStockResolver;
use App\Domain\Models\Wms\Channel;
use App\Domain\Models\Wms\InventoryLocation;
use App\Domain\Models\Wms\InventoryOffer;
use App\Domain\Models\Wms\InventoryRemovalItem;
use App\Domain\Models\Wms\InventoryRemovalOrder;
use App\Domain\Models\Wms\InventoryTransaction;
use App\Domain\Models\Wms\MasterProduct;
use App\Domain\Models\Wms\Sku;
use App\Domain\Models\Wms\SkuInventory;

describe('Amazon removal receive deducts the FBA balance', function () {
    function seedRemovalFbaDeductionFixture(User $user): array
    {
        ChannelStockResolver::clearCache();

        $storeChannel = Channel::query()->create([
            'name' => 'المحل',
            'slug' => 'store-'.uniqid(),
            'type' => 'pos',
            'is_active' => true,
        ]);
        $storeChannel->update(['user_id' => $user->id]);

        $fbaChannel = Channel::query()->create([
            'name' => 'Amazon FBA Test',
            'slug' => 'amazon-fba-'.uniqid(),
            'type' => 'amazon_fba',
            'is_active' => true,
        ]);
        $fbaChannel->update(['user_id' => $user->id]);

        $shopFloor = InventoryLocation::query()->create([
            'name' => 'المحل',
            'type' => 'physical',
            'channel_id' => $storeChannel->id,
            'is_active' => true,
        ]);
        $shopFloor->update(['user_id' => $user->id]);

        $fbaWarehouse = InventoryLocation::query()->create([
            'name' => 'FBA WH',
            'type' => 'amazon_fba',
            'channel_id' => $fbaChannel->id,
            'is_active' => true,
        ]);
        $fbaWarehouse->update(['user_id' => $user->id]);

        $master = MasterProduct::query()->create([
            'internal_name' => 'Removal FBA Deduction Product',
            'is_active' => true,
        ]);
        $master->update(['user_id' => $user->id]);

        $offer = InventoryOffer::query()->create([
            'master_product_id' => $master->id,
            'name' => 'Single',
            'type' => 'single',
        ]);
        $offer->update(['user_id' => $user->id]);

        $storeSku = Sku::query()->create([
            'offer_id' => $offer->id,
            'sku' => 'PHY-SHOP-'.uniqid(),
            'channel_id' => $storeChannel->id,
            'cost_price' => 0,
            'selling_price' => 0,
            'is_active' => true,
        ]);
        $storeSku->update(['user_id' => $user->id]);

        $fbaSku = Sku::query()->create([
            'offer_id' => $offer->id,
            'sku' => 'FBA-REM-'.uniqid(),
            'channel_id' => $fbaChannel->id,
            'cost_price' => 0,
            'selling_price' => 0,
            'is_active' => true,
        ]);
        $fbaSku->update(['user_id' => $user->id]);

        SkuInventory::query()->create([
            'sku_id' => $storeSku->id,
            'location_id' => $shopFloor->id,
            'quantity' => 2,
            'reserved' => 0,
            'user_id' => $user->id,
        ]);

        // FBA warehouse balance before the removal is confirmed received.
        SkuInventory::query()->create([
            'sku_id' => $fbaSku->id,
            'location_id' => $fbaWarehouse->id,
            'quantity' => 10,
            'reserved' => 0,
            'user_id' => $user->id,
        ]);

        $order = InventoryRemovalOrder::query()->create([
            'user_id' => $user->id,
            'source' => 'amazon',
            'removal_order_id' => 'RO-'.uniqid(),
            'order_status' => 'Completed',
        ]);

        $item = InventoryRemovalItem::query()->create([
            'user_id' => $user->id,
            'inventory_removal_order_id' => $order->id,
            'sku_code' => $fbaSku->sku,
            'disposition' => 'Sellable',
            'requested_quantity' => 3,
            'shipped_quantity' => 3,
            'receive_status' => 'pending',
            'received_quantity' => 0,
        ]);

        return compact('storeSku', 'fbaSku', 'shopFloor', 'fbaWarehouse', 'item');
    }

    it('POST removals receive credits the shop and debits the FBA balance by the same qty', function () {
        $user = User::factory()->create();
        $this->actingAs($user);

        $fixture = seedRemovalFbaDeductionFixture($user);

        $response = $this->postJson('/api/inventory/removals/items/'.$fixture['item']->id.'/receive');

        $response->assertOk()
            ->assertJsonPath('restocked_sku', $fixture['storeSku']->sku)
            ->assertJsonPath('listing_sku', $fixture['fbaSku']->sku)
            ->assertJsonPath('fba_balance_deducted', 3);

        $storeStock = SkuInventory::query()
            ->where('sku_id', $fixture['storeSku']->id)
            ->where('location_id', $fixture['shopFloor']->id)
            ->value('quantity');

        $fbaStock = SkuInventory::query()
            ->where('sku_id', $fixture['fbaSku']->id)
            ->where('location_id', $fixture['fbaWarehouse']->id)
            ->value('quantity');

        expect((int) $storeStock)->toBe(5)
            ->and((int) $fbaStock)->toBe(7);

        $fbaOut = InventoryTransaction::query()
            ->where('sku_id', $fixture['fbaSku']->id)
            ->where('location_id', $fixture['fbaWarehouse']->id)
            ->where('type', 'OUT')
            ->where('reference_type', 'Removal')
            ->where('reference_id', (string) $fixture['item']->id)
            ->first();

        expect($fbaOut)->not->toBeNull()
            ->and((int) $fbaOut->quantity)->toBe(3);
    });

    it('clamps the FBA deduction to available balance instead of going negative', function () {
        $user = User::factory()->create();
        $this->actingAs($user);

        $fixture = seedRemovalFbaDeductionFixture($user);

        // Simulate drift: FBA balance already lower than the quantity being received.
        SkuInventory::query()
            ->where('sku_id', $fixture['fbaSku']->id)
            ->where('location_id', $fixture['fbaWarehouse']->id)
            ->update(['quantity' => 1]);

        $response = $this->postJson('/api/inventory/removals/items/'.$fixture['item']->id.'/receive');

        $response->assertOk()->assertJsonPath('fba_balance_deducted', 1);

        $fbaStock = SkuInventory::query()
            ->where('sku_id', $fixture['fbaSku']->id)
            ->where('location_id', $fixture['fbaWarehouse']->id)
            ->value('quantity');

        expect((int) $fbaStock)->toBe(0);

        $storeStock = SkuInventory::query()
            ->where('sku_id', $fixture['storeSku']->id)
            ->where('location_id', $fixture['shopFloor']->id)
            ->value('quantity');

        // Shop restock still happens in full even though FBA balance couldn't fully cover it.
        expect((int) $storeStock)->toBe(5);
    });
});
