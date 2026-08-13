<?php

use App\Models\User;
use App\Application\Services\ChannelStockResolver;
use App\Application\Services\ProductCompositionService;
use App\Domain\Models\Wms\Channel;
use App\Domain\Models\Wms\InventoryLocation;
use App\Domain\Models\Wms\InventoryOffer;
use App\Domain\Models\Wms\InventoryTransaction;
use App\Domain\Models\Wms\MasterProduct;
use App\Domain\Models\Wms\ProductComposition;
use App\Domain\Models\Wms\Sku;
use App\Domain\Models\Wms\SkuInventory;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

describe('Product composition linking + manual unpack/pack', function () {
    beforeEach(function () {
        ChannelStockResolver::clearCache();
    });

    function seedCompositionFixture(User $user): array
    {
        $storeChannel = Channel::query()->create([
            'name' => 'المحل',
            'slug' => 'store-'.uniqid(),
            'type' => 'store',
            'is_active' => true,
        ]);
        $storeChannel->update(['user_id' => $user->id]);

        $storeLoc = InventoryLocation::query()->create([
            'name' => 'Shop',
            'type' => 'store',
            'channel_id' => $storeChannel->id,
            'is_active' => true,
        ]);
        $storeLoc->update(['user_id' => $user->id]);

        $master = MasterProduct::query()->create([
            'internal_name' => 'Dumbbell',
            'is_active' => true,
        ]);
        $master->update(['user_id' => $user->id]);

        $singleOffer = InventoryOffer::query()->create([
            'master_product_id' => $master->id,
            'name' => 'Single',
            'type' => 'single',
        ]);
        $singleOffer->update(['user_id' => $user->id]);

        $cartonOffer = InventoryOffer::query()->create([
            'master_product_id' => $master->id,
            'name' => 'Carton x3',
            'type' => 'bundle',
        ]);
        $cartonOffer->update(['user_id' => $user->id]);

        $singleSku = Sku::query()->create([
            'offer_id' => $singleOffer->id,
            'sku' => 'SINGLE-'.uniqid(),
            'channel_id' => $storeChannel->id,
            'cost_price' => 0,
            'selling_price' => 0,
            'is_active' => true,
        ]);
        $singleSku->update(['user_id' => $user->id]);

        $cartonSku = Sku::query()->create([
            'offer_id' => $cartonOffer->id,
            'sku' => 'CARTON-'.uniqid(),
            'channel_id' => $storeChannel->id,
            'cost_price' => 0,
            'selling_price' => 0,
            'is_active' => true,
        ]);
        $cartonSku->update(['user_id' => $user->id]);

        return compact('storeChannel', 'storeLoc', 'master', 'singleOffer', 'cartonOffer', 'singleSku', 'cartonSku');
    }

    function setStock(Sku $sku, InventoryLocation $loc, User $user, int $qty): SkuInventory
    {
        return SkuInventory::query()->create([
            'sku_id' => $sku->id,
            'location_id' => $loc->id,
            'quantity' => $qty,
            'reserved' => 0,
            'user_id' => $user->id,
        ]);
    }

    // ── Attach guards ───────────────────────────────────────────────

    it('attaches a component link with a ratio', function () {
        $user = User::factory()->create();
        $this->actingAs($user);
        $fx = seedCompositionFixture($user);

        $response = $this->postJson('/api/inventory/inventory-offers/'.$fx['cartonOffer']->id.'/components', [
            'component_offer_id' => $fx['singleOffer']->id,
            'quantity_per' => 3,
        ]);

        $response->assertStatus(201);
        expect((int) $response->json('quantity_per'))->toBe(3)
            ->and((int) $response->json('parent_offer_id'))->toBe((int) $fx['cartonOffer']->id)
            ->and((int) $response->json('component_offer_id'))->toBe((int) $fx['singleOffer']->id);

        expect(ProductComposition::query()
            ->where('parent_offer_id', $fx['cartonOffer']->id)
            ->where('component_offer_id', $fx['singleOffer']->id)
            ->exists())->toBeTrue();
    });

    it('rejects self-reference', function () {
        $user = User::factory()->create();
        $this->actingAs($user);
        $fx = seedCompositionFixture($user);

        $response = $this->postJson('/api/inventory/inventory-offers/'.$fx['cartonOffer']->id.'/components', [
            'component_offer_id' => $fx['cartonOffer']->id,
            'quantity_per' => 2,
        ]);

        $response->assertStatus(422);
        expect((string) json_encode($response->json('errors'), JSON_UNESCAPED_UNICODE))->toContain('لا يمكن ربط عرض بنفسه');
    });

    it('rejects a duplicate link', function () {
        $user = User::factory()->create();
        $this->actingAs($user);
        $fx = seedCompositionFixture($user);

        app(ProductCompositionService::class)->attachComponent($fx['cartonOffer'], $fx['singleOffer'], 3);

        $response = $this->postJson('/api/inventory/inventory-offers/'.$fx['cartonOffer']->id.'/components', [
            'component_offer_id' => $fx['singleOffer']->id,
            'quantity_per' => 3,
        ]);

        $response->assertStatus(422);
        expect((string) json_encode($response->json('errors'), JSON_UNESCAPED_UNICODE))->toContain('موجود بالفعل');
    });

    it('rejects nesting: a component that already has its own components', function () {
        $user = User::factory()->create();
        $this->actingAs($user);
        $fx = seedCompositionFixture($user);

        $boxOffer = InventoryOffer::query()->create([
            'master_product_id' => $fx['master']->id,
            'name' => 'Box x2 Cartons',
            'type' => 'bundle',
        ]);
        $boxOffer->update(['user_id' => $user->id]);

        // Carton already has its own component (Single).
        app(ProductCompositionService::class)->attachComponent($fx['cartonOffer'], $fx['singleOffer'], 3);

        expect(fn () => app(ProductCompositionService::class)->attachComponent($boxOffer, $fx['cartonOffer'], 2))
            ->toThrow(ValidationException::class);
    });

    it('rejects nesting: a parent that is already used as someone elses component', function () {
        $user = User::factory()->create();
        $this->actingAs($user);
        $fx = seedCompositionFixture($user);

        $looseUnitOffer = InventoryOffer::query()->create([
            'master_product_id' => $fx['master']->id,
            'name' => 'Loose Unit',
            'type' => 'single',
        ]);
        $looseUnitOffer->update(['user_id' => $user->id]);

        // Single is already used as a component of Carton.
        app(ProductCompositionService::class)->attachComponent($fx['cartonOffer'], $fx['singleOffer'], 3);

        // Now trying to make Single itself a parent/kit should be rejected.
        expect(fn () => app(ProductCompositionService::class)->attachComponent($fx['singleOffer'], $looseUnitOffer, 2))
            ->toThrow(ValidationException::class);
    });

    it('rejects quantity_per less than 1', function () {
        $user = User::factory()->create();
        $this->actingAs($user);
        $fx = seedCompositionFixture($user);

        $response = $this->postJson('/api/inventory/inventory-offers/'.$fx['cartonOffer']->id.'/components', [
            'component_offer_id' => $fx['singleOffer']->id,
            'quantity_per' => 0,
        ]);

        $response->assertStatus(422);
    });

    it('rejects linking an offer belonging to another tenant', function () {
        $user = User::factory()->create();
        $otherUser = User::factory()->create();
        $this->actingAs($user);
        $fx = seedCompositionFixture($user);

        $this->actingAs($otherUser);
        $otherFx = seedCompositionFixture($otherUser);

        $this->actingAs($user);
        $response = $this->postJson('/api/inventory/inventory-offers/'.$fx['cartonOffer']->id.'/components', [
            'component_offer_id' => $otherFx['singleOffer']->id,
            'quantity_per' => 3,
        ]);

        $response->assertStatus(404);
    });

    // ── Unpack ───────────────────────────────────────────────────────

    it('unpacks stock from the parent SKU into the component SKU with a ledger trail', function () {
        $user = User::factory()->create();
        $this->actingAs($user);
        $fx = seedCompositionFixture($user);
        app(ProductCompositionService::class)->attachComponent($fx['cartonOffer'], $fx['singleOffer'], 3);

        setStock($fx['cartonSku'], $fx['storeLoc'], $user, 10);
        setStock($fx['singleSku'], $fx['storeLoc'], $user, 5);

        $response = $this->postJson('/api/inventory/inventory-offers/'.$fx['cartonOffer']->id.'/unpack', [
            'component_offer_id' => $fx['singleOffer']->id,
            'parent_sku_id' => $fx['cartonSku']->id,
            'parent_location_id' => $fx['storeLoc']->id,
            'component_sku_id' => $fx['singleSku']->id,
            'component_location_id' => $fx['storeLoc']->id,
            'quantity' => 2,
        ]);

        $response->assertOk();
        expect((int) $response->json('unpacked'))->toBe(2)
            ->and((int) $response->json('produced'))->toBe(6);

        $cartonQty = (int) SkuInventory::query()->where('sku_id', $fx['cartonSku']->id)->where('location_id', $fx['storeLoc']->id)->value('quantity');
        $singleQty = (int) SkuInventory::query()->where('sku_id', $fx['singleSku']->id)->where('location_id', $fx['storeLoc']->id)->value('quantity');
        expect($cartonQty)->toBe(8)->and($singleQty)->toBe(11);

        $outTx = InventoryTransaction::query()->where('sku_id', $fx['cartonSku']->id)->where('type', 'TRANSFER')->where('quantity', 2)->first();
        $inTx = InventoryTransaction::query()->where('sku_id', $fx['singleSku']->id)->where('type', 'IN')->where('quantity', 6)->first();
        expect($outTx)->not->toBeNull()
            ->and($inTx)->not->toBeNull()
            ->and((string) $outTx->reference_id)->toBe((string) $inTx->id)
            ->and((string) $inTx->reference_id)->toBe((string) $outTx->id)
            ->and((int) $outTx->user_id)->toBe((int) $user->id);
    });

    it('rejects unpack when parent stock is insufficient and mutates nothing', function () {
        $user = User::factory()->create();
        $this->actingAs($user);
        $fx = seedCompositionFixture($user);
        app(ProductCompositionService::class)->attachComponent($fx['cartonOffer'], $fx['singleOffer'], 3);

        setStock($fx['cartonSku'], $fx['storeLoc'], $user, 1);
        setStock($fx['singleSku'], $fx['storeLoc'], $user, 5);

        $response = $this->postJson('/api/inventory/inventory-offers/'.$fx['cartonOffer']->id.'/unpack', [
            'component_offer_id' => $fx['singleOffer']->id,
            'parent_sku_id' => $fx['cartonSku']->id,
            'parent_location_id' => $fx['storeLoc']->id,
            'component_sku_id' => $fx['singleSku']->id,
            'component_location_id' => $fx['storeLoc']->id,
            'quantity' => 5,
        ]);

        $response->assertStatus(422);

        $cartonQty = (int) SkuInventory::query()->where('sku_id', $fx['cartonSku']->id)->where('location_id', $fx['storeLoc']->id)->value('quantity');
        $singleQty = (int) SkuInventory::query()->where('sku_id', $fx['singleSku']->id)->where('location_id', $fx['storeLoc']->id)->value('quantity');
        expect($cartonQty)->toBe(1)->and($singleQty)->toBe(5);
        expect(InventoryTransaction::query()->where('sku_id', $fx['cartonSku']->id)->where('type', 'TRANSFER')->exists())->toBeFalse();
    });

    it('does not double-apply an unpack retried with the same client_operation_id', function () {
        $user = User::factory()->create();
        $this->actingAs($user);
        $fx = seedCompositionFixture($user);
        app(ProductCompositionService::class)->attachComponent($fx['cartonOffer'], $fx['singleOffer'], 3);

        setStock($fx['cartonSku'], $fx['storeLoc'], $user, 10);
        setStock($fx['singleSku'], $fx['storeLoc'], $user, 0);

        $payload = [
            'component_offer_id' => $fx['singleOffer']->id,
            'parent_sku_id' => $fx['cartonSku']->id,
            'parent_location_id' => $fx['storeLoc']->id,
            'component_sku_id' => $fx['singleSku']->id,
            'component_location_id' => $fx['storeLoc']->id,
            'quantity' => 2,
            'client_operation_id' => 'test-op-123',
        ];

        $first = $this->postJson('/api/inventory/inventory-offers/'.$fx['cartonOffer']->id.'/unpack', $payload);
        $second = $this->postJson('/api/inventory/inventory-offers/'.$fx['cartonOffer']->id.'/unpack', $payload);

        $first->assertOk();
        $second->assertOk();
        expect($second->json('idempotent'))->toBeTrue();

        $cartonQty = (int) SkuInventory::query()->where('sku_id', $fx['cartonSku']->id)->where('location_id', $fx['storeLoc']->id)->value('quantity');
        $singleQty = (int) SkuInventory::query()->where('sku_id', $fx['singleSku']->id)->where('location_id', $fx['storeLoc']->id)->value('quantity');
        expect($cartonQty)->toBe(8)->and($singleQty)->toBe(6);
    });

    // ── Pack ─────────────────────────────────────────────────────────

    it('packs an exact multiple of component stock back into parent units', function () {
        $user = User::factory()->create();
        $this->actingAs($user);
        $fx = seedCompositionFixture($user);
        app(ProductCompositionService::class)->attachComponent($fx['cartonOffer'], $fx['singleOffer'], 3);

        setStock($fx['cartonSku'], $fx['storeLoc'], $user, 0);
        setStock($fx['singleSku'], $fx['storeLoc'], $user, 10);

        $response = $this->postJson('/api/inventory/inventory-offers/'.$fx['cartonOffer']->id.'/pack', [
            'component_offer_id' => $fx['singleOffer']->id,
            'parent_sku_id' => $fx['cartonSku']->id,
            'parent_location_id' => $fx['storeLoc']->id,
            'component_sku_id' => $fx['singleSku']->id,
            'component_location_id' => $fx['storeLoc']->id,
            'quantity' => 9,
        ]);

        $response->assertOk();
        expect((int) $response->json('packed'))->toBe(9)
            ->and((int) $response->json('produced'))->toBe(3);

        $cartonQty = (int) SkuInventory::query()->where('sku_id', $fx['cartonSku']->id)->where('location_id', $fx['storeLoc']->id)->value('quantity');
        $singleQty = (int) SkuInventory::query()->where('sku_id', $fx['singleSku']->id)->where('location_id', $fx['storeLoc']->id)->value('quantity');
        expect($cartonQty)->toBe(3)->and($singleQty)->toBe(1);
    });

    it('rejects pack quantities that are not an exact multiple of the ratio', function () {
        $user = User::factory()->create();
        $this->actingAs($user);
        $fx = seedCompositionFixture($user);
        app(ProductCompositionService::class)->attachComponent($fx['cartonOffer'], $fx['singleOffer'], 3);

        setStock($fx['cartonSku'], $fx['storeLoc'], $user, 0);
        setStock($fx['singleSku'], $fx['storeLoc'], $user, 10);

        $response = $this->postJson('/api/inventory/inventory-offers/'.$fx['cartonOffer']->id.'/pack', [
            'component_offer_id' => $fx['singleOffer']->id,
            'parent_sku_id' => $fx['cartonSku']->id,
            'parent_location_id' => $fx['storeLoc']->id,
            'component_sku_id' => $fx['singleSku']->id,
            'component_location_id' => $fx['storeLoc']->id,
            'quantity' => 8,
        ]);

        $response->assertStatus(422);
        expect((string) json_encode($response->json('errors'), JSON_UNESCAPED_UNICODE))->toContain('مضاعفات');

        $singleQty = (int) SkuInventory::query()->where('sku_id', $fx['singleSku']->id)->where('location_id', $fx['storeLoc']->id)->value('quantity');
        expect($singleQty)->toBe(10);
    });

    it('rejects pack when component stock is insufficient', function () {
        $user = User::factory()->create();
        $this->actingAs($user);
        $fx = seedCompositionFixture($user);
        app(ProductCompositionService::class)->attachComponent($fx['cartonOffer'], $fx['singleOffer'], 3);

        setStock($fx['cartonSku'], $fx['storeLoc'], $user, 0);
        setStock($fx['singleSku'], $fx['storeLoc'], $user, 2);

        $response = $this->postJson('/api/inventory/inventory-offers/'.$fx['cartonOffer']->id.'/pack', [
            'component_offer_id' => $fx['singleOffer']->id,
            'parent_sku_id' => $fx['cartonSku']->id,
            'parent_location_id' => $fx['storeLoc']->id,
            'component_sku_id' => $fx['singleSku']->id,
            'component_location_id' => $fx['storeLoc']->id,
            'quantity' => 3,
        ]);

        $response->assertStatus(422);
    });

    // ── Routes ───────────────────────────────────────────────────────

    it('lists components and used-in compositions for an offer', function () {
        $user = User::factory()->create();
        $this->actingAs($user);
        $fx = seedCompositionFixture($user);
        app(ProductCompositionService::class)->attachComponent($fx['cartonOffer'], $fx['singleOffer'], 3);

        $cartonView = $this->getJson('/api/inventory/inventory-offers/'.$fx['cartonOffer']->id.'/components');
        $cartonView->assertOk();
        expect($cartonView->json('components'))->toHaveCount(1)
            ->and($cartonView->json('used_in'))->toHaveCount(0);

        $singleView = $this->getJson('/api/inventory/inventory-offers/'.$fx['singleOffer']->id.'/components');
        $singleView->assertOk();
        expect($singleView->json('components'))->toHaveCount(0)
            ->and($singleView->json('used_in'))->toHaveCount(1);
    });

    it('updates and deletes a composition link', function () {
        $user = User::factory()->create();
        $this->actingAs($user);
        $fx = seedCompositionFixture($user);
        $composition = app(ProductCompositionService::class)->attachComponent($fx['cartonOffer'], $fx['singleOffer'], 3);

        $update = $this->putJson('/api/inventory/product-compositions/'.$composition->id, ['quantity_per' => 4]);
        $update->assertOk();
        expect((int) $update->json('quantity_per'))->toBe(4);

        $delete = $this->deleteJson('/api/inventory/product-compositions/'.$composition->id);
        $delete->assertStatus(204);
        expect(ProductComposition::query()->find($composition->id))->toBeNull();
    });

    it('rejects unauthenticated requests', function () {
        $response = $this->getJson('/api/inventory/inventory-offers/1/components');
        $response->assertStatus(401);
    });

    // ── Regression guard ────────────────────────────────────────────

    it('does not change ordinary stock availability just by linking a composition', function () {
        $user = User::factory()->create();
        $this->actingAs($user);
        $fx = seedCompositionFixture($user);

        setStock($fx['cartonSku'], $fx['storeLoc'], $user, 4);
        setStock($fx['singleSku'], $fx['storeLoc'], $user, 7);

        $before = [
            ChannelStockResolver::availableQuantityForSkuId((int) $fx['cartonSku']->id, (int) $fx['storeChannel']->id),
            ChannelStockResolver::availableQuantityForSkuId((int) $fx['singleSku']->id, (int) $fx['storeChannel']->id),
        ];

        app(ProductCompositionService::class)->attachComponent($fx['cartonOffer'], $fx['singleOffer'], 3);
        ChannelStockResolver::clearCache();

        $after = [
            ChannelStockResolver::availableQuantityForSkuId((int) $fx['cartonSku']->id, (int) $fx['storeChannel']->id),
            ChannelStockResolver::availableQuantityForSkuId((int) $fx['singleSku']->id, (int) $fx['storeChannel']->id),
        ];

        expect($after)->toBe($before);
    });
});
