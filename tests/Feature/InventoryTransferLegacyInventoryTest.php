<?php

uses(Tests\TestCase::class, Illuminate\Foundation\Testing\RefreshDatabase::class);

use Illuminate\Support\Facades\DB;
use App\Models\User;
use App\Domain\Models\Wms\Channel;
use App\Domain\Models\Wms\InventoryLocation;
use App\Domain\Models\Wms\InventoryOffer;
use App\Domain\Models\Wms\MasterProduct;
use App\Domain\Models\Wms\Sku;
use App\Domain\Models\Wms\SkuInventory;

describe('Inventory transfer with legacy sku_inventory rows', function () {
    it('merges legacy null user_id inventory at destination during batch transfer', function () {
        $user = User::factory()->create();
        $this->actingAs($user);

        $channel = Channel::query()->create([
            'name' => 'Main Store',
            'slug' => 'legacy-xfer-'.uniqid(),
            'type' => 'store',
            'is_active' => true,
        ]);
        $channel->update(['user_id' => $user->id]);

        $fromLocation = InventoryLocation::query()->create([
            'name' => 'Shop',
            'type' => 'store',
            'channel_id' => $channel->id,
            'is_active' => true,
        ]);
        $fromLocation->update(['user_id' => $user->id]);

        $toLocation = InventoryLocation::query()->create([
            'name' => 'FBA',
            'type' => 'fba',
            'channel_id' => $channel->id,
            'is_active' => true,
        ]);
        $toLocation->update(['user_id' => $user->id]);

        $master = MasterProduct::query()->create([
            'internal_name' => 'Legacy Transfer Product',
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
            'sku' => 'LEGACY-XFER-001',
            'channel_id' => $channel->id,
            'cost_price' => 0,
            'selling_price' => 0,
            'is_active' => true,
        ]);
        $sku->update(['user_id' => $user->id]);

        SkuInventory::query()->create([
            'sku_id' => $sku->id,
            'location_id' => $fromLocation->id,
            'quantity' => 10,
            'reserved' => 0,
            'user_id' => $user->id,
        ]);

        // Legacy destination row (user_id NULL) — inserted like old imports (bypasses Eloquent creating hook).
        DB::table('sku_inventory')->insert([
            'sku_id' => $sku->id,
            'location_id' => $toLocation->id,
            'quantity' => 2,
            'reserved' => 0,
            'user_id' => null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->postJson('/api/inventory/transactions/transfer-batch', [
            'from_location_id' => $fromLocation->id,
            'to_location_id' => $toLocation->id,
            'items' => [
                ['sku_id' => $sku->id, 'quantity' => 4],
            ],
        ]);

        $response->assertCreated();

        $dest = SkuInventory::query()
            ->where('sku_id', $sku->id)
            ->where('location_id', $toLocation->id)
            ->first();

        expect($dest)->not->toBeNull()
            ->and((int) $dest->user_id)->toBe((int) $user->id)
            ->and((int) $dest->quantity)->toBe(6);

        expect(
            SkuInventory::withoutGlobalScope('user_isolation')
                ->where('sku_id', $sku->id)
                ->where('location_id', $toLocation->id)
                ->count()
        )->toBe(1);
    });

    it('merges legacy row when user row already exists at destination', function () {
        $user = User::factory()->create();
        $this->actingAs($user);

        $channel = Channel::query()->create([
            'name' => 'Dup Store',
            'slug' => 'dup-xfer-'.uniqid(),
            'type' => 'store',
            'is_active' => true,
        ]);
        $channel->update(['user_id' => $user->id]);

        $fromLocation = InventoryLocation::query()->create([
            'name' => 'Shop',
            'type' => 'store',
            'channel_id' => $channel->id,
            'is_active' => true,
        ]);
        $fromLocation->update(['user_id' => $user->id]);

        $toLocation = InventoryLocation::query()->create([
            'name' => 'FBA',
            'type' => 'fba',
            'channel_id' => $channel->id,
            'is_active' => true,
        ]);
        $toLocation->update(['user_id' => $user->id]);

        $master = MasterProduct::query()->create([
            'internal_name' => 'Dup Rows Product',
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
            'sku' => 'DUP-XFER-001',
            'channel_id' => $channel->id,
            'cost_price' => 0,
            'selling_price' => 0,
            'is_active' => true,
        ]);
        $sku->update(['user_id' => $user->id]);

        SkuInventory::query()->create([
            'sku_id' => $sku->id,
            'location_id' => $fromLocation->id,
            'quantity' => 8,
            'reserved' => 0,
            'user_id' => $user->id,
        ]);

        SkuInventory::query()->create([
            'sku_id' => $sku->id,
            'location_id' => $toLocation->id,
            'quantity' => 1,
            'reserved' => 0,
            'user_id' => $user->id,
        ]);

        DB::table('sku_inventory')->insert([
            'sku_id' => $sku->id,
            'location_id' => $toLocation->id,
            'quantity' => 3,
            'reserved' => 0,
            'user_id' => null,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $response = $this->postJson('/api/inventory/transactions/transfer-batch', [
            'from_location_id' => $fromLocation->id,
            'to_location_id' => $toLocation->id,
            'items' => [
                ['sku_id' => $sku->id, 'quantity' => 2],
            ],
        ]);

        $response->assertCreated();

        $dest = SkuInventory::query()
            ->where('sku_id', $sku->id)
            ->where('location_id', $toLocation->id)
            ->first();

        expect((int) $dest->quantity)->toBe(6);

        expect(
            SkuInventory::withoutGlobalScope('user_isolation')
                ->where('sku_id', $sku->id)
                ->where('location_id', $toLocation->id)
                ->count()
        )->toBe(1);
    });
});
