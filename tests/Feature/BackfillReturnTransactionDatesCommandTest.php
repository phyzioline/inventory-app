<?php

use App\Models\User;
use App\Domain\Models\Wms\Channel;
use App\Domain\Models\Wms\InventoryLocation;
use App\Domain\Models\Wms\InventoryOffer;
use App\Domain\Models\Wms\InventoryOrder;
use App\Domain\Models\Wms\InventoryReturn;
use App\Domain\Models\Wms\InventoryTransaction;
use App\Domain\Models\Wms\MasterProduct;
use App\Domain\Models\Wms\Sku;

it('backfills historical return transaction dates from inventory_returns.return_date', function () {
    $user = User::factory()->create();

    $channel = Channel::query()->create([
        'name' => 'Amazon FBA Backfill Test',
        'slug' => 'amazon-fba-backfill-'.uniqid(),
        'type' => 'fba',
        'is_active' => true,
    ]);
    $channel->update(['user_id' => $user->id]);

    $location = InventoryLocation::query()->create([
        'name' => 'FBA FC Backfill',
        'type' => 'fba',
        'channel_id' => $channel->id,
        'is_active' => true,
    ]);
    $location->update(['user_id' => $user->id]);

    $master = MasterProduct::query()->create(['internal_name' => 'Backfill Product', 'is_active' => true]);
    $master->update(['user_id' => $user->id]);

    $offer = InventoryOffer::query()->create(['master_product_id' => $master->id, 'name' => 'Single', 'type' => 'single']);
    $offer->update(['user_id' => $user->id]);

    $sku = Sku::query()->create([
        'offer_id' => $offer->id,
        'sku' => 'FBA-BACKFILL-'.uniqid(),
        'channel_id' => $channel->id,
        'cost_price' => 0,
        'selling_price' => 0,
        'is_active' => true,
    ]);
    $sku->update(['user_id' => $user->id]);

    $order = InventoryOrder::query()->create([
        'platform_order_id' => 'FBA-BACKFILL-'.uniqid(),
        'channel_id' => $channel->id,
        'status' => 'shipped',
        'order_date' => now(),
        'total_amount' => 50,
    ]);
    $order->update(['user_id' => $user->id]);

    $realReturnDate = now()->subDays(20)->startOfDay()->addHours(14);

    $return = InventoryReturn::query()->create([
        'inventory_order_id' => $order->id,
        'sku_code' => $sku->sku,
        'status' => 'completed',
        'return_status' => 'restocked',
        'inventory_status' => 'restocked',
        'disposition' => 'sellable',
        'return_quantity' => 1,
        'return_date' => $realReturnDate,
        'user_id' => $user->id,
    ]);

    // Simulate the historical bug: transaction created "now" instead of at return_date.
    $wrongDate = now();
    $tx = InventoryTransaction::query()->create([
        'sku_id' => $sku->id,
        'location_id' => $location->id,
        'type' => 'IN',
        'quantity' => 1,
        'reference_type' => 'Return',
        'reference_id' => $return->id,
        'notes' => 'Sellable return processed',
        'user_id' => $user->id,
    ]);
    $tx->created_at = $wrongDate;
    $tx->updated_at = $wrongDate;
    $tx->save();

    // Dry-run must not modify anything.
    $this->artisan('inventory:backfill-return-transaction-dates --dry-run')
        ->assertExitCode(0);

    $tx->refresh();
    expect($tx->created_at->diffInSeconds($wrongDate))->toBeLessThan(2);

    // Live run applies the fix.
    $this->artisan('inventory:backfill-return-transaction-dates')
        ->assertExitCode(0);

    $tx->refresh();
    expect($tx->created_at->diffInSeconds($realReturnDate))->toBeLessThan(2);
});
