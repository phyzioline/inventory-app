<?php

use App\Application\Services\ProfitEngineService;
use App\Domain\Models\Wms\Channel;
use App\Domain\Models\Wms\InventoryOffer;
use App\Domain\Models\Wms\InventoryOrder;
use App\Domain\Models\Wms\InventoryOrderItem;
use App\Domain\Models\Wms\InventoryReturn;
use App\Domain\Models\Wms\MasterProduct;
use App\Domain\Models\Wms\Settlement;
use App\Domain\Models\Wms\SettlementItem;
use App\Domain\Models\Wms\Sku;
use App\Models\User;

/**
 * Amazon books an order's fees before it releases the sale amount. A fees-only settlement made
 * November's shipped orders count as negative revenue (~150k understated, 2026-11-23).
 * Owner rule: within 45 days such an order counts at list minus fees and is reported as awaiting
 * platform payment; older ones keep the settlement net and are reported as unpaid. Cancel /
 * refund lines or a live return mean the order did not sell, so the settlement net stands.
 */
function awaitingFixture(User $user): array
{
    $channel = Channel::query()->create(['name' => 'Amazon AW', 'slug' => 'amazon-aw-'.uniqid(), 'type' => 'marketplace', 'is_active' => true]);
    $channel->update(['user_id' => $user->id]);
    $master = MasterProduct::query()->create(['internal_name' => 'Band', 'is_active' => true, 'last_purchase_price' => 60]);
    $master->update(['user_id' => $user->id]);
    $offer = InventoryOffer::query()->create(['master_product_id' => $master->id, 'name' => 'Band', 'type' => 'single']);
    $offer->update(['user_id' => $user->id]);
    $sku = Sku::query()->create(['offer_id' => $offer->id, 'sku' => 'AW-'.uniqid(), 'channel_id' => $channel->id, 'cost_price' => 60, 'selling_price' => 200, 'is_active' => true]);
    $sku->update(['user_id' => $user->id]);
    $settlement = Settlement::query()->create([
        'channel_id' => $channel->id, 'report_id' => 'RPT-AW-'.uniqid(), 'start_date' => now()->subDays(90)->toDateString(),
        'end_date' => now()->toDateString(), 'total_amount' => 0, 'status' => 'reconciled', 'user_id' => $user->id,
    ]);

    return compact('channel', 'sku', 'settlement');
}

function awaitingOrder(User $user, array $fx, string $pid, string $orderDate, array $lines): InventoryOrder
{
    $order = InventoryOrder::query()->create([
        'channel_id' => $fx['channel']->id, 'platform_order_id' => $pid, 'status' => 'shipped',
        'order_date' => $orderDate, 'total_amount' => 200, 'user_id' => $user->id,
    ]);
    InventoryOrderItem::query()->create([
        'inventory_order_id' => $order->id, 'sku_id' => $fx['sku']->id, 'sku_code' => $fx['sku']->sku, 'product_name' => 'Band',
        'quantity' => 1, 'unit_price' => 200, 'total_price' => 200, 'user_id' => $user->id,
    ]);
    foreach ($lines as [$type, $desc, $amount]) {
        SettlementItem::query()->create([
            'settlement_id' => $fx['settlement']->id, 'platform_order_id' => $pid, 'inventory_order_id' => $order->id,
            'sku' => $fx['sku']->sku, 'transaction_type' => $type, 'transaction_status' => 'released', 'description' => $desc,
            'amount' => $amount, 'fee_amount' => 0, 'quantity' => 1, 'transaction_date' => $orderDate.' 12:00:00',
            'reconciliation_status' => 'matched',
        ]);
    }

    return $order;
}

function summaryFor(InventoryOrder $order): array
{
    $day = $order->order_date->toDateString();

    return app(ProfitEngineService::class)->getProfitSummary($day, $day);
}

it('prices a recent fees-only order at list minus fees and reports it as awaiting payment', function () {
    $user = User::factory()->create();
    $this->actingAs($user);
    $fx = awaitingFixture($user);
    $order = awaitingOrder($user, $fx, '171-AW-RECENT', now()->subDays(5)->toDateString(), [['AmazonFees', 'OtherTransaction: AmazonFees', -70]]);

    $s = summaryFor($order);

    expect($s['revenue'])->toBe(200.0)
        ->and($s['cogs'])->toBe(60.0)
        ->and($s['net_profit'])->toBe(70.0)          // 200 − 60 cost − 70 fee
        ->and($s['awaiting_platform_payment_orders'])->toBe(1)
        ->and($s['awaiting_platform_payment_revenue'])->toBe(200.0)
        ->and($s['unpaid_platform_orders'])->toBe(0);
});

it('keeps the settlement net of an old fees-only order and reports it as unpaid', function () {
    $user = User::factory()->create();
    $this->actingAs($user);
    $fx = awaitingFixture($user);
    $order = awaitingOrder($user, $fx, '171-AW-OLD', now()->subDays(60)->toDateString(), [['AmazonFees', 'OtherTransaction: AmazonFees', -70]]);

    $s = summaryFor($order);

    expect($s['revenue'])->toBe(-70.0)
        ->and($s['awaiting_platform_payment_orders'])->toBe(0)
        ->and($s['unpaid_platform_orders'])->toBe(1)
        ->and($s['unpaid_platform_order_value'])->toBe(200.0);
});

it('keeps the settlement net when the charges say the order was cancelled', function () {
    $user = User::factory()->create();
    $this->actingAs($user);
    $fx = awaitingFixture($user);
    $order = awaitingOrder($user, $fx, '171-AW-CANCEL', now()->subDays(5)->toDateString(), [
        ['OtherTransaction', 'OtherTransaction: Cancellation Charge', -40],
    ]);

    $s = summaryFor($order);

    expect($s['revenue'])->toBe(-40.0)
        ->and($s['awaiting_platform_payment_orders'])->toBe(0);
});

it('keeps the settlement net when a live return exists', function () {
    $user = User::factory()->create();
    $this->actingAs($user);
    $fx = awaitingFixture($user);
    $order = awaitingOrder($user, $fx, '171-AW-RETURN', now()->subDays(5)->toDateString(), [['AmazonFees', 'OtherTransaction: AmazonFees', -70]]);
    InventoryReturn::query()->create(InventoryReturn::mergeCreateDefaults([
        'inventory_order_id' => $order->id, 'platform_return_id' => 'RET-AW-'.uniqid(), 'sku_code' => $fx['sku']->sku,
        'return_quantity' => 1, 'return_date' => now()->toDateString(), 'status' => 'pending', 'user_id' => $user->id,
    ]));

    $s = summaryFor($order);

    expect($s['revenue'])->toBe(-70.0)
        ->and($s['awaiting_platform_payment_orders'])->toBe(0);
});

it('leaves an order with a released sale line on its settlement net', function () {
    $user = User::factory()->create();
    $this->actingAs($user);
    $fx = awaitingFixture($user);
    $order = awaitingOrder($user, $fx, '171-AW-PAID', now()->subDays(5)->toDateString(), [
        ['Order', 'ItemPrice: Principal', 200],
        ['Order', 'ItemFee: Commission', -30],
    ]);

    $s = summaryFor($order);

    expect($s['revenue'])->toBe(170.0)
        ->and($s['awaiting_platform_payment_orders'])->toBe(0)
        ->and($s['unpaid_platform_orders'])->toBe(0);
});
