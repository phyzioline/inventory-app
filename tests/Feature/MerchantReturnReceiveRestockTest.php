<?php

uses(Tests\TestCase::class, Illuminate\Foundation\Testing\RefreshDatabase::class);

use App\Models\User;
use App\Application\Services\ChannelStockResolver;
use App\Application\Services\InventoryReturnMutationService;
use App\Domain\Models\Wms\Channel;
use App\Domain\Models\Wms\InventoryLocation;
use App\Domain\Models\Wms\InventoryOffer;
use App\Domain\Models\Wms\InventoryOrder;
use App\Domain\Models\Wms\InventoryOrderItem;
use App\Domain\Models\Wms\InventoryReturn;
use App\Domain\Models\Wms\MasterProduct;
use App\Domain\Models\Wms\Sku;
use App\Domain\Models\Wms\SkuInventory;

describe('Merchant return receive restocks main store', function () {
    function seedMerchantReturnFixture(User $user): array
    {
        $storeChannel = Channel::query()->create([
            'name' => 'Phyzioline Main Store',
            'slug' => 'main-store-'.uniqid(),
            'type' => 'store',
            'is_active' => true,
        ]);
        $storeChannel->update(['user_id' => $user->id]);

        $merchantChannel = Channel::query()->create([
            'name' => 'Amazon Merchant Test',
            'slug' => 'amazon-merchant-'.uniqid(),
            'type' => 'merchant_fbm',
            'is_active' => true,
        ]);
        $merchantChannel->update(['user_id' => $user->id]);

        $storeLocation = InventoryLocation::query()->create([
            'name' => 'Shop Floor',
            'type' => 'store',
            'channel_id' => $storeChannel->id,
            'is_active' => true,
        ]);
        $storeLocation->update(['user_id' => $user->id]);

        $master = MasterProduct::query()->create([
            'internal_name' => 'Return Restock Product',
            'is_active' => true,
        ]);
        $master->update(['user_id' => $user->id]);

        $offer = InventoryOffer::query()->create([
            'master_product_id' => $master->id,
            'name' => 'Single',
            'type' => 'single',
        ]);
        $offer->update(['user_id' => $user->id]);

        $storeSku = Sku::query()->create([
            'offer_id' => $offer->id,
            'sku' => 'STORE-RET-'.uniqid(),
            'channel_id' => $storeChannel->id,
            'cost_price' => 0,
            'selling_price' => 0,
            'is_active' => true,
        ]);
        $storeSku->update(['user_id' => $user->id]);

        $merchantSku = Sku::query()->create([
            'offer_id' => $offer->id,
            'sku' => 'MERCH-RET-'.uniqid(),
            'channel_id' => $merchantChannel->id,
            'cost_price' => 0,
            'selling_price' => 0,
            'is_active' => true,
        ]);
        $merchantSku->update(['user_id' => $user->id]);

        SkuInventory::query()->create([
            'sku_id' => $storeSku->id,
            'location_id' => $storeLocation->id,
            'quantity' => 8,
            'reserved' => 0,
            'user_id' => $user->id,
        ]);

        $order = InventoryOrder::query()->create([
            'platform_order_id' => 'AMZ-'.uniqid(),
            'channel_id' => $merchantChannel->id,
            'status' => 'shipped',
            'order_date' => now(),
            'total_amount' => 100,
            'shipping_amount' => 10,
        ]);
        $order->update(['user_id' => $user->id]);

        InventoryOrderItem::query()->create([
            'inventory_order_id' => $order->id,
            'sku_id' => $merchantSku->id,
            'sku_code' => $merchantSku->sku,
            'product_name' => 'Test Product',
            'quantity' => 2,
            'unit_price' => 50,
            'total_price' => 100,
            'user_id' => $user->id,
        ]);

        $return = InventoryReturn::query()->create([
            'inventory_order_id' => $order->id,
            'platform_return_id' => 'RET-'.uniqid(),
            'status' => 'pending',
            'return_status' => 'return_requested',
            'inventory_status' => 'on_hold',
            'reason' => 'Customer return',
            'disposition' => 'sellable',
            'return_quantity' => 2,
            'user_id' => $user->id,
        ]);

        expect(ChannelStockResolver::deductsFromMainStoreBucket((int) $merchantChannel->id))->toBeTrue();

        return compact(
            'storeSku',
            'storeLocation',
            'return',
            'merchantChannel',
        );
    }

    it('POST receive increments main store sku_inventory for merchant sellable returns', function () {
        $user = User::factory()->create();
        $this->actingAs($user);

        $fixture = seedMerchantReturnFixture($user);

        $response = $this->postJson('/api/inventory/returns/'.$fixture['return']->id.'/receive');

        $response->assertOk();

        $fixture['return']->refresh();
        expect($fixture['return']->return_status)->toBe('restocked')
            ->and($fixture['return']->status)->toBe('completed');

        $stock = SkuInventory::query()
            ->where('sku_id', $fixture['storeSku']->id)
            ->where('location_id', $fixture['storeLocation']->id)
            ->first();

        expect($stock)->not->toBeNull()
            ->and((int) $stock->quantity)->toBe(10);
    });

    it('receive service does not auto-restock FBA sellable returns', function () {
        $user = User::factory()->create();
        $this->actingAs($user);

        $fbaChannel = Channel::query()->create([
            'name' => 'Amazon FBA Test',
            'slug' => 'amazon-fba-'.uniqid(),
            'type' => 'fba',
            'is_active' => true,
        ]);
        $fbaChannel->update(['user_id' => $user->id]);

        $location = InventoryLocation::query()->create([
            'name' => 'FBA FC',
            'type' => 'fba',
            'channel_id' => $fbaChannel->id,
            'is_active' => true,
        ]);
        $location->update(['user_id' => $user->id]);

        $master = MasterProduct::query()->create([
            'internal_name' => 'FBA Return Product',
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
            'sku' => 'FBA-RET-'.uniqid(),
            'channel_id' => $fbaChannel->id,
            'cost_price' => 0,
            'selling_price' => 0,
            'is_active' => true,
        ]);
        $sku->update(['user_id' => $user->id]);

        SkuInventory::query()->create([
            'sku_id' => $sku->id,
            'location_id' => $location->id,
            'quantity' => 5,
            'reserved' => 0,
            'user_id' => $user->id,
        ]);

        $order = InventoryOrder::query()->create([
            'platform_order_id' => 'FBA-'.uniqid(),
            'channel_id' => $fbaChannel->id,
            'status' => 'shipped',
            'order_date' => now(),
            'total_amount' => 50,
        ]);
        $order->update(['user_id' => $user->id]);

        InventoryOrderItem::query()->create([
            'inventory_order_id' => $order->id,
            'sku_id' => $sku->id,
            'sku_code' => $sku->sku,
            'product_name' => 'FBA Test Product',
            'quantity' => 1,
            'unit_price' => 50,
            'total_price' => 50,
            'user_id' => $user->id,
        ]);

        $return = InventoryReturn::query()->create([
            'inventory_order_id' => $order->id,
            'status' => 'pending',
            'return_status' => 'return_requested',
            'inventory_status' => 'on_hold',
            'reason' => 'FBA return',
            'disposition' => 'sellable',
            'return_quantity' => 1,
            'user_id' => $user->id,
        ]);

        $beforeQty = (int) (SkuInventory::query()
            ->where('sku_id', $sku->id)
            ->where('location_id', $location->id)
            ->value('quantity') ?? 0);

        app(InventoryReturnMutationService::class)->receive((int) $return->id);

        $return->refresh();
        expect($return->return_status)->toBe('arrived_to_warehouse')
            ->and($return->status)->toBe('approved');

        $afterQty = (int) (SkuInventory::query()
            ->where('sku_id', $sku->id)
            ->where('location_id', $location->id)
            ->value('quantity') ?? 0);

        expect($afterQty)->toBe($beforeQty);
    });
});
