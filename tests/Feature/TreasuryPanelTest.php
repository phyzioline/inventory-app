<?php

uses(Tests\TestCase::class, Illuminate\Foundation\Testing\RefreshDatabase::class);

use App\Models\User;
use App\Domain\Models\Wms\Channel;
use App\Domain\Models\Wms\InventoryOrder;
use App\Domain\Models\Wms\Receipt;

it('returns treasury panels without ambiguous user_id sql errors', function () {
    $user = User::factory()->create();
    $this->actingAs($user);

    $channel = Channel::create([
        'name' => 'Test Channel',
        'slug' => 'test-channel',
        'type' => 'store',
        'is_active' => true,
    ]);

    $order = InventoryOrder::create([
        'channel_id' => $channel->id,
        'platform_order_id' => 'ORD-TEST-1',
        'status' => 'completed',
        'order_date' => now(),
        'total_amount' => 100,
    ]);

    Receipt::create([
        'receipt_number' => 'RCPT-TEST-1',
        'type' => 'collection',
        'amount' => 50,
        'receipt_date' => now()->toDateString(),
        'reference_type' => InventoryOrder::class,
        'reference_id' => $order->id,
    ]);

    $this->getJson('/api/inventory/finance/treasury-panels')
        ->assertOk()
        ->assertJsonStructure(['operational_net', 'inbound_items']);
});

it('eager loads receipts with legacy inventory order morph type', function () {
    $user = User::factory()->create();
    $this->actingAs($user);

    $channel = Channel::create([
        'name' => 'Legacy Channel',
        'slug' => 'legacy-channel',
        'type' => 'store',
        'is_active' => true,
    ]);

    $order = InventoryOrder::create([
        'channel_id' => $channel->id,
        'platform_order_id' => 'ORD-LEGACY-1',
        'status' => 'completed',
        'order_date' => now(),
        'total_amount' => 75,
    ]);

    $receipt = Receipt::create([
        'receipt_number' => 'RCPT-LEGACY-1',
        'type' => 'collection',
        'amount' => 25,
        'receipt_date' => now()->toDateString(),
        'reference_type' => 'App\Models\Inventory\InventoryOrder',
        'reference_id' => $order->id,
    ]);

    $loaded = Receipt::with('reference')->findOrFail($receipt->id);

    expect($loaded->reference)->toBeInstanceOf(InventoryOrder::class)
        ->and($loaded->reference->id)->toBe($order->id);
});
