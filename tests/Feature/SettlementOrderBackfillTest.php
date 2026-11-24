<?php

use App\Application\Services\OrderEpochDateRepairService;
use App\Application\Services\ProfitEngineService;
use App\Application\Services\SettlementOrderBackfillService;
use App\Application\Services\SettlementService;
use App\Domain\Models\Wms\Channel;
use App\Domain\Models\Wms\InventoryAuditLog;
use App\Domain\Models\Wms\InventoryOffer;
use App\Domain\Models\Wms\InventoryOrder;
use App\Domain\Models\Wms\InventoryOrderItem;
use App\Domain\Models\Wms\MasterProduct;
use App\Domain\Models\Wms\Settlement;
use App\Domain\Models\Wms\SettlementItem;
use App\Domain\Models\Wms\Sku;
use App\Models\User;

function backfillFixture(User $user, ?string $start = '2026-04-01'): array
{
    $channel = Channel::query()->create(['name' => 'Amazon BF', 'slug' => 'amz-bf-'.uniqid(), 'type' => 'amazon_fba', 'is_active' => true]);
    $channel->update(['user_id' => $user->id, 'stock_tracking_starts_at' => $start]);
    $master = MasterProduct::query()->create(['internal_name' => 'Gun', 'is_active' => true, 'last_purchase_price' => 100]);
    $master->update(['user_id' => $user->id]);
    $offer = InventoryOffer::query()->create(['master_product_id' => $master->id, 'name' => 'Gun', 'type' => 'single']);
    $offer->update(['user_id' => $user->id]);
    $sku = Sku::query()->create(['offer_id' => $offer->id, 'sku' => 'BF-'.uniqid(), 'channel_id' => $channel->id, 'cost_price' => 100, 'selling_price' => 300, 'is_active' => true]);
    $sku->update(['user_id' => $user->id]);
    $settlement = Settlement::query()->create([
        'channel_id' => $channel->id, 'report_id' => 'RPT-BF-'.uniqid(), 'start_date' => '2026-03-20',
        'end_date' => '2026-05-05', 'total_amount' => 0, 'status' => 'reconciled', 'user_id' => $user->id,
    ]);

    return compact('channel', 'sku', 'settlement');
}

function sheetLine(Settlement $s, string $oid, string $sku, string $desc, float $amount, string $date, int $qty = 1): void
{
    SettlementItem::query()->create([
        'settlement_id' => $s->id, 'platform_order_id' => $oid, 'sku' => $sku, 'transaction_type' => str_starts_with($desc, 'Refund') ? 'Refund' : 'Order',
        'transaction_status' => 'released', 'description' => $desc, 'amount' => $amount, 'fee_amount' => 0, 'quantity' => $qty,
        'transaction_date' => $date.' 10:00:00', 'reconciliation_status' => 'unreconciled',
    ]);
}

it('creates a paid order missing from the system from its sheet lines, without touching stock, and it enters P&L', function () {
    $user = User::factory()->create();
    $this->actingAs($user);
    $fx = backfillFixture($user);
    $s = $fx['settlement'];
    $code = $fx['sku']->sku;

    sheetLine($s, '402-0000001-0000001', $code, 'ItemPrice: Principal', 600, '2026-04-10', 2);
    sheetLine($s, '402-0000001-0000001', $code, 'ItemFee: Commission', -60, '2026-04-10');
    sheetLine($s, '402-0000002-0000002', $code, 'ItemPrice: Principal', 300, '2026-03-25');   // before start: archived
    sheetLine($s, '402-0000003-0000003', $code, 'ItemFee: Commission', -30, '2026-04-12');    // fees only: cannot be priced

    $svc = app(SettlementOrderBackfillService::class);
    $plan = $svc->plan($user->id);
    expect($plan['orders'])->toHaveCount(1)
        ->and($plan['skipped_no_sale_line'])->toBe(1)
        ->and($plan['orders'][0]['items'][0])->toMatchArray(['sku_id' => $fx['sku']->id, 'quantity' => 2, 'unit_price' => 300.0]);

    $res = $svc->apply($plan, $user->id);
    expect($res['created'])->toBe(1);

    $order = InventoryOrder::where('platform_order_id', '402-0000001-0000001')->firstOrFail();
    $item = InventoryOrderItem::where('inventory_order_id', $order->id)->firstOrFail();
    expect($order->status)->toBe('shipped')
        ->and($order->order_date->toDateString())->toBe('2026-04-10')
        ->and($item->stock_deduction_status)->toBe('not_applicable')
        ->and(DB::table('inventory_transactions')->where('reference_id', (string) $order->id)->count())->toBe(0)
        ->and(SettlementItem::where('platform_order_id', '402-0000001-0000001')->whereNull('inventory_order_id')->count())->toBe(0)
        ->and(InventoryAuditLog::where('action', 'order.created_from_payment_sheet')->count())->toBe(1);

    // P&L: 600 sale − 60 fee − 2 × 100 cost; the March order stays archived, not "missing".
    $sum = app(ProfitEngineService::class)->getProfitSummary('2026-03-01', '2026-04-30');
    expect($sum['orders_profit'])->toBe(340.0)
        ->and($sum['orders_missing_from_system']['orders'])->toBe(1)       // the fees-only one
        ->and($sum['orders_before_start_archived']['orders'])->toBe(1);

    // Idempotent: running again creates nothing.
    expect($svc->plan($user->id)['orders'])->toHaveCount(0);
});

