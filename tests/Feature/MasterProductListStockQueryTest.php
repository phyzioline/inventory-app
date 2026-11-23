<?php

use App\Domain\Models\Wms\Channel;
use App\Domain\Models\Wms\InventoryLocation;
use App\Domain\Models\Wms\InventoryOffer;
use App\Domain\Models\Wms\MasterProduct;
use App\Domain\Models\Wms\Sku;
use App\Domain\Models\Wms\SkuInventory;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * GET /master-products?paginate=1 priced every stockless SKU with 1–3 extra queries
 * (~10k queries per catalog load with 3,500 stockless SKUs), which held all 8 fpm
 * workers (2026-11-23). Stock must stay correct and the query count must not grow
 * with the number of SKUs.
 */
function seedListProducts(User $user, Channel $channel, InventoryLocation $location, int $count, bool $stockFirst = true): array
{
    $stocked = null;
    for ($i = 0; $i < $count; $i++) {
        $master = MasterProduct::query()->create(['internal_name' => "List P{$i}", 'is_active' => true, 'user_id' => $user->id]);
        $offer = InventoryOffer::query()->create(['master_product_id' => $master->id, 'name' => 'O', 'type' => 'single', 'user_id' => $user->id]);
        $sku = Sku::query()->create([
            'offer_id' => $offer->id, 'sku' => 'LIST-'.$i.'-'.uniqid(), 'channel_id' => $channel->id,
            'cost_price' => 10, 'selling_price' => 20, 'is_active' => true, 'user_id' => $user->id,
        ]);
        if ($stockFirst && $i === 0) {
            SkuInventory::query()->create(['sku_id' => $sku->id, 'location_id' => $location->id, 'quantity' => 7, 'reserved' => 0, 'user_id' => $user->id]);
            $stocked = $master;
        }
    }

    return ['stocked' => $stocked];
}

function countListQueries(int $perPage): int
{
    DB::flushQueryLog();
    DB::enableQueryLog();
    test()->getJson('/api/inventory/master-products?paginate=1&per_page='.$perPage)->assertOk();
    $n = count(DB::getQueryLog());
    DB::disableQueryLog();

    return $n;
}

it('prices the catalog list with a query count independent of stockless SKUs', function () {
    $user = User::factory()->create();
    $this->actingAs($user);
    $channel = Channel::query()->create(['name' => 'Store', 'slug' => 'store-'.uniqid(), 'type' => 'store', 'is_active' => true, 'user_id' => $user->id]);
    $location = InventoryLocation::query()->create(['name' => 'Store WH', 'type' => 'warehouse', 'is_active' => true, 'channel_id' => $channel->id, 'user_id' => $user->id]);

    $seed = seedListProducts($user, $channel, $location, 3);
    countListQueries(60); // warm-up: first page load runs one-off orphan adoption
    $small = countListQueries(60);

    seedListProducts($user, $channel, $location, 20, false);
    $large = countListQueries(60);

    expect($large)->toBe($small);

    $rows = collect($this->getJson('/api/inventory/master-products?paginate=1&per_page=60')->json('data'));
    $stocked = $rows->firstWhere('id', $seed['stocked']->id);
    expect((float) $stocked['total_stock'])->toBe(7.0)
        ->and($rows->where('id', '!=', $seed['stocked']->id)->every(fn ($r) => (float) $r['total_stock'] === 0.0))->toBeTrue();
});
