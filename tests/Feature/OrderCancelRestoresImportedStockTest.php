<?php

use App\Models\User;
use App\Application\Services\ChannelStockResolver;
use App\Domain\Models\Wms\Channel;
use App\Domain\Models\Wms\InventoryLocation;
use App\Domain\Models\Wms\InventoryOffer;
use App\Domain\Models\Wms\InventoryOrder;
use App\Domain\Models\Wms\InventoryOrderItem;
use App\Domain\Models\Wms\InventoryTransaction;
use App\Domain\Models\Wms\MasterProduct;
use App\Domain\Models\Wms\Sku;
use App\Domain\Models\Wms\SkuInventory;

it('cancelling a marketplace-imported order restores ImportedOrder stock deduction', function () {
    ChannelStockResolver::clearCache();

    $user = User::factory()->create();
    $this->actingAs($user);

    $storeChannel = Channel::query()->create([
        'name' => 'المحل',
        'slug' => 'store-'.uniqid(),
        'type' => 'pos',
        'is_active' => true,
        'user_id' => $user->id,
    ]);

    $merchantChannel = Channel::query()->create([
        'name' => 'Amazon Merchant',
        'slug' => 'merchant-'.uniqid(),
        'type' => 'amazon_merchant',
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
        'internal_name' => 'Cancel Restock Product',
        'is_active' => true,
        'user_id' => $user->id,
    ]);
    $offer = InventoryOffer::query()->create([
        'master_product_id' => $master->id,
        'name' => 'Single',
        'type' => 'single',
        'user_id' => $user->id,
    ]);

    $storeSku = Sku::query()->create([
        'offer_id' => $offer->id,
        'sku' => 'SHOP-CANCEL-'.uniqid(),
        'channel_id' => $storeChannel->id,
        'cost_price' => 0,
        'selling_price' => 0,
        'is_active' => true,
        'user_id' => $user->id,
    ]);

    $listingSku = Sku::query()->create([
        'offer_id' => $offer->id,
        'sku' => 'LIST-CANCEL-'.uniqid(),
        'channel_id' => $merchantChannel->id,
        'cost_price' => 0,
        'selling_price' => 100,
        'is_active' => true,
        'user_id' => $user->id,
    ]);

    SkuInventory::query()->create([
        'sku_id' => $storeSku->id,
        'location_id' => $shopFloor->id,
        'quantity' => 4,
        'reserved' => 0,
        'user_id' => $user->id,
    ]);

    $order = InventoryOrder::query()->create([
        'user_id' => $user->id,
        'channel_id' => $merchantChannel->id,
        'platform_order_id' => '407-TEST-'.uniqid(),
        'order_date' => now(),
        'status' => 'pending',
        'financial_status' => 'unpaid',
        'total_amount' => 100,
    ]);

    InventoryOrderItem::query()->create([
        'user_id' => $user->id,
        'inventory_order_id' => $order->id,
        'sku_id' => $listingSku->id,
        'sku_code' => $listingSku->sku,
        'product_name' => 'Cancel Restock Line',
        'quantity' => 1,
        'unit_price' => 100,
        'total_price' => 100,
        'stock_deduction_status' => 'deducted',
    ]);

    // Marketplace import deducted from shop SKU (not listing SKU).
    InventoryTransaction::query()->create([
        'sku_id' => $storeSku->id,
        'location_id' => $shopFloor->id,
        'type' => 'OUT',
        'quantity' => 1,
        'reference_type' => 'ImportedOrder',
        'reference_id' => (string) $order->id,
        'user_id' => $user->id,
        'notes' => 'Marketplace order import (main store fallback)',
    ]);
    SkuInventory::query()
        ->where('sku_id', $storeSku->id)
        ->where('location_id', $shopFloor->id)
        ->update(['quantity' => 3]);

    $this->postJson('/api/inventory/orders/'.$order->id.'/cancel')
        ->assertOk()
        ->assertJsonPath('order.status', 'cancelled');

    $stock = (float) SkuInventory::query()
        ->where('sku_id', $storeSku->id)
        ->where('location_id', $shopFloor->id)
        ->value('quantity');

    expect($stock)->toBe(4.0);

    $rollback = InventoryTransaction::query()
        ->where('reference_type', 'OrderCancelRollback')
        ->where('reference_id', (string) $order->id)
        ->where('type', 'IN')
        ->first();

    expect($rollback)->not->toBeNull()
        ->and((float) $rollback->quantity)->toBe(1.0)
        ->and((int) $rollback->sku_id)->toBe((int) $storeSku->id);

    // Second cancel is idempotent — stock stays restored.
    $this->postJson('/api/inventory/orders/'.$order->id.'/cancel')->assertOk();

    $stockAgain = (float) SkuInventory::query()
        ->where('sku_id', $storeSku->id)
        ->where('location_id', $shopFloor->id)
        ->value('quantity');

    expect($stockAgain)->toBe(4.0)
        ->and(
            InventoryTransaction::query()
                ->where('reference_type', 'OrderCancelRollback')
                ->where('reference_id', (string) $order->id)
                ->where('type', 'IN')
                ->count()
        )->toBe(1);
});
