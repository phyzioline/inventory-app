<?php

use App\Application\Services\ChannelStockResolver;
use App\Domain\Models\Wms\Channel;
use App\Domain\Models\Wms\InventoryLocation;
use App\Domain\Models\Wms\InventoryOffer;
use App\Domain\Models\Wms\InventoryOrder;
use App\Domain\Models\Wms\InventoryTransaction;
use App\Domain\Models\Wms\MasterProduct;
use App\Domain\Models\Wms\Quotation;
use App\Domain\Models\Wms\QuotationItem;
use App\Domain\Models\Wms\Sku;
use App\Domain\Models\Wms\SkuInventory;
use App\Models\User;

function seedQuotationConvertFixture(int $stockQty, float $discount = 0.0): array
{
    ChannelStockResolver::clearCache();

    $user = User::factory()->create();
    test()->actingAs($user);

    $storeChannel = Channel::query()->create([
        'name' => 'المحل',
        'slug' => 'store-qtn-'.uniqid(),
        'type' => 'pos',
        'is_active' => true,
        'user_id' => $user->id,
    ]);

    $shopFloor = InventoryLocation::query()->create([
        'name' => 'المحل',
        'type' => 'physical',
        'is_active' => true,
        'user_id' => $user->id,
        'channel_id' => $storeChannel->id,
    ]);

    $master = MasterProduct::query()->create([
        'internal_name' => 'Quotation Convert Product',
        'is_active' => true,
        'user_id' => $user->id,
    ]);
    $offer = InventoryOffer::query()->create([
        'master_product_id' => $master->id,
        'name' => 'Single',
        'type' => 'single',
        'user_id' => $user->id,
    ]);

    $sku = Sku::query()->create([
        'offer_id' => $offer->id,
        'sku' => 'QTN-SKU-'.uniqid(),
        'channel_id' => $storeChannel->id,
        'cost_price' => 10,
        'selling_price' => 100,
        'is_active' => true,
        'user_id' => $user->id,
        'name' => 'Quotation Convert Product',
    ]);

    $inventory = new SkuInventory([
        'sku_id' => $sku->id,
        'location_id' => $shopFloor->id,
        'quantity' => $stockQty,
        'reserved' => 0,
    ]);
    $inventory->user_id = $user->id;
    $inventory->save();

    $lineTotal = 200.0;
    $total = max(0.0, $lineTotal - $discount);

    $quotation = Quotation::query()->create([
        'reference_number' => 'QTN-TEST'.strtoupper(substr(uniqid(), -6)),
        'user_id' => $user->id,
        'customer_name' => 'Walk-in Test',
        'quotation_date' => now()->toDateString(),
        'total_amount' => $total,
        'tax_amount' => 0,
        'discount_amount' => $discount,
        'status' => 'draft',
    ]);

    QuotationItem::query()->create([
        'quotation_id' => $quotation->id,
        'sku_id' => $sku->id,
        'quantity' => 2,
        'unit_price' => 100,
        'total' => $lineTotal,
    ]);

    return compact('user', 'storeChannel', 'shopFloor', 'sku', 'quotation');
}

it('converts a quotation when stock is sufficient and deducts inventory', function () {
    $fx = seedQuotationConvertFixture(5, 25.0);

    $response = $this->postJson('/api/inventory/quotations/'.$fx['quotation']->id.'/convert', [
        // Client must not be able to force a marketplace channel.
        'channel_id' => 999999,
    ]);

    $response->assertOk()
        ->assertJsonPath('order.discount_amount', '25.00')
        ->assertJsonPath('order.total_amount', '175.00')
        ->assertJsonPath('order.channel_id', $fx['storeChannel']->id);

    $fx['quotation']->refresh();
    expect($fx['quotation']->status)->toBe('converted');

    $orderId = (int) $response->json('order.id');
    expect($orderId)->toBeGreaterThan(0);

    $stock = (float) SkuInventory::query()
        ->where('sku_id', $fx['sku']->id)
        ->where('location_id', $fx['shopFloor']->id)
        ->value('quantity');
    expect($stock)->toBe(3.0);

    $out = InventoryTransaction::query()
        ->where('reference_type', 'Order')
        ->where('reference_id', (string) $orderId)
        ->where('type', 'OUT')
        ->first();

    expect($out)->not->toBeNull()
        ->and((float) $out->quantity)->toBe(2.0)
        ->and((int) $out->sku_id)->toBe((int) $fx['sku']->id)
        ->and((int) $out->location_id)->toBe((int) $fx['shopFloor']->id);
});

