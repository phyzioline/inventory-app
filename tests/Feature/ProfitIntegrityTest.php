<?php

use App\Application\Services\ProfitEngineService;
use App\Application\Services\SettlementCrossSheetDuplicateService;
use App\Application\Services\SettlementService;
use App\Domain\Models\Wms\CapitalSource;
use App\Domain\Models\Wms\Channel;
use App\Domain\Models\Wms\Expense;
use App\Domain\Models\Wms\InventoryLocation;
use App\Domain\Models\Wms\InventoryOffer;
use App\Domain\Models\Wms\InventoryOrder;
use App\Domain\Models\Wms\InventoryOrderItem;
use App\Domain\Models\Wms\InventoryReturn;
use App\Domain\Models\Wms\MasterProduct;
use App\Domain\Models\Wms\Receipt;
use App\Domain\Models\Wms\Settlement;
use App\Domain\Models\Wms\SettlementItem;
use App\Domain\Models\Wms\Sku;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Money-integrity rules from the 2026-10-19 profit audit.
 */
function profitFixture(float $unitCost = 50): array
{
    $user = User::factory()->create();
    test()->actingAs($user);

    $channel = Channel::query()->create([
        'name' => 'Amazon Integrity',
        'slug' => 'amazon-integrity-'.uniqid(),
        'type' => 'marketplace',
        'is_active' => true,
    ]);
    $channel->update(['user_id' => $user->id]);

    $master = MasterProduct::query()->create([
        'internal_name' => 'Massage Gun',
        'is_active' => true,
        'last_purchase_price' => $unitCost,
    ]);
    $master->update(['user_id' => $user->id]);

    $offer = InventoryOffer::query()->create([
        'master_product_id' => $master->id,
        'name' => 'Massage Gun',
        'type' => 'single',
    ]);
    $offer->update(['user_id' => $user->id]);

    $sku = Sku::query()->create([
        'offer_id' => $offer->id,
        'sku' => 'MG-'.uniqid(),
        'channel_id' => $channel->id,
        'cost_price' => $unitCost,
        'selling_price' => 200,
        'is_active' => true,
    ]);
    $sku->update(['user_id' => $user->id]);

    return [$user, $channel, $sku];
}

function profitOrder(User $user, Channel $channel, ?Sku $sku, string $code, string $platformId, string $date, string $status = 'shipped'): InventoryOrder
{
    $order = InventoryOrder::query()->create([
        'channel_id' => $channel->id,
        'platform_order_id' => $platformId,
        'status' => $status,
        'order_date' => $date,
        'total_amount' => 200,
        'user_id' => $user->id,
    ]);

    InventoryOrderItem::query()->create([
        'inventory_order_id' => $order->id,
        'sku_id' => $sku?->id,
        'sku_code' => $code,
        'product_name' => 'Massage Gun',
        'quantity' => 1,
        'unit_price' => 200,
        'total_price' => 200,
        'user_id' => $user->id,
    ]);

    return $order;
}

function settlementLine(User $user, Channel $channel, InventoryOrder $order, array $attrs): SettlementItem
{
    $settlement = Settlement::query()->create([
        'channel_id' => $channel->id,
        'report_id' => 'RPT-'.uniqid(),
        'start_date' => substr($attrs['transaction_date'], 0, 10),
        'end_date' => substr($attrs['transaction_date'], 0, 10),
        'total_amount' => $attrs['amount'],
        'status' => 'reconciled',
        'user_id' => $user->id,
    ]);

    return SettlementItem::query()->create(array_merge([
        'settlement_id' => $settlement->id,
        'platform_order_id' => $order->platform_order_id,
        'inventory_order_id' => $order->id,
        'transaction_status' => 'released',
        'fee_amount' => 0,
        'quantity' => 1,
        'reconciliation_status' => 'matched',
    ], $attrs));
}

it('keeps a refund posted the following month with the order it reverses', function () {
    [$user, $channel, $sku] = profitFixture();
    $order = profitOrder($user, $channel, $sku, $sku->sku, '402-COHORT-1', '2026-08-28');

    settlementLine($user, $channel, $order, [
        'transaction_type' => 'Order', 'description' => 'ItemPrice: Principal', 'sku' => $sku->sku,
        'line_kind' => 'order_principal', 'amount' => 200, 'transaction_date' => '2026-08-30 10:00:00',
    ]);
    settlementLine($user, $channel, $order, [
        'transaction_type' => 'Refund', 'description' => 'RefundPrice: Principal', 'sku' => $sku->sku,
        'line_kind' => 'refund_principal', 'amount' => -200, 'transaction_date' => '2026-09-12 10:00:00',
    ]);

    $svc = app(ProfitEngineService::class);
    $august = $svc->getProfitSummary('2026-08-01', '2026-08-31');
    $september = $svc->getProfitSummary('2026-09-01', '2026-09-30');

    // Before: August booked +200 revenue and September (no orders) never saw the −200 refund.
    expect($august['revenue'])->toBe(0.0)
        ->and($september['revenue'])->toBe(0.0);
});

