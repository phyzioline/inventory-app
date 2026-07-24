<?php

uses(Tests\TestCase::class, Illuminate\Foundation\Testing\RefreshDatabase::class);

use App\Models\User;
use App\Domain\Models\Wms\InventoryOffer;
use App\Domain\Models\Wms\MasterProduct;
use App\Domain\Models\Wms\Sku;

describe('Inventory API phase A fixes', function () {
    it('persists sku platform name on create', function () {
        $user = User::factory()->create();

        $response = $this->actingAs($user)->postJson('/api/inventory/skus', [
            'sku' => 'AUDIT-NAME-001',
            'name' => 'Kinesiology Tape Platform Title',
            'selling_price' => 0,
            'cost_price' => 0,
        ]);

        $response->assertCreated();

        $sku = Sku::query()->where('sku', 'AUDIT-NAME-001')->first();
        expect($sku)->not->toBeNull()
            ->and($sku->name)->toBe('Kinesiology Tape Platform Title');
    });

    it('updates inventory offers with whitelisted fields only', function () {
        $user = User::factory()->create();
        $this->actingAs($user);

        $product = MasterProduct::query()->create([
            'internal_name' => 'Original Product',
            'is_active' => true,
        ]);
        $offer = InventoryOffer::query()->create([
            'master_product_id' => $product->id,
            'name' => 'Store Offer',
            'type' => 'single',
        ]);

        $response = $this->actingAs($user)->putJson("/api/inventory/inventory-offers/{$offer->id}", [
            'name' => 'Renamed Offer',
            'user_id' => 999999,
        ]);

        $response->assertOk();

        $offer->refresh();
        expect($offer->name)->toBe('Renamed Offer')
            ->and((int) $offer->user_id)->toBe((int) $user->id);
    });
});
