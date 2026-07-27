<?php

use App\Models\User;
use App\Domain\Models\Wms\Channel;
use App\Domain\Models\Wms\InventoryOffer;
use App\Domain\Models\Wms\MasterProduct;
use App\Domain\Models\Wms\Sku;

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
});
