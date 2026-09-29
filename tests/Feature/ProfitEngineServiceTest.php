<?php

use App\Models\User;
use App\Application\Services\ProfitEngineService;
use App\Domain\Models\Wms\CapitalSource;
use App\Domain\Models\Wms\Channel;
use App\Domain\Models\Wms\Expense;
use App\Domain\Models\Wms\InventoryOffer;
use App\Domain\Models\Wms\InventoryOrder;
use App\Domain\Models\Wms\InventoryOrderItem;
use App\Domain\Models\Wms\MasterProduct;
use App\Domain\Models\Wms\PurchaseBatch;
use App\Domain\Models\Wms\Receipt;
use App\Domain\Models\Wms\Settlement;
use App\Domain\Models\Wms\Sku;

it('counts COGS for settlement receipts stored with the legacy monolith reference_type', function () {
    $user = User::factory()->create();
    $this->actingAs($user);

    $channel = Channel::create([
        'name' => 'Legacy Settlement Channel',
        'slug' => 'legacy-settlement-channel',
        'type' => 'marketplace',
        'is_active' => true,
    ]);

    $settlement = Settlement::create([
        'channel_id' => $channel->id,
        'report_id' => 'RPT-LEGACY-1',
        'start_date' => '2026-06-01',
        'end_date' => '2026-06-30',
        'total_amount' => 1000,
        'status' => 'processed',
    ]);

    // Receipts migrated from the phyzioline monolith kept the old `Modules\Inventory\...`
    // reference_type string instead of the app's current `App\Domain\Models\Wms\Settlement`.
    Receipt::create([
        'receipt_number' => 'RCPT-LEGACY-SETTLEMENT-1',
        'type' => 'channel_collection',
        'category' => 'channel_collection',
        'amount' => 1000,
        'receipt_date' => '2026-06-15',
        'reference_type' => 'Modules\Inventory\app\Domain\Models\Wms\Settlement',
        'reference_id' => $settlement->id,
    ]);

    $response = $this->getJson('/api/inventory/reports/cash-profit-snapshot?start_date=2026-06-01&end_date=2026-06-30')
        ->assertOk();

    // Before the fix, this receipt was treated as "unlinked" (no reference_type match), so it
    // never reached the settlement-COGS branch and unlinked_receipt_count included it.
    $response->assertJsonPath('total_receipts', 1000)
        ->assertJsonPath('unlinked_receipt_count', 0);
});

it('still resolves receipts stored with the current reference_type as before', function () {
    $user = User::factory()->create();
    $this->actingAs($user);

    $channel = Channel::create([
        'name' => 'Current Order Channel',
        'slug' => 'current-order-channel',
        'type' => 'store',
        'is_active' => true,
    ]);

    $order = InventoryOrder::create([
        'channel_id' => $channel->id,
        'platform_order_id' => 'ORD-CURRENT-1',
        'status' => 'completed',
        'order_date' => '2026-06-10',
        'total_amount' => 200,
    ]);

    Receipt::create([
        'receipt_number' => 'RCPT-CURRENT-1',
        'type' => 'customer_collection',
        'category' => 'customer_collection',
        'amount' => 200,
        'receipt_date' => '2026-06-10',
        'reference_type' => InventoryOrder::class,
        'reference_id' => $order->id,
    ]);

    $svc = app(ProfitEngineService::class);
    $snapshot = $svc->getCashProfitSnapshot('2026-06-01', '2026-06-30');

    expect($snapshot['total_receipts'])->toBe(200.0)
        ->and($snapshot['unlinked_receipt_count'])->toBe(0)
        ->and($snapshot)->toHaveKey('cash_period_result')
        ->and($snapshot['cash_period_result'])->toBe($snapshot['net_profit']);
});

