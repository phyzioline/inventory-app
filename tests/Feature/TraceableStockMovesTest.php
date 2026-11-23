<?php

use App\Application\Services\StockRehomeTransferService;
use App\Domain\Models\Wms\Channel;
use App\Domain\Models\Wms\InventoryLocation;
use App\Domain\Models\Wms\InventoryOffer;
use App\Domain\Models\Wms\InventoryTransaction;
use App\Domain\Models\Wms\MasterProduct;
use App\Domain\Models\Wms\Sku;
use App\Domain\Models\Wms\SkuInventory;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Every balance change must leave a movements-ledger row. SKU linking and warehouse deletion
 * used to move / clear sku_inventory silently, so ledger and balances drifted apart
 * (2026-11-23 audit). After each move, ledger sum == balance for every (sku, location).
 */
function traceFixture(User $user): array
{
    $channel = Channel::query()->create(['name' => 'Store T', 'slug' => 'store-t-'.uniqid(), 'type' => 'store', 'is_active' => true, 'user_id' => $user->id]);
    $loc = InventoryLocation::query()->create(['name' => 'Shop WH', 'type' => 'warehouse', 'is_active' => true, 'user_id' => $user->id]);
    $master = MasterProduct::query()->create(['internal_name' => 'Trace P', 'is_active' => true, 'user_id' => $user->id]);
    $offer = InventoryOffer::query()->create(['master_product_id' => $master->id, 'name' => 'O', 'type' => 'single', 'user_id' => $user->id]);
    $mk = fn (string $code) => Sku::query()->create(['offer_id' => $offer->id, 'sku' => $code.'-'.uniqid(), 'channel_id' => $channel->id, 'cost_price' => 10, 'selling_price' => 20, 'is_active' => true, 'user_id' => $user->id]);

    return ['loc' => $loc, 'from' => $mk('LIST'), 'to' => $mk('STORE')];
}

function seedBalance(Sku $sku, InventoryLocation $loc, int $qty): SkuInventory
{
    // Opening balance enters through the ledger too, so the reconciliation starts balanced.
    InventoryTransaction::create(['sku_id' => $sku->id, 'location_id' => $loc->id, 'type' => $qty >= 0 ? 'IN' : 'OUT', 'quantity' => abs($qty), 'reference_type' => 'Seed']);

    return SkuInventory::query()->create(['sku_id' => $sku->id, 'location_id' => $loc->id, 'quantity' => $qty, 'reserved' => 0, 'user_id' => $sku->user_id]);
}

function ledgerGaps(array $skuIds): array
{
    $ledger = InventoryTransaction::query()->whereIn('sku_id', $skuIds)
        ->selectRaw("sku_id, location_id, SUM(CASE WHEN type = 'IN' THEN quantity ELSE -quantity END) AS q")
        ->groupBy('sku_id', 'location_id')->get()
        ->mapWithKeys(fn ($r) => [$r->sku_id.':'.$r->location_id => (int) $r->q]);
    $balance = SkuInventory::query()->whereIn('sku_id', $skuIds)
        ->selectRaw('sku_id, location_id, SUM(quantity) AS q')->groupBy('sku_id', 'location_id')->get()
        ->mapWithKeys(fn ($r) => [$r->sku_id.':'.$r->location_id => (int) $r->q]);

    $gaps = [];
    foreach ($ledger->keys()->merge($balance->keys())->unique() as $k) {
        if (($ledger[$k] ?? 0) !== ($balance[$k] ?? 0)) {
            $gaps[$k] = ['ledger' => $ledger[$k] ?? 0, 'balance' => $balance[$k] ?? 0];
        }
    }

    return $gaps;
}

it('moves a positive listing balance onto the store SKU with a ledger pair', function () {
    $user = User::factory()->create();
    $this->actingAs($user);
    $fx = traceFixture($user);
    $row = seedBalance($fx['from'], $fx['loc'], 5);
    seedBalance($fx['to'], $fx['loc'], 2);

    $moved = DB::transaction(fn () => app(StockRehomeTransferService::class)->mergeInventoryRowIntoSku($row, $fx['to'], 'link test'));

    expect($moved)->toBe(5)
        ->and(SkuInventory::query()->where('sku_id', $fx['from']->id)->exists())->toBeFalse()
        ->and((int) SkuInventory::query()->where('sku_id', $fx['to']->id)->value('quantity'))->toBe(7)
        ->and(ledgerGaps([$fx['from']->id, $fx['to']->id]))->toBe([]);
});

it('absorbs a negative listing balance into the store SKU with a ledger pair', function () {
    $user = User::factory()->create();
    $this->actingAs($user);
    $fx = traceFixture($user);
    $row = seedBalance($fx['from'], $fx['loc'], -3);
    seedBalance($fx['to'], $fx['loc'], 10);

    $moved = DB::transaction(fn () => app(StockRehomeTransferService::class)->mergeInventoryRowIntoSku($row, $fx['to'], 'link test'));

    expect($moved)->toBe(-3)
        ->and(SkuInventory::query()->where('sku_id', $fx['from']->id)->exists())->toBeFalse()
        ->and((int) SkuInventory::query()->where('sku_id', $fx['to']->id)->value('quantity'))->toBe(7)
        ->and(ledgerGaps([$fx['from']->id, $fx['to']->id]))->toBe([]);
});

it('writes cleared stock to the ledger and archives a warehouse that has history', function () {
    $user = User::factory()->create();
    $this->actingAs($user);
    $fx = traceFixture($user);
    seedBalance($fx['from'], $fx['loc'], 4);
    seedBalance($fx['to'], $fx['loc'], -1);

    $this->deleteJson('/api/inventory/warehouses/'.$fx['loc']->id.'?clear_stock=1')->assertOk()->assertJsonPath('archived', true);
    expect(InventoryLocation::query()->find($fx['loc']->id)?->is_active)->toBeFalse();

    $cleared = InventoryTransaction::query()->where('reference_type', 'LocationClear')->orderBy('sku_id')->get(['sku_id', 'type', 'quantity']);
    expect($cleared->map(fn ($t) => [$t->sku_id, $t->type, $t->quantity])->all())
        ->toEqualCanonicalizing([[$fx['from']->id, 'OUT', 4], [$fx['to']->id, 'IN', 1]])
        ->and(ledgerGaps([$fx['from']->id, $fx['to']->id]))->toBe([]);
});

it('still hard-deletes an empty warehouse with no history', function () {
    $user = User::factory()->create();
    $this->actingAs($user);
    $loc = InventoryLocation::query()->create(['name' => 'Empty WH', 'type' => 'warehouse', 'is_active' => true, 'user_id' => $user->id]);

    $this->deleteJson('/api/inventory/warehouses/'.$loc->id)->assertNoContent();
    expect(InventoryLocation::query()->find($loc->id))->toBeNull();
});