it('does not convert using Amazon warehouse stock — only المحل', function () {
    ChannelStockResolver::clearCache();
    $user = User::factory()->create();
    test()->actingAs($user);

    $storeChannel = Channel::query()->create([
        'name' => 'المحل',
        'slug' => 'store-only-'.uniqid(),
        'type' => 'pos',
        'is_active' => true,
        'user_id' => $user->id,
    ]);
    $amazonChannel = Channel::query()->create([
        'name' => 'Amazon EG',
        'slug' => 'amazon-'.uniqid(),
        'type' => 'amazon_fba',
        'is_active' => true,
        'user_id' => $user->id,
    ]);

    $shopFloor = InventoryLocation::query()->create([
        'name' => 'المحل',
        'type' => 'physical',
        'is_active' => true,
        'user_id' => $user->id,
        'channel_id' => $storeChannel->id,
    ]);
    $amazonFloor = InventoryLocation::query()->create([
        'name' => 'Amazon FBA Warehouse',
        'type' => 'physical',
        'is_active' => true,
        'user_id' => $user->id,
        'channel_id' => $amazonChannel->id,
    ]);

    $master = MasterProduct::query()->create([
        'internal_name' => 'Store Only Product',
        'is_active' => true,
        'user_id' => $user->id,
    ]);
    $offer = InventoryOffer::query()->create([
        'master_product_id' => $master->id,
        'name' => 'Single',
        'type' => 'single',
        'user_id' => $user->id,
    ]);
    $sku = Sku::query()->create([
        'offer_id' => $offer->id,
        'sku' => 'SHOP-ONLY-'.uniqid(),
        'channel_id' => $storeChannel->id,
        'cost_price' => 1,
        'selling_price' => 50,
        'is_active' => true,
        'user_id' => $user->id,
        'name' => 'Store Only Product',
    ]);

    // Stock exists only in Amazon — must NOT fulfill a quotation.
    $amazonInv = new SkuInventory([
        'sku_id' => $sku->id,
        'location_id' => $amazonFloor->id,
        'quantity' => 10,
        'reserved' => 0,
    ]);
    $amazonInv->user_id = $user->id;
    $amazonInv->save();

    $shopInv = new SkuInventory([
        'sku_id' => $sku->id,
        'location_id' => $shopFloor->id,
        'quantity' => 0,
        'reserved' => 0,
    ]);
    $shopInv->user_id = $user->id;
    $shopInv->save();

    $quotation = Quotation::query()->create([
        'reference_number' => 'QTN-AMZ'.strtoupper(substr(uniqid(), -5)),
        'user_id' => $user->id,
        'customer_name' => 'Walk-in',
        'quotation_date' => now()->toDateString(),
        'total_amount' => 50,
        'tax_amount' => 0,
        'discount_amount' => 0,
        'status' => 'draft',
    ]);
    QuotationItem::query()->create([
        'quotation_id' => $quotation->id,
        'sku_id' => $sku->id,
        'quantity' => 1,
        'unit_price' => 50,
        'total' => 50,
    ]);

    $response = $this->postJson('/api/inventory/quotations/'.$quotation->id.'/convert');
    $response->assertStatus(422)->assertJsonPath('code', 'insufficient_stock');

    $quotation->refresh();
    expect($quotation->status)->toBe('draft');
    expect((float) SkuInventory::query()->whereKey($amazonInv->id)->value('quantity'))->toBe(10.0);
});

it('blocks quotation conversion when stock is insufficient', function () {
    $fx = seedQuotationConvertFixture(1);

    $response = $this->postJson('/api/inventory/quotations/'.$fx['quotation']->id.'/convert');

    $response->assertStatus(422)
        ->assertJsonPath('code', 'insufficient_stock');

    expect($response->json('insufficient'))->toBeArray()->not->toBeEmpty();

    $fx['quotation']->refresh();
    expect($fx['quotation']->status)->toBe('draft');

    expect(
        InventoryOrder::query()
            ->where('platform_order_id', 'QT-'.$fx['quotation']->reference_number)
            ->exists()
    )->toBeFalse();

    $stock = (float) SkuInventory::query()
        ->where('sku_id', $fx['sku']->id)
        ->where('location_id', $fx['shopFloor']->id)
        ->value('quantity');
    expect($stock)->toBe(1.0);
});

it('persists discount_amount into total_amount on store', function () {
    ChannelStockResolver::clearCache();
    $user = User::factory()->create();
    $this->actingAs($user);

    $storeChannel = Channel::query()->create([
        'name' => 'المحل',
        'slug' => 'store-disc-'.uniqid(),
        'type' => 'pos',
        'is_active' => true,
        'user_id' => $user->id,
    ]);

    $master = MasterProduct::query()->create([
        'internal_name' => 'Discount Quote Product',
        'is_active' => true,
        'user_id' => $user->id,
    ]);
    $offer = InventoryOffer::query()->create([
        'master_product_id' => $master->id,
        'name' => 'Single',
        'type' => 'single',
        'user_id' => $user->id,
    ]);
    $sku = Sku::query()->create([
        'offer_id' => $offer->id,
        'sku' => 'DISC-SKU-'.uniqid(),
        'channel_id' => $storeChannel->id,
        'cost_price' => 0,
        'selling_price' => 50,
        'is_active' => true,
        'user_id' => $user->id,
    ]);

    $response = $this->postJson('/api/inventory/quotations', [
        'customer_name' => 'Discount Customer',
        'quotation_date' => now()->toDateString(),
        'discount_amount' => 30,
        'tax_amount' => 0,
        'items' => [
            [
                'sku_id' => $sku->id,
                'quantity' => 2,
                'unit_price' => 100,
            ],
        ],
    ]);

    $response->assertCreated()
        ->assertJsonPath('discount_amount', '30.00')
        ->assertJsonPath('total_amount', '170.00');
});
