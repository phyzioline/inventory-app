<?php

use App\Application\Support\TenantContext;
use App\Domain\Models\Wms\Channel;
use App\Domain\Models\Wms\InventoryOffer;
use App\Domain\Models\Wms\InventoryLocation;
use App\Domain\Models\Wms\MasterProduct;
use App\Domain\Models\Wms\Sku;
use App\Domain\Models\Wms\SkuInventory;
use App\Models\User;

beforeEach(function () {
    TenantContext::flush();
    TenantContext::clearOverride();
});

it('lists low-stock alerts when qty is below min_stock', function () {
    $user = User::factory()->create();
    $this->actingAs($user);

    $master = MasterProduct::query()->create([
        'internal_name' => 'Low Stock Item',
        'is_active' => true,
        'min_stock' => 10,
        'user_id' => $user->id,
    ]);
    $channel = Channel::query()->create([
        'name' => 'Store',
        'slug' => 'ls-'.uniqid(),
        'type' => 'store',
        'is_active' => true,
        'user_id' => $user->id,
    ]);
    $offer = InventoryOffer::query()->create([
        'master_product_id' => $master->id,
        'name' => 'O',
        'type' => 'single',
        'user_id' => $user->id,
    ]);
    $sku = Sku::query()->create([
        'offer_id' => $offer->id,
        'sku' => 'LS-'.uniqid(),
        'channel_id' => $channel->id,
        'cost_price' => 1,
        'selling_price' => 2,
        'is_active' => true,
        'user_id' => $user->id,
    ]);
    $location = InventoryLocation::query()->create([
        'name' => 'WH',
        'type' => 'warehouse',
        'is_active' => true,
        'user_id' => $user->id,
    ]);
    SkuInventory::query()->create([
        'sku_id' => $sku->id,
        'location_id' => $location->id,
        'quantity' => 3,
        'reserved' => 0,
        'user_id' => $user->id,
    ]);

    $this->getJson('/api/inventory/alerts/low-stock')
        ->assertOk()
        ->assertJsonPath('success', true)
        ->assertJsonPath('count', 1)
        ->assertJsonPath('data.0.suggested_reorder_qty', 7);
});
