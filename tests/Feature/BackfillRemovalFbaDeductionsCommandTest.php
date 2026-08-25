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

describe('Backfill historical removal FBA deductions', function () {
    function seedHistoricalRemovalWithoutFbaOut(User $user, int $fbaQty = 10, int $receivedQty = 3, bool $restockOnListingSku = false): array
    {
        ChannelStockResolver::clearCache();

        $storeChannel = Channel::query()->create([
            'name' => 'المحل',
            'slug' => 'store-bf-'.uniqid(),
            'type' => 'pos',
            'is_active' => true,
        ]);
        $storeChannel->update(['user_id' => $user->id]);

        $fbaChannel = Channel::query()->create([
            'name' => 'Amazon FBA Backfill',
            'slug' => 'amazon-fba-bf-'.uniqid(),
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
            'internal_name' => 'Removal FBA Backfill Product',
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
            'sku' => 'PHY-SHOP-BF-'.uniqid(),
            'channel_id' => $storeChannel->id,
            'cost_price' => 0,
            'selling_price' => 0,
            'is_active' => true,
        ]);
        $storeSku->update(['user_id' => $user->id]);

        $fbaSku = Sku::query()->create([
            'offer_id' => $offer->id,
            'sku' => 'FBA-BF-'.uniqid(),
            'channel_id' => $fbaChannel->id,
            'cost_price' => 0,
            'selling_price' => 0,
            'is_active' => true,
        ]);
        $fbaSku->update(['user_id' => $user->id]);

        SkuInventory::query()->create([
            'sku_id' => $storeSku->id,
            'location_id' => $shopFloor->id,
            'quantity' => 2 + ($restockOnListingSku ? 0 : $receivedQty),
            'reserved' => 0,
            'user_id' => $user->id,
        ]);

        SkuInventory::query()->create([
            'sku_id' => $fbaSku->id,
            'location_id' => $fbaWarehouse->id,
            'quantity' => $fbaQty,
            'reserved' => 0,
            'user_id' => $user->id,
        ]);

        if ($restockOnListingSku) {
            SkuInventory::query()->create([
                'sku_id' => $fbaSku->id,
                'location_id' => $shopFloor->id,
                'quantity' => $receivedQty,
                'reserved' => 0,
                'user_id' => $user->id,
            ]);
        }

        $order = InventoryRemovalOrder::query()->create([
            'user_id' => $user->id,
            'source' => 'amazon',
            'removal_order_id' => 'RO-BF-'.uniqid(),
            'order_status' => 'Completed',
        ]);

        $item = InventoryRemovalItem::query()->create([
            'user_id' => $user->id,
            'inventory_removal_order_id' => $order->id,
            'sku_code' => $fbaSku->sku,
            'disposition' => 'Sellable',
            'requested_quantity' => $receivedQty,
            'shipped_quantity' => $receivedQty,
            'receive_status' => 'received',
            'received_quantity' => $receivedQty,
            'received_at' => now()->subDays(10),
            'received_location_id' => $shopFloor->id,
        ]);

        $restockSkuId = $restockOnListingSku ? $fbaSku->id : $storeSku->id;
        InventoryTransaction::query()->create([
            'user_id' => $user->id,
            'sku_id' => $restockSkuId,
            'location_id' => $shopFloor->id,
            'type' => 'IN',
            'quantity' => $receivedQty,
            'reference_type' => 'Removal',
            'reference_id' => (string) $item->id,
            'notes' => 'Amazon removal received: '.$order->removal_order_id,
        ]);

        return compact('storeSku', 'fbaSku', 'shopFloor', 'fbaWarehouse', 'item');
    }

    it('dry-run does not change FBA quantity', function () {
        $user = User::factory()->create();
        $this->actingAs($user);
        $fixture = seedHistoricalRemovalWithoutFbaOut($user);

        $this->artisan('inventory:backfill-removal-fba-deductions --dry-run')
            ->assertSuccessful();

        $fbaStock = SkuInventory::query()
            ->where('sku_id', $fixture['fbaSku']->id)
            ->where('location_id', $fixture['fbaWarehouse']->id)
            ->value('quantity');

        expect((int) $fbaStock)->toBe(10)
            ->and(InventoryTransaction::query()->where('type', 'OUT')->where('reference_type', 'Removal')->count())->toBe(0);
    });

    it('deducts FBA for a received item restocked onto the shop SKU', function () {
        $user = User::factory()->create();
        $this->actingAs($user);
        $fixture = seedHistoricalRemovalWithoutFbaOut($user);

        $this->artisan('inventory:backfill-removal-fba-deductions')
            ->assertSuccessful();

        $fbaStock = SkuInventory::query()
            ->where('sku_id', $fixture['fbaSku']->id)
            ->where('location_id', $fixture['fbaWarehouse']->id)
            ->value('quantity');

        $shopStock = SkuInventory::query()
            ->where('sku_id', $fixture['storeSku']->id)
            ->where('location_id', $fixture['shopFloor']->id)
            ->value('quantity');

        $out = InventoryTransaction::query()
            ->where('sku_id', $fixture['fbaSku']->id)
            ->where('type', 'OUT')
            ->where('reference_type', 'Removal')
            ->where('reference_id', (string) $fixture['item']->id)
            ->first();

        expect((int) $fbaStock)->toBe(7)
            ->and((int) $shopStock)->toBe(5)
            ->and($out)->not->toBeNull()
            ->and((int) $out->quantity)->toBe(3);
    });

    it('deducts FBA even when the historical IN landed on the listing SKU at the shop', function () {
        $user = User::factory()->create();
        $this->actingAs($user);
        $fixture = seedHistoricalRemovalWithoutFbaOut($user, fbaQty: 12, receivedQty: 1, restockOnListingSku: true);

        $this->artisan('inventory:backfill-removal-fba-deductions')
            ->assertSuccessful();

        $fbaStock = (int) SkuInventory::query()
            ->where('sku_id', $fixture['fbaSku']->id)
            ->where('location_id', $fixture['fbaWarehouse']->id)
            ->value('quantity');

        $shopOnListing = (int) SkuInventory::query()
            ->where('sku_id', $fixture['fbaSku']->id)
            ->where('location_id', $fixture['shopFloor']->id)
            ->value('quantity');

        expect($fbaStock)->toBe(11)
            ->and($shopOnListing)->toBe(1);
    });

    it('is idempotent and clamps to available FBA quantity', function () {
        $user = User::factory()->create();
        $this->actingAs($user);
        $fixture = seedHistoricalRemovalWithoutFbaOut($user, fbaQty: 1, receivedQty: 5);

        $this->artisan('inventory:backfill-removal-fba-deductions')->assertSuccessful();
        $this->artisan('inventory:backfill-removal-fba-deductions')->assertSuccessful();

        $fbaStock = (int) SkuInventory::query()
            ->where('sku_id', $fixture['fbaSku']->id)
            ->where('location_id', $fixture['fbaWarehouse']->id)
            ->value('quantity');

        $outCount = InventoryTransaction::query()
            ->where('reference_type', 'Removal')
            ->where('reference_id', (string) $fixture['item']->id)
            ->where('type', 'OUT')
            ->count();

        expect($fbaStock)->toBe(0)
            ->and($outCount)->toBe(1);
    });
});
