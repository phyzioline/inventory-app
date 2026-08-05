<?php

use App\Models\User;
use App\Application\Services\ChannelStockResolver;
use App\Domain\Models\Wms\Channel;
use App\Domain\Models\Wms\InventoryLocation;
use App\Domain\Models\Wms\InventoryOffer;
use App\Domain\Models\Wms\InventoryRemovalItem;
use App\Domain\Models\Wms\InventoryRemovalOrder;
use App\Domain\Models\Wms\MasterProduct;
use App\Domain\Models\Wms\Sku;
use App\Domain\Models\Wms\SkuInventory;

describe('Amazon removal receive restocks shop SKU', function () {
    function seedRemovalRestockFixture(User $user): array
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

        // Empty legacy physical location (must NOT win over the real shop floor).
        $emptyShop = InventoryLocation::query()->create([
            'name' => 'المحل',
            'type' => 'physical',
            'is_active' => true,
        ]);
        $emptyShop->update(['user_id' => $user->id]);

        $shopFloor = InventoryLocation::query()->create([
            'name' => 'المحل',
            'type' => 'physical',
            'is_active' => true,
        ]);
        $shopFloor->update(['user_id' => $user->id]);

        $master = MasterProduct::query()->create([
            'internal_name' => 'Removal Restock Product',
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

        // Seed bulk stock on shop floor so location resolver prefers it over empty #1-style shop.
        SkuInventory::query()->create([
            'sku_id' => $fbaSku->id,
            'location_id' => $shopFloor->id,
            'quantity' => 50,
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

        return compact('storeSku', 'fbaSku', 'shopFloor', 'emptyShop', 'item');
    }

    it('POST removals receive increments linked shop SKU at shop location', function () {
        $user = User::factory()->create();
        $this->actingAs($user);

        $fixture = seedRemovalRestockFixture($user);

        $response = $this->postJson('/api/inventory/removals/items/'.$fixture['item']->id.'/receive');

        $response->assertOk()
            ->assertJsonPath('restocked_sku', $fixture['storeSku']->sku)
            ->assertJsonPath('listing_sku', $fixture['fbaSku']->sku);

        $storeStock = SkuInventory::query()
            ->where('sku_id', $fixture['storeSku']->id)
            ->where('location_id', $fixture['shopFloor']->id)
            ->value('quantity');

        $fbaAtShop = SkuInventory::query()
            ->where('sku_id', $fixture['fbaSku']->id)
            ->where('location_id', $fixture['shopFloor']->id)
            ->value('quantity');

        $emptyShopStock = SkuInventory::query()
            ->where('sku_id', $fixture['storeSku']->id)
            ->where('location_id', $fixture['emptyShop']->id)
            ->sum('quantity');

        expect((int) $storeStock)->toBe(5)
            ->and((int) $fbaAtShop)->toBe(50)
            ->and((int) $emptyShopStock)->toBe(0);

        $fixture['item']->refresh();
        expect($fixture['item']->receive_status)->toBe('received')
            ->and((int) $fixture['item']->received_location_id)->toBe((int) $fixture['shopFloor']->id)
            ->and((int) $fixture['item']->received_quantity)->toBe(3);
    });
});
