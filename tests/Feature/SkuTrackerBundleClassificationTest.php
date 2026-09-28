<?php

use App\Application\Services\ProductCompositionService;
use App\Models\User;
use App\Domain\Models\Wms\Channel;
use App\Domain\Models\Wms\InventoryLocation;
use App\Domain\Models\Wms\InventoryOffer;
use App\Domain\Models\Wms\MasterProduct;
use App\Domain\Models\Wms\ProductComposition;
use App\Domain\Models\Wms\Sku;
use App\Domain\Models\Wms\SkuInventory;

describe('SKU tracker classifies kit pack/unpack conversions as directional, not "other"', function () {
    it('marks the component-out leg as outbound (bundle_out) and the kit-in leg as inbound (bundle_in), keeping the running balance non-negative', function () {
        $user = User::factory()->create();
        $this->actingAs($user);

        $channel = Channel::query()->create([
            'name' => 'المحل',
            'slug' => 'store-'.uniqid(),
            'type' => 'marketplace',
            'is_active' => true,
        ]);
        $channel->update(['user_id' => $user->id]);

        $location = InventoryLocation::query()->create([
            'name' => 'Main Store',
            'type' => 'store',
            'channel_id' => $channel->id,
            'is_active' => true,
        ]);
        $location->update(['user_id' => $user->id]);

        $componentMaster = MasterProduct::query()->create(['internal_name' => 'Component Product', 'is_active' => true]);
        $componentMaster->update(['user_id' => $user->id]);
        $kitMaster = MasterProduct::query()->create(['internal_name' => 'Kit Product', 'is_active' => true]);
        $kitMaster->update(['user_id' => $user->id]);

        $componentOffer = InventoryOffer::query()->create(['master_product_id' => $componentMaster->id, 'name' => 'Single', 'type' => 'single']);
        $componentOffer->update(['user_id' => $user->id]);
        $kitOffer = InventoryOffer::query()->create(['master_product_id' => $kitMaster->id, 'name' => 'Kit', 'type' => 'single']);
        $kitOffer->update(['user_id' => $user->id]);

        $componentSku = Sku::query()->create([
            'offer_id' => $componentOffer->id,
            'sku' => 'COMPONENT-'.uniqid(),
            'channel_id' => $channel->id,
            'cost_price' => 0,
            'selling_price' => 0,
            'is_active' => true,
        ]);
        $componentSku->update(['user_id' => $user->id]);

        $kitSku = Sku::query()->create([
            'offer_id' => $kitOffer->id,
            'sku' => 'KIT-'.uniqid(),
            'channel_id' => $channel->id,
            'cost_price' => 0,
            'selling_price' => 0,
            'is_active' => true,
        ]);
        $kitSku->update(['user_id' => $user->id]);

        SkuInventory::query()->create(['sku_id' => $componentSku->id, 'location_id' => $location->id, 'quantity' => 100, 'reserved' => 0, 'user_id' => $user->id]);
        SkuInventory::query()->create(['sku_id' => $kitSku->id, 'location_id' => $location->id, 'quantity' => 0, 'reserved' => 0, 'user_id' => $user->id]);

        $composition = ProductComposition::query()->create([
            'parent_offer_id' => $kitOffer->id,
            'component_offer_id' => $componentOffer->id,
            'quantity_per' => 2,
        ]);
        $composition->update(['user_id' => $user->id]);

        app(ProductCompositionService::class)->pack(
            $kitOffer, $componentOffer,
            $componentSku, $location->id,
            $kitSku, $location->id,
            20,
        );

        $response = $this->getJson('/api/inventory/transactions/sku-tracker?sku_id='.$componentSku->id);
        $response->assertOk();

        $movements = collect($response->json('movements'));
        $componentOut = $movements->firstWhere('reference_type', 'bundle_pack_out');

        expect($componentOut)->not->toBeNull()
            ->and($componentOut['movement_kind'])->toBe('bundle_out')
            ->and($componentOut['movement_kind'])->not->toBe('other');

        $kitResponse = $this->getJson('/api/inventory/transactions/sku-tracker?sku_id='.$kitSku->id);
        $kitMovements = collect($kitResponse->json('movements'));
        $kitIn = $kitMovements->firstWhere('reference_type', 'bundle_pack_in');

        expect($kitIn)->not->toBeNull()
            ->and($kitIn['movement_kind'])->toBe('bundle_in');

        expect((int) SkuInventory::where('sku_id', $componentSku->id)->value('quantity'))->toBe(80)
            ->and((int) SkuInventory::where('sku_id', $kitSku->id)->value('quantity'))->toBe(10);
    });
});
