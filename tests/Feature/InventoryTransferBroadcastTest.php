<?php

use Illuminate\Support\Facades\Event;
use App\Models\User;
use App\Domain\Events\StockUpdated;
use App\Domain\Models\Wms\Channel;
use App\Domain\Models\Wms\InventoryLocation;
use App\Domain\Models\Wms\InventoryOffer;
use App\Domain\Models\Wms\MasterProduct;
use App\Domain\Models\Wms\Sku;
use App\Domain\Models\Wms\SkuInventory;

describe('Inventory transfer stock broadcasts', function () {
    it('dispatches StockUpdated events after a successful batch transfer', function () {
        config(['broadcasting.default' => 'reverb']);
        Event::fake([StockUpdated::class]);

        $user = User::factory()->create();
        $this->actingAs($user);

        $channel = Channel::query()->create([
            'name' => 'Main Store',
            'slug' => 'main-store-'.uniqid(),
            'type' => 'store',
            'is_active' => true,
        ]);
        $channel->update(['user_id' => $user->id]);

        $fromLocation = InventoryLocation::query()->create([
            'name' => 'Shop',
            'type' => 'store',
            'channel_id' => $channel->id,
            'is_active' => true,
        ]);
        $fromLocation->update(['user_id' => $user->id]);

        $toLocation = InventoryLocation::query()->create([
            'name' => 'FBA',
            'type' => 'fba',
            'channel_id' => $channel->id,
            'is_active' => true,
        ]);
        $toLocation->update(['user_id' => $user->id]);

        $master = MasterProduct::query()->create([
            'internal_name' => 'Transfer Product',
            'is_active' => true,
        ]);
        $master->update(['user_id' => $user->id]);

        $offer = InventoryOffer::query()->create([
            'master_product_id' => $master->id,
            'name' => 'Single',
            'type' => 'single',
        ]);
        $offer->update(['user_id' => $user->id]);

        $sku = Sku::query()->create([
            'offer_id' => $offer->id,
            'sku' => 'XFER-BROADCAST-001',
            'channel_id' => $channel->id,
            'cost_price' => 0,
            'selling_price' => 0,
            'is_active' => true,
        ]);
        $sku->update(['user_id' => $user->id]);

        SkuInventory::query()->create([
            'sku_id' => $sku->id,
            'location_id' => $fromLocation->id,
            'quantity' => 20,
            'reserved' => 0,
            'user_id' => $user->id,
        ]);

        $response = $this->postJson('/api/inventory/transactions/transfer-batch', [
            'from_location_id' => $fromLocation->id,
            'to_location_id' => $toLocation->id,
            'items' => [
                ['sku_id' => $sku->id, 'quantity' => 5],
            ],
        ]);

        $response->assertCreated();
        Event::assertDispatched(StockUpdated::class, 2);
    });
});
