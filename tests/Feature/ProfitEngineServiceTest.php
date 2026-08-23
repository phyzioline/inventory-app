<?php

use App\Models\User;
use App\Application\Services\ProfitEngineService;
use App\Domain\Models\Wms\Channel;
use App\Domain\Models\Wms\InventoryOrder;
use App\Domain\Models\Wms\Receipt;
use App\Domain\Models\Wms\Settlement;

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
        ->and($snapshot['unlinked_receipt_count'])->toBe(0);
});