it('skips channels with no start date unless a since date is given', function () {
    $user = User::factory()->create();
    $this->actingAs($user);
    $fx = backfillFixture($user, null);
    sheetLine($fx['settlement'], '402-0000004-0000004', $fx['sku']->sku, 'ItemPrice: Principal', 300, '2026-04-20');

    $svc = app(SettlementOrderBackfillService::class);
    expect($svc->plan($user->id)['orders'])->toHaveCount(0)
        ->and($svc->plan($user->id)['channels_without_start'])->toBe(['Amazon BF'])
        ->and($svc->plan($user->id, '2026-04-01')['orders'])->toHaveCount(1);
});

it('marks sheets that end before the channel start as archived, not incomplete', function () {
    $user = User::factory()->create();
    $this->actingAs($user);
    $fx = backfillFixture($user, '2026-04-01');
    $old = Settlement::query()->create([
        'channel_id' => $fx['channel']->id, 'report_id' => 'RPT-OLD-'.uniqid(), 'start_date' => '2026-02-01',
        'end_date' => '2026-02-14', 'total_amount' => 5000, 'status' => 'reconciled', 'user_id' => $user->id,
    ]);

    $svc = app(SettlementService::class);
    expect($svc->buildReconciliationSummary($old->fresh())['completeness'])->toBe(SettlementService::SHEET_ARCHIVED);
    $list = $this->getJson('/api/inventory/settlements')->assertOk();
    expect($list->json('incomplete_sheets.count'))->toBe(0)
        ->and(collect($list->json('data'))->firstWhere('id', $old->id)['completeness'])->toBe('archived');
});

it('rebuilds a 1970 order date from the same import, audited', function () {
    $user = User::factory()->create();
    $this->actingAs($user);
    $fx = backfillFixture($user);
    $mk = fn (string $pid, string $date) => InventoryOrder::query()->create([
        'channel_id' => $fx['channel']->id, 'platform_order_id' => $pid, 'status' => 'shipped', 'order_date' => $date,
        'total_amount' => 300, 'user_id' => $user->id,
    ]);
    $mk('171-0000001-0000001', '2026-04-18 09:00:00');
    $mk('171-0000002-0000002', '2026-04-19 09:00:00');
    $mk('171-0000003-0000003', '2026-04-20 09:00:00');
    $broken = $mk('171-0000009-0000009', '1970-01-01 00:00:00');

    $svc = app(OrderEpochDateRepairService::class);
    $plan = $svc->plan($user->id);
    expect($plan)->toHaveCount(1)->and($plan->first()['source'])->toBe('same_import_median');

    $svc->apply($plan);
    expect($broken->fresh()->order_date->toDateString())->toBe('2026-04-19')
        ->and($svc->plan($user->id))->toHaveCount(0)
        ->and(InventoryAuditLog::where('action', 'order.epoch_date_repaired')->count())->toBe(1);
});