it('keeps ROI net_profit identical to profit-summary and ignores purchase invoices as COGS', function () {
    $user = User::factory()->create();
    $this->actingAs($user);

    CapitalSource::query()->create([
        'name' => 'Seed capital',
        'type' => 'owner',
        'amount' => 10000,
        'ownership_percentage' => 100,
        'user_id' => $user->id,
    ]);

    $channel = Channel::query()->create([
        'name' => 'Store PnL',
        'slug' => 'store-pnl-'.uniqid(),
        'type' => 'pos',
        'is_active' => true,
    ]);
    $channel->update(['user_id' => $user->id]);

    $master = MasterProduct::query()->create([
        'internal_name' => 'PnL Widget',
        'is_active' => true,
        'last_purchase_price' => 40,
    ]);
    $master->update(['user_id' => $user->id]);

    $offer = InventoryOffer::query()->create([
        'master_product_id' => $master->id,
        'name' => 'PnL Widget',
        'type' => 'single',
    ]);
    $offer->update(['user_id' => $user->id]);

    $sku = Sku::query()->create([
        'offer_id' => $offer->id,
        'sku' => 'PNL-'.uniqid(),
        'channel_id' => $channel->id,
        'cost_price' => 40,
        'selling_price' => 100,
        'is_active' => true,
    ]);
    $sku->update(['user_id' => $user->id]);

    $order = InventoryOrder::query()->create([
        'channel_id' => $channel->id,
        'platform_order_id' => 'ORD-PNL-1',
        'status' => 'completed',
        'order_date' => '2026-09-10',
        'total_amount' => 200,
        'user_id' => $user->id,
    ]);

    InventoryOrderItem::query()->create([
        'inventory_order_id' => $order->id,
        'sku_id' => $sku->id,
        'sku_code' => $sku->sku,
        'product_name' => 'PnL Widget',
        'quantity' => 2,
        'unit_price' => 100,
        'total_price' => 200,
        'user_id' => $user->id,
    ]);

    Expense::query()->create([
        'expense_number' => 'EXP-PNL-'.uniqid(),
        'type' => 'operating',
        'category' => 'other',
        'amount' => 25,
        'expense_date' => '2026-09-12',
        'description' => 'period expense',
        'user_id' => $user->id,
    ]);

    // Huge purchase invoice in the same period — must NOT change official net_profit.
    PurchaseBatch::query()->create([
        'batch_number' => 'PB-PNL-'.uniqid(),
        'user_id' => $user->id,
        'status' => 'received',
        'invoice_date' => '2026-09-05',
        'received_at' => now(),
        'currency' => 'EGP',
        'subtotal' => 50000,
        'tax_amount' => 0,
        'grand_total' => 50000,
    ]);

    $svc = app(ProfitEngineService::class);
    $summary = $svc->getProfitSummary('2026-09-01', '2026-09-30');
    $roi = $svc->getRoiMetrics([
        'start_date' => '2026-09-01',
        'end_date' => '2026-09-30',
    ]);

    // Revenue 200 − COGS (2×40=80) − expenses 25 = 95
    expect($summary['net_profit'])->toBe(95.0)
        ->and($roi['net_profit'])->toBe($summary['net_profit'])
        ->and($roi['revenue'])->toBe($summary['revenue'])
        ->and($roi['cogs'])->toBe($summary['cogs'])
        ->and($roi['total_purchases'])->toBe(50000.0)
        ->and($roi['gross_margin'])->toBe(round((($roi['revenue'] - $roi['cogs']) / $roi['revenue']) * 100, 2))
        ->and($roi['net_margin'])->toBe(round(($roi['net_profit'] / $roi['revenue']) * 100, 2))
        ->and($roi['roi'])->toBe(round(($roi['net_profit'] / 10000) * 100, 2));

    // Net must not equal the old broken formula: sales − purchases − expenses
    $broken = $roi['revenue'] - $roi['total_purchases'] - $roi['total_expenses'];
    expect($roi['net_profit'])->not->toBe(round($broken, 2));
});

