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