it('costs order lines imported before their SKU existed instead of booking them as pure profit', function () {
    [$user, $channel, $sku] = profitFixture(60);
    profitOrder($user, $channel, null, $sku->sku, 'LEGACY-1', '2026-02-10');
    profitOrder($user, $channel, null, 'NO-SUCH-SKU', 'LEGACY-2', '2026-02-11');

    $summary = app(ProfitEngineService::class)->getProfitSummary('2026-02-01', '2026-02-28');

    expect($summary['cogs'])->toBe(60.0)
        ->and($summary['uncosted_lines'])->toBe(1)
        ->and($summary['uncosted_revenue'])->toBe(200.0);

    $bySku = collect(app(ProfitEngineService::class)->getProfitBySku('2026-02-01', '2026-02-28', 50));
    expect((float) $bySku->firstWhere('sku_code', $sku->sku)['cogs'])->toBe(60.0);
});

it('reverses COGS only for refunded units that came back to stock', function () {
    [$user, $channel, $sku] = profitFixture(50);

    $refundedBack = profitOrder($user, $channel, $sku, $sku->sku, '402-RESTOCK-1', '2026-07-05');
    settlementLine($user, $channel, $refundedBack, [
        'transaction_type' => 'Order', 'description' => 'ItemPrice: Principal', 'sku' => $sku->sku,
        'line_kind' => 'order_principal', 'amount' => 200, 'transaction_date' => '2026-07-07 10:00:00',
    ]);
    settlementLine($user, $channel, $refundedBack, [
        'transaction_type' => 'Refund', 'description' => 'RefundPrice: Principal', 'sku' => $sku->sku,
        'line_kind' => 'refund_principal', 'amount' => -200, 'transaction_date' => '2026-07-20 10:00:00',
    ]);

    // Restocked flag + ledger IN + auto-filled credit amount, but the platform never refunded the buyer:
    // the sale stands, cost stays.
    $notRefunded = profitOrder($user, $channel, $sku, $sku->sku, '402-RESTOCK-2', '2026-07-06');
    settlementLine($user, $channel, $notRefunded, [
        'transaction_type' => 'Order', 'description' => 'ItemPrice: Principal', 'sku' => $sku->sku,
        'line_kind' => 'order_principal', 'amount' => 200, 'transaction_date' => '2026-07-08 10:00:00',
    ]);

    $location = InventoryLocation::query()->create([
        'name' => 'FBA Warehouse', 'type' => 'Warehouse', 'channel_id' => $channel->id, 'is_active' => true,
    ]);

    foreach ([$refundedBack, $notRefunded] as $order) {
        $return = InventoryReturn::query()->create(InventoryReturn::mergeCreateDefaults([
            'inventory_order_id' => $order->id,
            'sku_code' => $sku->sku,
            'return_quantity' => 1,
            'return_date' => '2026-07-18',
            'external_status' => 'Returned to FBA warehouse',
            'refund_amount' => 200,
            'status' => 'completed',
            'user_id' => $user->id,
        ]));
        DB::table('inventory_transactions')->insert([
            'user_id' => $user->id,
            'sku_id' => $sku->id,
            'location_id' => $location->id,
            'type' => 'IN',
            'quantity' => 1,
            'reference_type' => 'Return',
            'reference_id' => (string) $return->id,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    $summary = app(ProfitEngineService::class)->getProfitSummary('2026-07-01', '2026-07-31');

    expect($summary['cogs_reversed_restocked_returns'])->toBe(50.0)
        ->and($summary['cogs'])->toBe(50.0);
});

it('moves a paid order out of pending so P&L recognises it', function () {
    [$user, $channel, $sku] = profitFixture();
    $order = profitOrder($user, $channel, $sku, $sku->sku, '402-PENDING-1', '2026-09-03', 'pending');
    settlementLine($user, $channel, $order, [
        'transaction_type' => 'Order', 'description' => 'ItemPrice: Principal', 'sku' => $sku->sku,
        'line_kind' => 'order_principal', 'amount' => 200, 'transaction_date' => '2026-09-08 10:00:00',
    ]);

    app(SettlementService::class)->recomputeOrderFinancialStatuses($order->id);

    $order->refresh();
    expect($order->status)->toBe('shipped')
        ->and($order->financial_status)->toBe('charged')
        ->and(app(ProfitEngineService::class)->getProfitSummary('2026-09-01', '2026-09-30')['revenue'])->toBe(200.0);
});

it('does not post the same statement line twice when two sheets overlap', function () {
    $user = User::factory()->create();
    $this->actingAs($user);
    $channel = Channel::factory()->create([
        'user_id' => $user->id, 'name' => 'Noon', 'slug' => 'noon-'.uniqid(), 'type' => 'marketplace', 'is_active' => true,
    ]);

    $header = 'settlement-id,settlement-start-date,settlement-end-date,order-id,transaction-type,amount,sku,quantity-purchased,posted-date,currency';
    $sheetA = [$header,
        'PS-A,2026-08-01,2026-08-19,NEG-1,Order,300.00,N-SKU,1,2026-08-10,EGP',
        'PS-A,2026-08-01,2026-08-19,NEG-2,Order,150.00,N-SKU,1,2026-08-11,EGP',
    ];
    $sheetB = [$header,
        'PS-B,2026-08-10,2026-08-26,NEG-2,Order,150.00,N-SKU,1,2026-08-11,EGP',
        'PS-B,2026-08-10,2026-08-26,NEG-3,Order,90.00,N-SKU,1,2026-08-22,EGP',
    ];

    $svc = app(SettlementService::class);
    foreach ([$sheetA, $sheetB] as $i => $rows) {
        $path = tempnam(sys_get_temp_dir(), 'noon_').'.csv';
        file_put_contents($path, implode("\n", $rows));
        $svc->importAmazonSettlement($channel->id, $path);
    }

    expect(SettlementItem::query()->where('platform_order_id', 'NEG-2')->count())->toBe(1)
        ->and(SettlementItem::query()->count())->toBe(3);
});

it('finds and removes historical cross-sheet duplicates, keeping the first sheet', function () {
    [$user, $channel, $sku] = profitFixture();
    $order = profitOrder($user, $channel, $sku, $sku->sku, 'NOON-DUP-1', '2026-08-05');
    $line = [
        'transaction_type' => 'Order', 'description' => 'Item Price', 'sku' => $sku->sku,
        'amount' => 150, 'transaction_date' => '2026-08-11 00:00:00',
    ];
    $first = settlementLine($user, $channel, $order, $line);
    $copy = settlementLine($user, $channel, $order, $line);

    $service = app(SettlementCrossSheetDuplicateService::class);
    $duplicates = $service->findDuplicates($user->id);

    expect($duplicates->pluck('id')->all())->toBe([$copy->id]);
    expect($service->remove($duplicates))->toBe(1);
    expect(SettlementItem::query()->pluck('id')->all())->toBe([$first->id]);
});

it('reports ROI cash in hand from the treasury ledger and inventory days from COGS', function () {
    [$user, $channel, $sku] = profitFixture(50);

    // Capital creates its own receipt (CapitalReceiptWriter) — it must not be counted twice.
    CapitalSource::query()->create([
        'name' => 'Owner', 'type' => 'owner', 'amount' => 1000, 'ownership_percentage' => 100, 'user_id' => $user->id,
    ]);
    if (! Receipt::query()->where('category', 'capital')->exists()) {
        Receipt::query()->create([
            'receipt_number' => 'RC-CAP-1', 'type' => 'Capital Injection', 'category' => 'capital',
            'amount' => 1000, 'receipt_date' => '2026-09-01', 'user_id' => $user->id,
        ]);
    }
    Expense::query()->create([
        'expense_number' => 'EXP-'.uniqid(), 'type' => 'operating', 'category' => 'rent',
        'amount' => 300, 'expense_date' => '2026-09-02', 'description' => 'rent', 'user_id' => $user->id,
    ]);

    profitOrder($user, $channel, $sku, $sku->sku, 'ROI-1', '2026-09-01');
    profitOrder($user, $channel, $sku, $sku->sku, 'ROI-2', '2026-09-30');

    $roi = app(ProfitEngineService::class)->getRoiMetrics(['start_date' => '2026-09-01', 'end_date' => '2026-09-30']);

    expect($roi['cash_in_hand'])->toBe(700.0)          // 1000 receipts − 300 expenses (capital not added again)
        ->and($roi['inventory_at_cost'])->toBe(0.0)    // no stock in the fixture
        ->and($roi['rotation_days'])->toBe(0);
});
