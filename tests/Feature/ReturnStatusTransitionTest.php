<?php

uses(Tests\TestCase::class, Illuminate\Foundation\Testing\RefreshDatabase::class);

use App\Models\User;
use App\Application\Services\InventoryReturnMutationService;
use App\Domain\Models\Wms\Channel;
use App\Domain\Models\Wms\InventoryOrder;
use App\Domain\Models\Wms\InventoryReturn;

it('allows metadata sync when UI requests an earlier lifecycle status on an advanced return', function () {
    $user = User::factory()->create();

    $channel = Channel::query()->create([
        'name' => 'Amazon',
        'slug' => 'amazon-'.uniqid(),
        'type' => 'merchant',
        'is_active' => true,
        'user_id' => $user->id,
    ]);

    $order = InventoryOrder::query()->create([
        'platform_order_id' => 'ORD-'.uniqid(),
        'channel_id' => $channel->id,
        'status' => 'shipped',
        'order_date' => now(),
        'total_amount' => 50,
        'shipping_amount' => 0,
        'user_id' => $user->id,
    ]);

    $return = InventoryReturn::query()->create([
        'inventory_order_id' => $order->id,
        'status' => 'approved',
        'return_status' => 'arrived_to_warehouse',
        'inventory_status' => 'pending_confirmation',
        'reason' => 'Customer return',
        'disposition' => 'sellable',
        'return_quantity' => 1,
        'last_update_date' => now()->subDay(),
        'user_id' => $user->id,
    ]);

    $service = app(InventoryReturnMutationService::class);
    $result = $service->updateFromValidated($return->id, [
        'status' => 'in_transit',
        'return_status' => 'in_transit',
        'inventory_status' => 'on_hold',
        'last_update_date' => now()->toIso8601String(),
    ]);

    expect($result['invalid_transition'])->toBeFalse()
        ->and($result['return']->status)->toBe('approved')
        ->and($result['return']->return_status)->toBe('in_transit')
        ->and($result['return']->inventory_status)->toBe('on_hold');
});

it('rejects true lifecycle downgrades such as completed to pending', function () {
    $user = User::factory()->create();

    $channel = Channel::query()->create([
        'name' => 'Store',
        'slug' => 'store-'.uniqid(),
        'type' => 'store',
        'is_active' => true,
        'user_id' => $user->id,
    ]);

    $order = InventoryOrder::query()->create([
        'platform_order_id' => 'ORD-'.uniqid(),
        'channel_id' => $channel->id,
        'status' => 'shipped',
        'order_date' => now(),
        'total_amount' => 50,
        'shipping_amount' => 0,
        'user_id' => $user->id,
    ]);

    $return = InventoryReturn::query()->create([
        'inventory_order_id' => $order->id,
        'status' => 'completed',
        'return_status' => 'restocked',
        'inventory_status' => 'restocked',
        'reason' => 'Done',
        'disposition' => 'sellable',
        'return_quantity' => 1,
        'user_id' => $user->id,
    ]);

    $service = app(InventoryReturnMutationService::class);
    $result = $service->updateFromValidated($return->id, [
        'status' => 'pending',
        'last_update_date' => now()->toIso8601String(),
    ]);

    expect($result['invalid_transition'])->toBeTrue()
        ->and($result['from'])->toBe('completed')
        ->and($result['to'])->toBe('pending');
});
