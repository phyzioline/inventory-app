<?php

use App\Application\Services\ReturnExcessRestockCorrectionService;
use App\Domain\Models\Wms\Channel;
use App\Domain\Models\Wms\InventoryLocation;
use App\Domain\Models\Wms\InventoryOffer;
use App\Domain\Models\Wms\InventoryOrder;
use App\Domain\Models\Wms\InventoryOrderItem;
use App\Domain\Models\Wms\InventoryReturn;
use App\Domain\Models\Wms\InventoryTransaction;
use App\Domain\Models\Wms\MasterProduct;
use App\Domain\Models\Wms\Sku;
use App\Domain\Models\Wms\SkuInventory;
use App\Models\User;

/** One FBA order of 1 unit, with stock row at the FBA location. */
function excessReturnFixture(float $onHand = 0): array
{
    $user = User::factory()->create();
    test()->actingAs($user);

    $channel = Channel::query()->create(['name' => 'Amazon FBA', 'slug' => 'fba-'.uniqid(), 'type' => 'fba', 'is_active' => true]);
    $channel->update(['user_id' => $user->id]);
    $location = InventoryLocation::query()->create(['name' => 'FBA FC', 'type' => 'fba', 'channel_id' => $channel->id, 'is_active' => true]);
    $location->update(['user_id' => $user->id]);
    $master = MasterProduct::query()->create(['internal_name' => 'Massage Bed', 'is_active' => true]);
    $master->update(['user_id' => $user->id]);
    $offer = InventoryOffer::query()->create(['master_product_id' => $master->id, 'name' => 'Single', 'type' => 'single']);
    $offer->update(['user_id' => $user->id]);
    $sku = Sku::query()->create([
        'offer_id' => $offer->id, 'sku' => 'GT-'.uniqid(), 'channel_id' => $channel->id,
        'cost_price' => 0, 'selling_price' => 0, 'is_active' => true,
    ]);
    $sku->update(['user_id' => $user->id]);
    $inventory = SkuInventory::query()->create([
        'sku_id' => $sku->id, 'location_id' => $location->id, 'quantity' => $onHand, 'reserved' => 0, 'user_id' => $user->id,
    ]);

    $order = InventoryOrder::query()->create([
        'platform_order_id' => '404-'.uniqid(), 'channel_id' => $channel->id, 'status' => 'shipped',
        'order_date' => now()->subMonth(), 'total_amount' => 500,
    ]);
    $order->update(['user_id' => $user->id]);
    InventoryOrderItem::query()->create([
        'inventory_order_id' => $order->id, 'sku_id' => $sku->id, 'sku_code' => $sku->sku, 'product_name' => 'Massage Bed',
        'quantity' => 1, 'unit_price' => 500, 'total_price' => 500, 'user_id' => $user->id,
    ]);

    return [$user, $order, $sku, $location, $inventory];
}

function sheetReturn(User $user, InventoryOrder $order, Sku $sku, string $line): InventoryReturn
{
    return InventoryReturn::query()->create([
        'inventory_order_id' => $order->id, 'sku_code' => $sku->sku, 'platform_return_id' => "STL-1-{$order->platform_order_id}-{$line}",
        'external_status' => 'refund_from_payment_sheet', 'status' => 'approved', 'return_status' => 'refunded',
        'inventory_status' => 'on_hold', 'disposition' => 'sellable', 'return_quantity' => 1, 'refund_amount' => 500,
        'return_date' => now()->subDays(5), 'user_id' => $user->id,
    ]);
}

it('never restocks more units than the order sold', function () {
    [$user, $order, $sku, , $inventory] = excessReturnFixture();

    // A payment sheet carries several refund lines for one returned unit (principal, shipping, COD).
    $principal = sheetReturn($user, $order, $sku, 'principal');
    $shipping = sheetReturn($user, $order, $sku, 'shipping');
    $cod = sheetReturn($user, $order, $sku, 'cod');

    expect($principal->processReturn())->toBeTrue()
        ->and($shipping->processReturn())->toBeFalse()
        ->and($cod->processReturn())->toBeFalse();

    expect((float) $inventory->fresh()->quantity)->toBe(1.0)
        ->and($shipping->fresh()->status)->toBe('void')
        ->and($shipping->fresh()->metadata['void_reason'])->toBe('exceeds_sold_quantity')
        ->and(InventoryReturn::restockedUnitsForOrder($order->id))->toBe(1);
});

it('reverses historical excess restock with a compensating OUT, keeps the first return, and is re-runnable', function () {
    [$user, $order, $sku, $location, $inventory] = excessReturnFixture(onHand: 3);

    // History before the guard: three returns each put one unit back for a 1-unit order.
    $returns = collect(['principal', 'shipping', 'cod'])->map(function ($line, $i) use ($user, $order, $sku, $location) {
        $r = sheetReturn($user, $order, $sku, $line);
        $r->update(['status' => 'completed', 'inventory_status' => 'restocked']);
        InventoryTransaction::forceCreate([
            'user_id' => $user->id, 'sku_id' => $sku->id, 'location_id' => $location->id, 'type' => 'IN', 'quantity' => 1,
            'reference_type' => 'Return', 'reference_id' => (string) $r->id, 'created_at' => now()->subDays(10 - $i),
        ]);

        return $r;
    });

    $service = app(ReturnExcessRestockCorrectionService::class);
    $rows = $service->findExcess($user->id);
    expect($rows->sum('excess'))->toBe(2)
        ->and($rows->pluck('return_id')->all())->toBe([$returns[1]->id, $returns[2]->id]);

    $result = $service->apply($user->id, $rows);

    expect($result)->toBe(['reversed_units' => 2, 'voided_returns' => 2, 'unreversible_units' => 0])
        ->and((float) $inventory->fresh()->quantity)->toBe(1.0)
        ->and($returns[0]->fresh()->status)->toBe('completed')
        ->and($returns[1]->fresh()->status)->toBe('void')
        // Original IN rows are kept; the correction is a separate OUT.
        ->and(InventoryTransaction::query()->where('reference_type', 'Return')->count())->toBe(3)
        ->and(InventoryTransaction::query()->where('reference_type', InventoryReturn::EXCESS_RESTOCK_REVERSAL)->sum('quantity'))->toEqual(2)
        ->and($service->findExcess($user->id))->toHaveCount(0);
});

it('never takes a balance below zero when the phantom units were already consumed', function () {
    [$user, $order, $sku, $location, $inventory] = excessReturnFixture(onHand: 0);

    foreach (['principal', 'shipping'] as $i => $line) {
        $r = sheetReturn($user, $order, $sku, $line);
        InventoryTransaction::forceCreate([
            'user_id' => $user->id, 'sku_id' => $sku->id, 'location_id' => $location->id, 'type' => 'IN', 'quantity' => 1,
            'reference_type' => 'Return', 'reference_id' => (string) $r->id, 'created_at' => now()->subDays(10 - $i),
        ]);
    }

    $service = app(ReturnExcessRestockCorrectionService::class);
    $result = $service->apply($user->id, $service->findExcess($user->id));

    expect($result['reversed_units'])->toBe(0)
        ->and($result['unreversible_units'])->toBe(1)
        ->and((float) $inventory->fresh()->quantity)->toBe(0.0);
});
