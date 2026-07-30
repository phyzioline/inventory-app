<?php

use App\Application\Support\TenantContext;
use App\Domain\Models\Wms\Channel;
use App\Domain\Models\Wms\InventoryLocation;
use App\Domain\Models\Wms\InventoryOffer;
use App\Domain\Models\Wms\MasterProduct;
use App\Domain\Models\Wms\Sku;
use App\Domain\Models\Wms\SkuInventory;
use App\Domain\Models\Wms\Supplier;
use App\Domain\Models\Wms\Customer;
use App\Models\User;

beforeEach(function () {
    TenantContext::flush();
    TenantContext::clearOverride();
});

/**
 * Functional domain smoke: happy-path HTTP checks for areas historically
 * uncovered by Pest (beyond marketplace/returns/settlements suites).
 */
it('lists warehouses and channels for authenticated owner', function () {
    $user = User::factory()->create();
    $this->actingAs($user);

    Channel::query()->create([
        'name' => 'Smoke Channel',
        'slug' => 'smoke-'.uniqid(),
        'type' => 'store',
        'is_active' => true,
        'user_id' => $user->id,
    ]);
    InventoryLocation::query()->create([
        'name' => 'Smoke WH',
        'type' => 'warehouse',
        'is_active' => true,
        'user_id' => $user->id,
    ]);

    $this->getJson('/api/inventory/channels')->assertOk();
    $this->getJson('/api/inventory/warehouses')->assertOk();
});

it('creates a cycle count session and lists it', function () {
    $user = User::factory()->create();
    $this->actingAs($user);

    $location = InventoryLocation::query()->create([
        'name' => 'Count WH',
        'type' => 'warehouse',
        'is_active' => true,
        'user_id' => $user->id,
    ]);
    $channel = Channel::query()->create([
        'name' => 'C',
        'slug' => 'c-'.uniqid(),
        'type' => 'store',
        'is_active' => true,
        'user_id' => $user->id,
    ]);
    $master = MasterProduct::query()->create([
        'internal_name' => 'Count Product',
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
        'sku' => 'COUNT-'.uniqid(),
        'channel_id' => $channel->id,
        'cost_price' => 10,
        'selling_price' => 20,
        'is_active' => true,
        'user_id' => $user->id,
    ]);
    SkuInventory::query()->create([
        'sku_id' => $sku->id,
        'location_id' => $location->id,
        'quantity' => 5,
        'reserved' => 0,
        'user_id' => $user->id,
    ]);

    $create = $this->postJson('/api/inventory/cycle-counts', [
        'location_id' => $location->id,
        'notes' => 'smoke',
    ]);
    $create->assertCreated()->assertJsonPath('success', true);

    $id = (int) $create->json('data.id');
    expect($id)->toBeGreaterThan(0);

    $this->postJson("/api/inventory/cycle-counts/{$id}/counts", [
        'lines' => [
            ['sku_id' => $sku->id, 'counted_qty' => 4],
        ],
    ])->assertOk();

    $this->getJson('/api/inventory/cycle-counts')
        ->assertOk()
        ->assertJsonPath('success', true);
});

it('lists suppliers and customers for tenant', function () {
    $user = User::factory()->create();
    $this->actingAs($user);

    Supplier::query()->create([
        'name' => 'Smoke Supplier',
        'balance' => 0,
        'is_active' => true,
        'user_id' => $user->id,
    ]);
    Customer::query()->create([
        'name' => 'Smoke Customer',
        'is_active' => true,
        'user_id' => $user->id,
    ]);

    $this->getJson('/api/inventory/suppliers')->assertOk();
    $this->getJson('/api/inventory/customers')->assertOk();
});

it('rejects invalid transfer payload with 422', function () {
    $user = User::factory()->create();
    $this->actingAs($user);

    $this->postJson('/api/inventory/transactions/transfer', [])
        ->assertStatus(422);
});
