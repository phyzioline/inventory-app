<?php

use App\Models\User;
use App\Domain\Models\Wms\Channel;
use App\Domain\Models\Wms\InventoryLocation;
use App\Domain\Models\Wms\InventoryOffer;
use App\Domain\Models\Wms\MasterProduct;
use App\Domain\Models\Wms\Sku;
use App\Domain\Models\Wms\SkuInventory;

describe('Inventory API pagination (Phase B)', function () {
    it('returns paginated sku payload when paginate=1', function () {
        $user = User::factory()->create();
        $this->actingAs($user);

        $channel = Channel::query()->create([
            'name' => 'Store',
            'slug' => 'store-'.uniqid(),
            'type' => 'store',
            'is_active' => true,
        ]);
        $channel->update(['user_id' => $user->id]);

        $master = MasterProduct::query()->create([
            'internal_name' => 'Paged SKU Product',
            'is_active' => true,
        ]);
        $master->update(['user_id' => $user->id]);

        $offer = InventoryOffer::query()->create([
            'master_product_id' => $master->id,
            'name' => 'Offer',
            'type' => 'single',
        ]);
        $offer->update(['user_id' => $user->id]);

        Sku::query()->create([
            'offer_id' => $offer->id,
            'sku' => 'PAGE-SKU-001',
            'channel_id' => $channel->id,
            'cost_price' => 0,
            'selling_price' => 0,
            'is_active' => true,
        ])->update(['user_id' => $user->id]);

        $response = $this->getJson('/api/inventory/skus?paginate=1&per_page=10&channel_id='.$channel->id);

        $response->assertOk()
            ->assertJsonStructure([
                'data',
                'current_page',
                'last_page',
                'per_page',
                'total',
            ]);
    });

    it('orders channel skus by stock across pages when sort_by=stock', function () {
        $user = User::factory()->create();
        $this->actingAs($user);

        $channel = Channel::query()->create([
            'name' => 'Art FBA',
            'slug' => 'art-fba-'.uniqid(),
            'type' => 'amazon_fba',
            'is_active' => true,
        ]);
        $channel->update(['user_id' => $user->id]);

        $location = InventoryLocation::query()->create([
            'name' => 'FBA Warehouse',
            'type' => 'Warehouse',
            'channel_id' => $channel->id,
            'is_active' => true,
        ]);
        $location->update(['user_id' => $user->id]);

        $makeSku = function (string $code, float $qty) use ($user, $channel, $location) {
            $master = MasterProduct::query()->create([
                'internal_name' => 'Product '.$code,
                'is_active' => true,
            ]);
            $master->update(['user_id' => $user->id]);

            $offer = InventoryOffer::query()->create([
                'master_product_id' => $master->id,
                'name' => 'Offer '.$code,
                'type' => 'single',
            ]);
            $offer->update(['user_id' => $user->id]);

            $sku = Sku::query()->create([
                'offer_id' => $offer->id,
                'sku' => $code,
                'channel_id' => $channel->id,
                'cost_price' => 1,
                'selling_price' => 10,
                'is_active' => true,
            ]);
            $sku->update(['user_id' => $user->id]);

            SkuInventory::query()->create([
                'sku_id' => $sku->id,
                'location_id' => $location->id,
                'quantity' => $qty,
                'reserved' => 0,
                'user_id' => $user->id,
            ]);

            return $sku;
        };

        // Low stock created first so default id order would put it on page 1 without stock sort.
        $low = $makeSku('SORT-LOW-'.uniqid(), 2);
        $mid = $makeSku('SORT-MID-'.uniqid(), 20);
        $high = $makeSku('SORT-HIGH-'.uniqid(), 50);

        $page1 = $this->getJson(
            '/api/inventory/skus?paginate=1&per_page=2&page=1'
            .'&channel_id='.$channel->id
            .'&sort_by=stock&sort_dir=desc'
        );
        $page1->assertOk();
        $page1Skus = collect($page1->json('data'))->pluck('sku')->all();
        expect($page1Skus)->toBe([$high->sku, $mid->sku]);
        expect((float) $page1->json('data.0.display_quantity'))->toBe(50.0);
        expect((float) $page1->json('data.1.display_quantity'))->toBe(20.0);

        $page2 = $this->getJson(
            '/api/inventory/skus?paginate=1&per_page=2&page=2'
            .'&channel_id='.$channel->id
            .'&sort_by=stock&sort_dir=desc'
        );
        $page2->assertOk();
        expect(collect($page2->json('data'))->pluck('sku')->all())->toBe([$low->sku]);
        expect((float) $page2->json('data.0.display_quantity'))->toBe(2.0);

        $asc = $this->getJson(
            '/api/inventory/skus?paginate=1&per_page=3&page=1'
            .'&channel_id='.$channel->id
            .'&sort_by=stock&sort_dir=asc'
        );
        $asc->assertOk();
        expect(collect($asc->json('data'))->pluck('sku')->all())->toBe([$low->sku, $mid->sku, $high->sku]);
    });
});
