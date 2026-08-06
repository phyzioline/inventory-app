<?php

use App\Models\User;
use App\Application\Services\ChannelStockResolver;
use App\Application\Services\StockRehomeTransferService;
use App\Domain\Models\Wms\Channel;
use App\Domain\Models\Wms\InventoryLocation;
use App\Domain\Models\Wms\InventoryOffer;
use App\Domain\Models\Wms\InventoryTransaction;
use App\Domain\Models\Wms\MasterProduct;
use App\Domain\Models\Wms\Sku;
use App\Domain\Models\Wms\SkuInventory;
use Illuminate\Support\Facades\DB;

describe('FBA to Merchant stock rehome + phantom merchant ledger', function () {
    beforeEach(function () {
        ChannelStockResolver::clearCache();
    });

    function seedFbaMerchantStoreFixture(User $user): array
    {
        $storeChannel = Channel::query()->create([
            'name' => 'المحل',
            'slug' => 'store-'.uniqid(),
            'type' => 'store',
            'is_active' => true,
        ]);
        $storeChannel->update(['user_id' => $user->id]);

        $fbaChannel = Channel::query()->create([
            'name' => 'Amazon FBA Test',
            'slug' => 'amazon-fba-'.uniqid(),
            'type' => 'amazon_fba',
            'is_active' => true,
        ]);
        $fbaChannel->update(['user_id' => $user->id]);

        $merchantChannel = Channel::query()->create([
            'name' => 'Amazon Merchant Test',
            'slug' => 'amazon-merchant-'.uniqid(),
            'type' => 'amazon_merchant',
            'is_active' => true,
        ]);
        $merchantChannel->update(['user_id' => $user->id]);

        $storeLoc = InventoryLocation::query()->create([
            'name' => 'Shop',
            'type' => 'store',
            'channel_id' => $storeChannel->id,
            'is_active' => true,
        ]);
        $storeLoc->update(['user_id' => $user->id]);

        $fbaLoc = InventoryLocation::query()->create([
            'name' => 'FBA WH',
            'type' => 'amazon_fba',
            'channel_id' => $fbaChannel->id,
            'is_active' => true,
        ]);
        $fbaLoc->update(['user_id' => $user->id]);

        $merchantLoc = InventoryLocation::query()->create([
            'name' => 'Merchant WH',
            'type' => 'channel',
            'channel_id' => $merchantChannel->id,
            'is_active' => true,
        ]);
        $merchantLoc->update(['user_id' => $user->id]);

        $master = MasterProduct::query()->create([
            'internal_name' => 'Rehome Product',
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
            'sku' => 'STORE-REHOME-'.uniqid(),
            'channel_id' => $storeChannel->id,
            'cost_price' => 0,
            'selling_price' => 0,
            'is_active' => true,
        ]);
        $storeSku->update(['user_id' => $user->id]);

        $fbaSku = Sku::query()->create([
            'offer_id' => $offer->id,
            'sku' => 'FBA-REHOME-'.uniqid(),
            'channel_id' => $fbaChannel->id,
            'cost_price' => 0,
            'selling_price' => 0,
            'is_active' => true,
        ]);
        $fbaSku->update(['user_id' => $user->id]);

        return compact(
            'storeChannel',
            'fbaChannel',
            'merchantChannel',
            'storeLoc',
            'fbaLoc',
            'merchantLoc',
            'master',
            'offer',
            'storeSku',
            'fbaSku'
        );
    }

    it('auto-transfers FBA stock to linked store SKU when channel changes to merchant', function () {
        $user = User::factory()->create();
        $this->actingAs($user);
        $fx = seedFbaMerchantStoreFixture($user);

        SkuInventory::query()->create([
            'sku_id' => $fx['fbaSku']->id,
            'location_id' => $fx['fbaLoc']->id,
            'quantity' => 7,
            'reserved' => 0,
            'user_id' => $user->id,
        ]);

        $response = $this->putJson('/api/inventory/skus/'.$fx['fbaSku']->id, [
            'channel_id' => $fx['merchantChannel']->id,
            'sku' => $fx['fbaSku']->sku,
        ]);

        $response->assertOk();
        expect((float) ($response->json('stock_rehome.moved') ?? 0))->toBe(7.0)
            ->and($response->json('stock_rehome.to_store_sku'))->toBe($fx['storeSku']->sku)
            ->and((int) $response->json('channel_id'))->toBe((int) $fx['merchantChannel']->id);

        $fbaLeft = (float) SkuInventory::query()
            ->where('sku_id', $fx['fbaSku']->id)
            ->where('location_id', $fx['fbaLoc']->id)
            ->value('quantity');
        $storeQty = (float) SkuInventory::query()
            ->where('sku_id', $fx['storeSku']->id)
            ->where('location_id', $fx['storeLoc']->id)
            ->value('quantity');

        expect($fbaLeft)->toBe(0.0)->and($storeQty)->toBe(7.0);

        $outTx = InventoryTransaction::query()
            ->where('sku_id', $fx['fbaSku']->id)
            ->where('type', 'TRANSFER')
            ->where('quantity', 7)
            ->first();
        expect($outTx)->not->toBeNull()
            ->and((string) $outTx->reference_type)->toContain('transfer_out:fba2merchant:')
            ->and((int) $outTx->user_id)->toBe((int) $user->id);

        $inTx = InventoryTransaction::query()
            ->where('sku_id', $fx['storeSku']->id)
            ->where('type', 'IN')
            ->where('quantity', 7)
            ->first();
        expect($inTx)->not->toBeNull();
    });

    it('blocks FBA to merchant conversion when stock exists but listing is unlinked', function () {
        $user = User::factory()->create();
        $this->actingAs($user);
        $fx = seedFbaMerchantStoreFixture($user);

        $fx['fbaSku']->update(['offer_id' => null]);

        SkuInventory::query()->create([
            'sku_id' => $fx['fbaSku']->id,
            'location_id' => $fx['fbaLoc']->id,
            'quantity' => 3,
            'reserved' => 0,
            'user_id' => $user->id,
        ]);

        $response = $this->putJson('/api/inventory/skus/'.$fx['fbaSku']->id, [
            'channel_id' => $fx['merchantChannel']->id,
            'sku' => $fx['fbaSku']->sku,
        ]);

        $response->assertStatus(422);
        $blob = (string) ($response->json('message') ?? '').' '.json_encode($response->json('errors') ?? [], JSON_UNESCAPED_UNICODE);
        expect($blob)->toContain('مخزون FBA');

        expect((int) $fx['fbaSku']->fresh()->channel_id)->toBe((int) $fx['fbaChannel']->id);
    });

    it('reconciles phantom merchant stock with transfer ledger into store SKU', function () {
        $user = User::factory()->create();
        $this->actingAs($user);
        $fx = seedFbaMerchantStoreFixture($user);

        $merchantSku = Sku::query()->create([
            'offer_id' => $fx['offer']->id,
            'sku' => 'MERCH-PHANTOM-'.uniqid(),
            'channel_id' => $fx['merchantChannel']->id,
            'cost_price' => 0,
            'selling_price' => 0,
            'is_active' => true,
        ]);
        $merchantSku->update(['user_id' => $user->id]);

        SkuInventory::query()->create([
            'sku_id' => $merchantSku->id,
            'location_id' => $fx['merchantLoc']->id,
            'quantity' => 4,
            'reserved' => 0,
            'user_id' => $user->id,
        ]);

        $moved = 0.0;
        DB::transaction(function () use ($merchantSku, $fx, &$moved) {
            $result = app(StockRehomeTransferService::class)
                ->reconcilePhantomMerchantStockWithLedger($merchantSku->fresh(['offer']), (int) $fx['merchantChannel']->id);
            $moved = (float) ($result['moved'] ?? 0);
        });

        expect($moved)->toBe(4.0);

        $phantomLeft = (float) SkuInventory::query()
            ->where('sku_id', $merchantSku->id)
            ->where('location_id', $fx['merchantLoc']->id)
            ->value('quantity');
        $storeQty = (float) SkuInventory::query()
            ->where('sku_id', $fx['storeSku']->id)
            ->where('location_id', $fx['storeLoc']->id)
            ->value('quantity');

        expect($phantomLeft)->toBe(0.0)->and($storeQty)->toBe(4.0);

        expect(
            InventoryTransaction::query()
                ->where('sku_id', $merchantSku->id)
                ->where('type', 'TRANSFER')
                ->where('quantity', 4)
                ->exists()
        )->toBeTrue();
    });
});
