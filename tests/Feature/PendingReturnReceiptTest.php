<?php

use App\Application\Services\PendingReturnReceiptService;
use App\Domain\Models\Wms\InventoryOrder;
use App\Domain\Models\Wms\InventoryOrderItem;
use App\Domain\Models\Wms\InventoryReturn;
use App\Models\User;
use Illuminate\Support\Facades\DB;

function pendingFixture(): array
{
    $user = User::factory()->create();
    test()->actingAs($user);
    $channel = \App\Domain\Models\Wms\Channel::query()->create(['name' => 'Amazon P', 'slug' => 'amz-p-'.uniqid(), 'type' => 'marketplace', 'is_active' => true]);
    $channel->update(['user_id' => $user->id]);
    $master = \App\Domain\Models\Wms\MasterProduct::query()->create(['internal_name' => 'Gun', 'is_active' => true, 'last_purchase_price' => 50]);
    $master->update(['user_id' => $user->id]);
    $offer = \App\Domain\Models\Wms\InventoryOffer::query()->create(['master_product_id' => $master->id, 'name' => 'Gun', 'type' => 'single']);
    $offer->update(['user_id' => $user->id]);
    $sku = \App\Domain\Models\Wms\Sku::query()->create(['offer_id' => $offer->id, 'sku' => 'G-'.uniqid(), 'channel_id' => $channel->id, 'cost_price' => 50, 'selling_price' => 200, 'is_active' => true]);
    $sku->update(['user_id' => $user->id]);

    $order = InventoryOrder::query()->create(['channel_id' => $channel->id, 'platform_order_id' => '402-7000001-0000001', 'status' => 'shipped', 'order_date' => '2026-09-01', 'total_amount' => 400, 'user_id' => $user->id]);
    InventoryOrderItem::query()->create(['inventory_order_id' => $order->id, 'sku_id' => $sku->id, 'sku_code' => $sku->sku, 'product_name' => 'Gun', 'quantity' => 2, 'unit_price' => 200, 'total_price' => 400, 'user_id' => $user->id]);

    return [$user, $sku, $order];
}

function claimMarker(User $user, InventoryOrder $order, string $sku, string $date): InventoryReturn
{
    return InventoryReturn::query()->create([
        'user_id' => $user->id, 'inventory_order_id' => $order->id, 'platform_return_id' => 'STL-'.uniqid(),
        'sku_code' => $sku, 'return_quantity' => 1, 'refund_amount' => 200, 'return_date' => $date,
        'external_status' => 'refund_from_payment_sheet', 'status' => 'pending', 'inventory_status' => 'on_hold',
        'reason' => 'Refund', 'metadata' => ['claim_marker' => true],
    ]);
}

function receivedReturn(User $user, InventoryOrder $order, string $sku, int $skuId): InventoryReturn
{
    $r = InventoryReturn::query()->create([
        'user_id' => $user->id, 'inventory_order_id' => $order->id, 'platform_return_id' => 'MAN-'.uniqid(),
        'sku_code' => $sku, 'return_quantity' => 1, 'return_date' => '2026-09-05', 'status' => 'completed',
        'inventory_status' => 'restocked', 'reason' => 'Customer return',
    ]);
    DB::table('inventory_transactions')->insert([
        'user_id' => $user->id, 'sku_id' => $skuId, 'location_id' => \App\Domain\Models\Wms\InventoryLocation::query()->create(['name' => 'WH '.uniqid(), 'type' => 'warehouse', 'is_active' => true, 'user_id' => $user->id])->id, 'type' => 'IN', 'quantity' => 1, 'reference_type' => 'Return',
        'reference_id' => (string) $r->id, 'notes' => 'test', 'created_at' => now(), 'updated_at' => now(),
    ]);

    return $r;
}

it('lists refunded returns with no stock IN, flags those older than 14 days, and links one per received unit', function () {
    [$user, $sku, $order] = pendingFixture();

    claimMarker($user, $order, $sku->sku, '2026-09-03');
    claimMarker($user, $order, $sku->sku, '2026-09-03');
    receivedReturn($user, $order, $sku->sku, $sku->id);

    $svc = app(PendingReturnReceiptService::class);
    $summary = $svc->summary($user->id);
    expect($summary['count'])->toBe(2)->and($summary['overdue'])->toBe(2)->and($summary['refund_total'])->toBe(400.0);

    $links = $svc->findLinkable($user->id);
    expect($links)->toHaveCount(1);

    $svc->applyLinks($links);
    expect($svc->summary($user->id)['count'])->toBe(1)
        ->and($svc->findLinkable($user->id))->toHaveCount(0)
        ->and(\App\Domain\Models\Wms\InventoryAuditLog::where('action', 'return.claim_marker_linked_to_received')->count())->toBe(1);

    $this->getJson('/api/inventory/returns/awaiting-receipt')
        ->assertOk()
        ->assertJsonPath('summary.count', 1)
        ->assertJsonPath('data.0.order_number', '402-7000001-0000001');
});

it('does not bring a linked (voided) claim marker back to pending when the same payment sheet is re-imported', function () {
    [$user, $sku, $order] = pendingFixture();

    $settlement = \App\Domain\Models\Wms\Settlement::query()->create([
        'channel_id' => $order->channel_id, 'report_id' => 'RPT-PR-'.uniqid(), 'start_date' => '2026-09-01',
        'end_date' => '2026-09-15', 'total_amount' => 0, 'status' => 'reconciled', 'user_id' => $user->id,
    ]);
    $item = \App\Domain\Models\Wms\SettlementItem::query()->create([
        'settlement_id' => $settlement->id, 'platform_order_id' => $order->platform_order_id, 'inventory_order_id' => $order->id,
        'transaction_type' => 'Refund', 'transaction_status' => 'released', 'description' => 'RefundPrice: Principal',
        'sku' => $sku->sku, 'amount' => -200, 'quantity' => 1, 'transaction_date' => '2026-09-03',
    ]);

    $sync = new ReflectionMethod(\App\Application\Services\SettlementService::class, 'syncReturnFromSettlementItem');
    $svc = app(\App\Application\Services\SettlementService::class);
    $sync->invoke($svc, $settlement, $item, $order);

    $marker = InventoryReturn::query()->where('metadata->settlement_item_id', $item->id)->firstOrFail();
    expect($marker->status)->toBe('pending');

    receivedReturn($user, $order, $sku->sku, $sku->id);
    $pending = app(PendingReturnReceiptService::class);
    $pending->applyLinks($pending->findLinkable($user->id));
    expect($marker->fresh()->status)->toBe('void');

    $sync->invoke($svc, $settlement, $item->fresh(), $order);
    expect($marker->fresh()->status)->toBe('void')
        ->and($pending->summary($user->id)['count'])->toBe(0);
});
