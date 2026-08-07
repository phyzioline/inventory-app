<?php

use App\Application\Support\TenantContext;
use App\Domain\Models\Wms\Channel;
use App\Domain\Models\Wms\InventoryLocation;
use App\Domain\Models\Wms\InventoryOffer;
use App\Domain\Models\Wms\MasterProduct;
use App\Domain\Models\Wms\Sku;
use App\Domain\Models\Wms\SkuInventory;
use App\Models\User;
use Laravel\Sanctum\Sanctum;

beforeEach(function () {
    TenantContext::flush();
    TenantContext::clearOverride();
});

function makeDesktopSyncFixtures(User $user): array
{
    $master = MasterProduct::query()->create([
        'internal_name' => 'Desktop Sync Item',
        'is_active' => true,
        'user_id' => $user->id,
    ]);
    $channel = Channel::query()->create([
        'name' => 'Store',
        'slug' => 'ds-'.uniqid(),
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
        'sku' => 'DS-'.uniqid(),
        'channel_id' => $channel->id,
        'cost_price' => 10,
        'selling_price' => 20,
        'is_active' => true,
        'user_id' => $user->id,
    ]);
    $location = InventoryLocation::query()->create([
        'name' => 'WH',
        'type' => 'warehouse',
        'is_active' => true,
        'user_id' => $user->id,
    ]);
    $inventory = SkuInventory::query()->create([
        'sku_id' => $sku->id,
        'location_id' => $location->id,
        'quantity' => 5,
        'reserved' => 0,
        'user_id' => $user->id,
    ]);

    return compact('sku', 'location', 'inventory');
}

it('rejects desktop sync requests without a sanctum token', function () {
    $this->getJson('/api/v1/inventory/desktop/sync/bootstrap')->assertUnauthorized();
});

it('bootstrap returns the tenant catalog and current stock', function () {
    $user = User::factory()->create();
    Sanctum::actingAs($user);
    ['sku' => $sku, 'location' => $location] = makeDesktopSyncFixtures($user);

    $response = $this->getJson('/api/v1/inventory/desktop/sync/bootstrap')
        ->assertOk()
        ->assertJsonStructure(['cursor', 'skus', 'locations', 'stock']);

    $skuIds = collect($response->json('skus'))->pluck('id');
    $stockRows = collect($response->json('stock'));

    expect($skuIds)->toContain($sku->id);
    expect($stockRows->firstWhere('sku_id', $sku->id)['quantity'])->toEqual(5);
});

it('push applies a queued stock adjustment through the existing adjustment service', function () {
    $user = User::factory()->create();
    Sanctum::actingAs($user);
    ['sku' => $sku, 'location' => $location, 'inventory' => $inventory] = makeDesktopSyncFixtures($user);

    $clientOpId = (string) Illuminate\Support\Str::uuid();

    $this->postJson('/api/v1/inventory/desktop/sync/push', [
        'device_id' => 'test-device',
        'operations' => [[
            'client_op_id' => $clientOpId,
            'sku_id' => $sku->id,
            'location_id' => $location->id,
            'type' => 'DAMAGE',
            'quantity' => 2,
            'notes' => 'broke in transit',
        ]],
    ])
        ->assertOk()
        ->assertJsonPath('results.0.client_op_id', $clientOpId)
        ->assertJsonPath('results.0.status', 'applied');

    expect($inventory->fresh()->quantity)->toEqual(3);
});

it('push is idempotent when the same client_op_id is replayed', function () {
    $user = User::factory()->create();
    Sanctum::actingAs($user);
    ['sku' => $sku, 'location' => $location, 'inventory' => $inventory] = makeDesktopSyncFixtures($user);

    $clientOpId = (string) Illuminate\Support\Str::uuid();
    $payload = [
        'device_id' => 'test-device',
        'operations' => [[
            'client_op_id' => $clientOpId,
            'sku_id' => $sku->id,
            'location_id' => $location->id,
            'type' => 'DAMAGE',
            'quantity' => 2,
        ]],
    ];

    $this->postJson('/api/v1/inventory/desktop/sync/push', $payload)->assertOk();
    $this->postJson('/api/v1/inventory/desktop/sync/push', $payload)
        ->assertOk()
        ->assertJsonPath('results.0.status', 'applied');

    // Two pushes of the same client_op_id must only apply the stock change once.
    expect($inventory->fresh()->quantity)->toEqual(3);
});

it('push rejects an adjustment that would take stock negative and records it as failed', function () {
    $user = User::factory()->create();
    Sanctum::actingAs($user);
    ['sku' => $sku, 'location' => $location, 'inventory' => $inventory] = makeDesktopSyncFixtures($user);

    $clientOpId = (string) Illuminate\Support\Str::uuid();

    $this->postJson('/api/v1/inventory/desktop/sync/push', [
        'device_id' => 'test-device',
        'operations' => [[
            'client_op_id' => $clientOpId,
            'sku_id' => $sku->id,
            'location_id' => $location->id,
            'type' => 'DAMAGE',
            'quantity' => 999,
        ]],
    ])
        ->assertOk()
        ->assertJsonPath('results.0.status', 'failed');

    expect($inventory->fresh()->quantity)->toEqual(5);
});
