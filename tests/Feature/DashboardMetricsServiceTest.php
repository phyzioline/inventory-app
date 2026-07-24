<?php

uses(Tests\TestCase::class, Illuminate\Foundation\Testing\RefreshDatabase::class);

use Carbon\Carbon;
use Illuminate\Support\Facades\Auth;
use App\Models\User;
use App\Application\Services\DashboardMetricsService;
use App\Domain\Models\Wms\Channel;
use App\Domain\Models\Wms\InventoryOrder;
use App\Domain\Models\Wms\InventoryReturn;

it('aggregates returns by channel without ambiguous column errors on joined tables', function () {
    $user = User::factory()->create();
    Auth::login($user);

    $channel = Channel::query()->create([
        'name' => 'Amazon Test',
        'slug' => 'amazon-test-'.uniqid(),
        'type' => 'merchant',
        'is_active' => true,
        'user_id' => $user->id,
    ]);

    $order = InventoryOrder::query()->create([
        'platform_order_id' => 'ORD-'.uniqid(),
        'channel_id' => $channel->id,
        'status' => 'shipped',
        'order_date' => now(),
        'total_amount' => 120,
        'shipping_amount' => 0,
        'user_id' => $user->id,
    ]);

    InventoryReturn::query()->create([
        'inventory_order_id' => $order->id,
        'status' => 'pending',
        'return_status' => 'return_requested',
        'inventory_status' => 'on_hold',
        'reason' => 'Customer return',
        'disposition' => 'sellable',
        'return_quantity' => 1,
        'last_update_date' => now(),
        'user_id' => $user->id,
    ]);

    $service = app(DashboardMetricsService::class);
    $method = new ReflectionMethod($service, 'returnsCountByChannel');
    $method->setAccessible(true);

    $returnsByChannel = $method->invoke(
        $service,
        Carbon::now()->subDays(7)->startOfDay(),
        Carbon::now()->endOfDay(),
    );

    expect($returnsByChannel)->toHaveKey('Amazon Test')
        ->and($returnsByChannel['Amazon Test'])->toBe(1);
});