it('counts Amazon later-sheet refund once via settlement net and ignores payment-sheet InventoryReturn', function () {
    $user = User::factory()->create();
    $this->actingAs($user);

    $channel = Channel::query()->create([
        'name' => 'Amazon PnL',
        'slug' => 'amazon-pnl-'.uniqid(),
        'type' => 'marketplace',
        'is_active' => true,
    ]);
    $channel->update(['user_id' => $user->id]);

    $master = MasterProduct::query()->create([
        'internal_name' => 'Yoga Roll',
        'is_active' => true,
        'last_purchase_price' => 50,
    ]);
    $master->update(['user_id' => $user->id]);

    $offer = InventoryOffer::query()->create([
        'master_product_id' => $master->id,
        'name' => 'Yoga Roll',
        'type' => 'single',
    ]);
    $offer->update(['user_id' => $user->id]);

    $sku = Sku::query()->create([
        'offer_id' => $offer->id,
        'sku' => 'YR-'.uniqid(),
        'channel_id' => $channel->id,
        'cost_price' => 50,
        'selling_price' => 200,
        'is_active' => true,
    ]);
    $sku->update(['user_id' => $user->id]);

    $platformOrderId = '402-SETTLE-REFUND-1';
    $order = InventoryOrder::query()->create([
        'channel_id' => $channel->id,
        'platform_order_id' => $platformOrderId,
        'status' => 'completed',
        'order_date' => '2026-09-05',
        'total_amount' => 200,
        'user_id' => $user->id,
    ]);

    InventoryOrderItem::query()->create([
        'inventory_order_id' => $order->id,
        'sku_id' => $sku->id,
        'sku_code' => $sku->sku,
        'product_name' => 'Yoga Roll',
        'quantity' => 1,
        'unit_price' => 200,
        'total_price' => 200,
        'user_id' => $user->id,
    ]);

    $settlementPay = Settlement::query()->create([
        'channel_id' => $channel->id,
        'report_id' => 'RPT-PAY-'.uniqid(),
        'start_date' => '2026-09-01',
        'end_date' => '2026-09-15',
        'total_amount' => 170,
        'status' => 'reconciled',
        'user_id' => $user->id,
    ]);

    // Sheet N: principal + commission
    \App\Domain\Models\Wms\SettlementItem::query()->create([
        'settlement_id' => $settlementPay->id,
        'platform_order_id' => $platformOrderId,
        'inventory_order_id' => $order->id,
        'transaction_type' => 'Order',
        'transaction_status' => 'released',
        'line_kind' => 'order_principal',
        'description' => 'ItemPrice: Principal',
        'amount' => 200,
        'fee_amount' => 0,
        'quantity' => 1,
        'transaction_date' => '2026-09-10 12:00:00',
        'reconciliation_status' => 'matched',
    ]);
    \App\Domain\Models\Wms\SettlementItem::query()->create([
        'settlement_id' => $settlementPay->id,
        'platform_order_id' => $platformOrderId,
        'inventory_order_id' => $order->id,
        'transaction_type' => 'Order',
        'transaction_status' => 'released',
        'line_kind' => 'platform_fee',
        'description' => 'ItemFee: Commission',
        'amount' => -30,
        'fee_amount' => 0,
        'quantity' => 1,
        'transaction_date' => '2026-09-10 12:00:00',
        'reconciliation_status' => 'matched',
    ]);

    $settlementRefund = Settlement::query()->create([
        'channel_id' => $channel->id,
        'report_id' => 'RPT-REF-'.uniqid(),
        'start_date' => '2026-09-16',
        'end_date' => '2026-09-30',
        'total_amount' => -200,
        'status' => 'reconciled',
        'user_id' => $user->id,
    ]);

    $refundItem = \App\Domain\Models\Wms\SettlementItem::query()->create([
        'settlement_id' => $settlementRefund->id,
        'platform_order_id' => $platformOrderId,
        'inventory_order_id' => $order->id,
        'transaction_type' => 'Refund',
        'transaction_status' => 'released',
        'line_kind' => 'refund_principal',
        'description' => 'RefundPrice: Principal',
        'amount' => -200,
        'fee_amount' => 0,
        'quantity' => 1,
        'transaction_date' => '2026-09-20 12:00:00',
        'reconciliation_status' => 'matched',
    ]);

    // Claim return created from payment sheet — must NOT double-subtract.
    \App\Domain\Models\Wms\InventoryReturn::query()->create(
        \App\Domain\Models\Wms\InventoryReturn::mergeCreateDefaults([
            'inventory_order_id' => $order->id,
            'platform_return_id' => 'STL-TEST-'.$refundItem->id,
            'sku_code' => $sku->sku,
            'return_quantity' => 1,
            'return_date' => '2026-09-20',
            'external_status' => 'refund_from_payment_sheet',
            'refund_amount' => 200,
            'status' => 'pending',
            'user_id' => $user->id,
            'metadata' => [
                'settlement_item_id' => $refundItem->id,
                'claim_marker' => true,
            ],
        ])
    );

    $svc = app(ProfitEngineService::class);
    $summary = $svc->getProfitSummary('2026-09-01', '2026-09-30');

    // Net across sheets: 200 - 30 - 200 = -30; profit = -30 - COGS(50) = -80
    // Old bug: also subtracted InventoryReturn 200 → -280
    expect($summary['revenue'])->toBe(-30.0)
        ->and($summary['refunds'])->toBe(0.0)
        ->and($summary['cogs'])->toBe(50.0)
        ->and($summary['net_profit'])->toBe(-80.0);
});
