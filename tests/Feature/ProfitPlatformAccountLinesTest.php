<?php

use App\Application\Services\ProfitEngineService;
use App\Domain\Models\Wms\Channel;
use App\Domain\Models\Wms\InventoryOffer;
use App\Domain\Models\Wms\InventoryOrder;
use App\Domain\Models\Wms\InventoryOrderItem;
use App\Domain\Models\Wms\MasterProduct;
use App\Domain\Models\Wms\Settlement;
use App\Domain\Models\Wms\SettlementItem;
use App\Domain\Models\Wms\Sku;
use App\Models\User;

/**
 * Seller rewards, ads and reimbursements that no order carries sat in the treasury (part of the
 * transfer) but never in P&L: +205k rewards / −170k ads for 2026 (audit 2026-11-24). Sales of orders
 * never imported are reported, not added to profit — they have no cost on file.
 */
function platformLinesFixture(User $user): array
{
    $channel = Channel::query()->create(['name' => 'Amazon PL', 'slug' => 'amazon-pl-'.uniqid(), 'type' => 'marketplace', 'is_active' => true]);
    $channel->update(['user_id' => $user->id]);
    $master = MasterProduct::query()->create(['internal_name' => 'Roller', 'is_active' => true, 'last_purchase_price' => 60]);
    $master->update(['user_id' => $user->id]);
    $offer = InventoryOffer::query()->create(['master_product_id' => $master->id, 'name' => 'Roller', 'type' => 'single']);
    $offer->update(['user_id' => $user->id]);
    $sku = Sku::query()->create(['offer_id' => $offer->id, 'sku' => 'PL-'.uniqid(), 'channel_id' => $channel->id, 'cost_price' => 60, 'selling_price' => 200, 'is_active' => true]);
    $sku->update(['user_id' => $user->id]);
    $settlement = Settlement::query()->create([
        'channel_id' => $channel->id, 'report_id' => 'RPT-PL-'.uniqid(), 'start_date' => '2026-10-01',
        'end_date' => '2026-10-14', 'total_amount' => 0, 'status' => 'reconciled', 'user_id' => $user->id,
    ]);

    $order = InventoryOrder::query()->create([
        'channel_id' => $channel->id, 'platform_order_id' => '171-1111111-1111111', 'status' => 'shipped',
        'order_date' => '2026-10-05', 'total_amount' => 200, 'user_id' => $user->id,
    ]);
    InventoryOrderItem::query()->create([
        'inventory_order_id' => $order->id, 'sku_id' => $sku->id, 'sku_code' => $sku->sku, 'product_name' => 'Roller',
        'quantity' => 1, 'unit_price' => 200, 'total_price' => 200, 'user_id' => $user->id,
    ]);

    return compact('settlement', 'order', 'sku');
}

function platformLine(Settlement $s, array $attrs): void
{
    SettlementItem::query()->create(array_merge([
        'settlement_id' => $s->id, 'transaction_status' => 'released', 'fee_amount' => 0, 'quantity' => 1,
        'transaction_date' => '2026-10-06 10:00:00', 'reconciliation_status' => 'account_level',
    ], $attrs));
}

it('books account lines in net profit, reports orders missing from the system, and skips cash transfers', function () {
    $user = User::factory()->create();
    $this->actingAs($user);
    $fx = platformLinesFixture($user);
    $s = $fx['settlement'];

    // The imported order's own lines (already in order profit — must not be counted again).
    platformLine($s, ['platform_order_id' => '171-1111111-1111111', 'inventory_order_id' => $fx['order']->id, 'sku' => $fx['sku']->sku,
        'transaction_type' => 'Order', 'description' => 'ItemPrice: Principal', 'amount' => 200, 'reconciliation_status' => 'matched']);
    platformLine($s, ['platform_order_id' => '171-1111111-1111111', 'transaction_type' => 'Order', 'description' => 'ItemFee: Commission', 'amount' => -20, 'reconciliation_status' => 'matched']);

    // Account lines.
    platformLine($s, ['transaction_type' => 'Seller Rewards', 'description' => 'OtherTransaction: Seller Rewards', 'amount' => 500]);
    platformLine($s, ['transaction_type' => 'Advertising', 'description' => 'Advertising: Cost of Advertising', 'amount' => -300]);
    platformLine($s, ['transaction_type' => 'OtherTransaction', 'description' => 'OtherTransaction: REVERSAL_REIMBURSEMENT', 'amount' => 40]);
    platformLine($s, ['transaction_type' => 'OtherTransaction', 'description' => 'OtherTransaction: Subscription Fee', 'amount' => -10]);
    // Cash movement, not P&L.
    platformLine($s, ['transaction_type' => 'Transfer of funds unsuccessful', 'description' => 'Transfer of funds unsuccessful: Amazon has cancelled your transfer', 'amount' => 999]);
    // Amazon holding part of the payout.
    platformLine($s, ['transaction_type' => 'Current Reserve Amount', 'description' => 'Current Reserve Amount', 'amount' => -1]);
    // A sale of an order that was never imported.
    platformLine($s, ['platform_order_id' => '402-9999999-9999999', 'transaction_type' => 'Order', 'description' => 'ItemPrice: Principal', 'amount' => 150, 'reconciliation_status' => 'unreconciled']);
    platformLine($s, ['platform_order_id' => '402-9999999-9999999', 'transaction_type' => 'Order', 'description' => 'ItemFee: Commission', 'amount' => -15, 'reconciliation_status' => 'unreconciled']);
    // Outside the period.
    platformLine($s, ['transaction_type' => 'Seller Rewards', 'description' => 'OtherTransaction: Seller Rewards', 'amount' => 7000, 'transaction_date' => '2026-11-20 10:00:00']);

    $sum = app(ProfitEngineService::class)->getProfitSummary('2026-10-01', '2026-10-31');

    expect($sum['platform_account']['seller_rewards']['amount'])->toBe(500.0)
        ->and($sum['platform_account']['advertising']['amount'])->toBe(-300.0)
        ->and($sum['platform_account']['reimbursements']['amount'])->toBe(40.0)
        ->and($sum['platform_account']['platform_fees']['amount'])->toBe(-10.0)
        ->and($sum['platform_account_net'])->toBe(230.0)
        ->and($sum['cash_transfers_excluded'])->toBe(998.0)
        ->and($sum['orders_missing_from_system'])->toBe(['orders' => 1, 'lines' => 2, 'net' => 135.0, 'sales' => 150.0])
        // 200 − 20 fee − 60 cost = 120 order profit; + 230 platform account; missing order and transfer stay out.
        ->and($sum['orders_profit'])->toBe(120.0)
        ->and($sum['net_profit'])->toBe(350.0);
});

it('keeps account lines in a period with no orders, and leaves them out of an account-filtered view', function () {
    $user = User::factory()->create();
    $this->actingAs($user);
    $fx = platformLinesFixture($user);
    platformLine($fx['settlement'], ['transaction_type' => 'Seller Rewards', 'description' => 'OtherTransaction: Seller Rewards', 'amount' => 800, 'transaction_date' => '2026-09-10 10:00:00']);

    $engine = app(ProfitEngineService::class);
    $sept = $engine->getProfitSummary('2026-09-01', '2026-09-30');
    expect($sept['net_profit'])->toBe(800.0)->and($sept['platform_account_net'])->toBe(800.0);

    $filtered = $engine->getProfitSummary('2026-09-01', '2026-09-30', ['account_email' => 'someone@example.com']);
    expect($filtered['platform_account_net'])->toBe(0.0)
        ->and($filtered['platform_account_scope'])->toBe('excluded_by_account_filter');
});
