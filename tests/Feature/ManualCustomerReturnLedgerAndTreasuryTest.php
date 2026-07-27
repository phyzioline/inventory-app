<?php

use App\Models\User;
use App\Domain\Models\Wms\Channel;
use App\Domain\Models\Wms\Customer;
use App\Domain\Models\Wms\InventoryLocation;
use App\Domain\Models\Wms\InventoryOffer;
use App\Domain\Models\Wms\InventoryOrder;
use App\Domain\Models\Wms\InventoryOrderItem;
use App\Domain\Models\Wms\MasterProduct;
use App\Domain\Models\Wms\Payment;
use App\Domain\Models\Wms\Receipt;
use App\Domain\Models\Wms\Sku;
use App\Domain\Models\Wms\SkuInventory;

/**
 * Regression coverage for the manual-return incident: stock restocked but the customer's
 * outstanding balance and treasury were silently left untouched (order SHOP-MRDGI89L).
 */
function seedManualReturnFixture(User $user, float $unitPrice = 150.0): array
{
    $channel = Channel::query()->create([
        'name' => 'Phyzioline Main Store',
        'slug' => 'main-store-'.uniqid(),
        'type' => 'store',
        'is_active' => true,
    ]);
    $channel->update(['user_id' => $user->id]);

    $location = InventoryLocation::query()->create([
        'name' => 'Shop Floor',
        'type' => 'store',
        'channel_id' => $channel->id,
        'is_active' => true,
    ]);
    $location->update(['user_id' => $user->id]);

    $master = MasterProduct::query()->create([
        'internal_name' => 'Manual Return Test Product',
        'is_active' => true,
    ]);
    $master->update(['user_id' => $user->id]);

    $offer = InventoryOffer::query()->create([
        'master_product_id' => $master->id,
        'name' => 'Single',
        'type' => 'single',
    ]);
    $offer->update(['user_id' => $user->id]);

    $sku = Sku::query()->create([
        'offer_id' => $offer->id,
        'sku' => 'PHY-'.uniqid(),
        'channel_id' => $channel->id,
        'cost_price' => 0,
        'selling_price' => $unitPrice,
        'is_active' => true,
    ]);
    $sku->update(['user_id' => $user->id]);

    SkuInventory::query()->create([
        'sku_id' => $sku->id,
        'location_id' => $location->id,
        'quantity' => 0,
        'reserved' => 0,
        'user_id' => $user->id,
    ]);

    $customer = Customer::query()->create([
        'name' => 'د ابو النور',
        'is_active' => true,
    ]);
    $customer->update(['user_id' => $user->id]);

    $order = InventoryOrder::query()->create([
        'platform_order_id' => 'SHOP-'.uniqid(),
        'channel_id' => $channel->id,
        'customer_id' => $customer->id,
        'customer_name' => $customer->name,
        'status' => 'shipped',
        'order_date' => now(),
        'total_amount' => $unitPrice,
        'payment_type' => 'credit',
        'paid_amount' => 0,
        'remaining_amount' => $unitPrice,
    ]);
    $order->update(['user_id' => $user->id]);

    InventoryOrderItem::query()->create([
        'inventory_order_id' => $order->id,
        'sku_id' => $sku->id,
        'sku_code' => $sku->sku,
        'product_name' => 'Manual Return Test Product',
        'quantity' => 1,
        'unit_price' => $unitPrice,
        'total_price' => $unitPrice,
        'user_id' => $user->id,
    ]);

    return compact('channel', 'location', 'sku', 'customer', 'order');
}

it('credits the customer ledger when a manual return leaves refund_amount unset', function () {
    $user = User::factory()->create();
    $this->actingAs($user);

    $fixture = seedManualReturnFixture($user, unitPrice: 150.0);

    $response = $this->postJson('/api/inventory/returns', [
        'inventory_order_id' => $fixture['order']->id,
        'reason' => 'Manual return',
        'disposition' => 'sellable',
        'return_quantity' => 1,
    ]);

    $response->assertCreated();

    $fixture['order']->refresh();
    expect((float) $fixture['order']->remaining_amount)->toBe(0.0);

    $returnRow = \App\Domain\Models\Wms\InventoryReturn::query()
        ->where('inventory_order_id', $fixture['order']->id)
        ->first();
    expect((float) $returnRow->refund_amount)->toBe(150.0)
        ->and($returnRow->refund_method)->toBe('credit_note');

    // credit_note never touches treasury.
    expect(Payment::where('reference_type', \App\Domain\Models\Wms\InventoryReturn::class)
        ->where('reference_id', $returnRow->id)->exists())->toBeFalse();
});

it('creates an outgoing Payment when refund_method is cash and treasury can cover it', function () {
    $user = User::factory()->create();
    $this->actingAs($user);

    Receipt::query()->create([
        'type' => 'customer_collection',
        'amount' => 1000,
        'receipt_date' => now(),
        'user_id' => $user->id,
    ]);

    $fixture = seedManualReturnFixture($user, unitPrice: 150.0);

    $response = $this->postJson('/api/inventory/returns', [
        'inventory_order_id' => $fixture['order']->id,
        'reason' => 'Manual return',
        'disposition' => 'sellable',
        'return_quantity' => 1,
        'refund_amount' => 150,
        'refund_method' => 'cash',
    ]);

    $response->assertCreated();

    $returnRow = \App\Domain\Models\Wms\InventoryReturn::query()
        ->where('inventory_order_id', $fixture['order']->id)
        ->first();

    $payment = Payment::where('reference_type', \App\Domain\Models\Wms\InventoryReturn::class)
        ->where('reference_id', $returnRow->id)
        ->first();

    expect($payment)->not->toBeNull()
        ->and((float) $payment->amount)->toBe(150.0)
        ->and($payment->payee_type)->toBe(Customer::class)
        ->and((int) $payment->payee_id)->toBe($fixture['customer']->id)
        ->and($payment->payment_method)->toBe('cash')
        ->and($payment->status)->toBe('completed');
});

it('still restocks and completes the return when treasury cannot cover a cash refund', function () {
    $user = User::factory()->create();
    $this->actingAs($user);

    // No Receipt seeded — available treasury balance is 0.
    $fixture = seedManualReturnFixture($user, unitPrice: 150.0);

    $response = $this->postJson('/api/inventory/returns', [
        'inventory_order_id' => $fixture['order']->id,
        'reason' => 'Manual return',
        'disposition' => 'sellable',
        'return_quantity' => 1,
        'refund_amount' => 150,
        'refund_method' => 'cash',
    ]);

    $response->assertCreated();

    $stock = SkuInventory::query()
        ->where('sku_id', $fixture['sku']->id)
        ->where('location_id', $fixture['location']->id)
        ->first();
    expect((int) $stock->quantity)->toBe(1);

    $returnRow = \App\Domain\Models\Wms\InventoryReturn::query()
        ->where('inventory_order_id', $fixture['order']->id)
        ->first();
    expect($returnRow->status)->toBe('completed')
        ->and(Payment::where('reference_type', \App\Domain\Models\Wms\InventoryReturn::class)
            ->where('reference_id', $returnRow->id)->exists())->toBeFalse()
        ->and((bool) ($returnRow->metadata['treasury_payment_blocked'] ?? false))->toBeTrue();
});
