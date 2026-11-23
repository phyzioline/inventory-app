<?php

use App\Domain\Models\Wms\Channel;
use App\Domain\Models\Wms\InventoryOrder;
use App\Domain\Models\Wms\InventoryOrderItem;
use App\Models\User;

/**
 * `GET /api/inventory/orders?view=summary` feeds whole-history screens
 * (Capital Management). It must return order headers + channel only:
 * loading line items and purchase costs for every order exhausted the
 * 512M PHP memory limit in production (2026-11-22, ~30k orders).
 */
function makeSummaryOrder(User $user, Channel $channel, array $attrs = []): InventoryOrder
{
    $order = InventoryOrder::query()->create(array_merge([
        'user_id' => $user->id,
        'channel_id' => $channel->id,
        'platform_order_id' => 'SUM-'.uniqid(),
        'order_date' => now(),
        'status' => 'completed',
        'financial_status' => 'pending',
        'settlement_status' => 'pending',
        'total_amount' => 150,
    ], $attrs));

    InventoryOrderItem::query()->create([
        'user_id' => $user->id,
        'inventory_order_id' => $order->id,
        'sku_code' => 'SUM-SKU',
        'product_name' => 'Summary Line',
        'quantity' => 1,
        'unit_price' => 150,
        'total_price' => 150,
    ]);

    return $order;
}

it('returns order headers with channel and no line items in summary view', function () {
    $user = User::factory()->create();
    $this->actingAs($user);

    $channel = Channel::query()->create([
        'name' => 'Noon',
        'slug' => 'noon-'.uniqid(),
        'type' => 'noon',
        'is_active' => true,
        'user_id' => $user->id,
    ]);
    $order = makeSummaryOrder($user, $channel);

    $rows = $this->getJson('/api/inventory/orders?view=summary')
        ->assertOk()
        ->json();

    expect($rows)->toHaveCount(1);
    $row = $rows[0];
    expect($row['id'])->toBe($order->id)
        ->and($row['status'])->toBe('completed')
        ->and($row['financial_status'])->toBe('pending')
        ->and($row['settlement_status'])->toBe('pending')
        ->and((float) $row['total_amount'])->toBe(150.0)
        ->and($row['channel']['name'])->toBe('Noon')
        ->and($row['channel']['slug'])->toBe($channel->slug)
        ->and($row)->not->toHaveKey('items')
        ->and($row)->not->toHaveKey('costs')
        ->and($row)->not->toHaveKey('customer_email');
});

it('keeps date and channel filters in summary view', function () {
    $user = User::factory()->create();
    $this->actingAs($user);

    $noon = Channel::query()->create([
        'name' => 'Noon', 'slug' => 'noon-'.uniqid(), 'type' => 'noon', 'is_active' => true, 'user_id' => $user->id,
    ]);
    $jumia = Channel::query()->create([
        'name' => 'Jumia', 'slug' => 'jumia-'.uniqid(), 'type' => 'jumia', 'is_active' => true, 'user_id' => $user->id,
    ]);
    $inRange = makeSummaryOrder($user, $noon, ['order_date' => now()->subDays(2)]);
    makeSummaryOrder($user, $noon, ['order_date' => now()->subDays(40)]);
    makeSummaryOrder($user, $jumia, ['order_date' => now()->subDays(2)]);

    $rows = $this->getJson('/api/inventory/orders?'.http_build_query([
        'view' => 'summary',
        'start_date' => now()->subDays(7)->toDateString(),
        'end_date' => now()->toDateString(),
        'channel' => $noon->slug,
    ]))->assertOk()->json();

    expect(collect($rows)->pluck('id')->all())->toBe([$inRange->id]);
});

it('still returns line items in the default list view', function () {
    $user = User::factory()->create();
    $this->actingAs($user);

    $channel = Channel::query()->create([
        'name' => 'Website', 'slug' => 'website-'.uniqid(), 'type' => 'website', 'is_active' => true, 'user_id' => $user->id,
    ]);
    makeSummaryOrder($user, $channel);

    $rows = $this->getJson('/api/inventory/orders')->assertOk()->json();

    expect($rows)->toHaveCount(1)
        ->and($rows[0]['items'])->toHaveCount(1);
});

it('requires authentication for the summary view', function () {
    $this->getJson('/api/inventory/orders?view=summary')->assertUnauthorized();
});

it('caps an undated detailed list to the default window and says so', function () {
    $user = User::factory()->create();
    $this->actingAs($user);

    $channel = Channel::query()->create([
        'name' => 'Noon', 'slug' => 'noon-'.uniqid(), 'type' => 'noon', 'is_active' => true, 'user_id' => $user->id,
    ]);
    $recent = makeSummaryOrder($user, $channel, ['order_date' => now()->subDays(5)]);
    $old = makeSummaryOrder($user, $channel, ['order_date' => now()->subDays(200)]);

    $response = $this->getJson('/api/inventory/orders')->assertOk()
        ->assertHeader('X-Orders-Window-Days', '90');
    expect(collect($response->json())->pluck('id')->all())->toBe([$recent->id]);

    // An explicit range or an order lookup reaches older orders.
    $ranged = $this->getJson('/api/inventory/orders?start_date='.now()->subDays(365)->toDateString())->assertOk();
    expect($ranged->headers->has('X-Orders-Window-Days'))->toBeFalse()
        ->and(collect($ranged->json())->pluck('id')->sort()->values()->all())->toBe(collect([$recent->id, $old->id])->sort()->values()->all());

    $lookup = $this->getJson('/api/inventory/orders?order_id='.$old->platform_order_id)->assertOk();
    expect(collect($lookup->json())->pluck('id')->all())->toBe([$old->id]);

    // Summary view stays whole-history.
    expect($this->getJson('/api/inventory/orders?view=summary')->json())->toHaveCount(2);
});
