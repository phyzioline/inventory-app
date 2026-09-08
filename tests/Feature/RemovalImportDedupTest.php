<?php

use App\Models\User;
use App\Domain\Models\Wms\InventoryRemovalItem;
use App\Domain\Models\Wms\InventoryRemovalOrder;
use Illuminate\Http\UploadedFile;

it('re-importing the same removal CSV updates rows and does not duplicate', function () {
    $user = User::factory()->create();
    $this->actingAs($user);

    $csv = implode("\n", [
        'order-id,sku,disposition,requested-quantity,shipped-quantity,fnsku',
        'RO-DEDUP-1,SKU-DEDUP-A,Sellable,5,5,X001',
        '',
    ]);

    $file1 = UploadedFile::fake()->createWithContent('removal1.csv', $csv);
    $first = $this->post('/api/inventory/removals/import', [
        'file' => $file1,
        'source' => 'amazon',
    ], ['Accept' => 'application/json']);

    $first->assertOk()
        ->assertJsonPath('summary.items_created', 1)
        ->assertJsonPath('summary.orders_created', 1);

    $countAfterFirst = InventoryRemovalItem::query()
        ->where('sku_code', 'SKU-DEDUP-A')
        ->where('user_id', $user->id)
        ->count();

    expect($countAfterFirst)->toBe(1);

    // Mark received so re-import must preserve receipt fields.
    $item = InventoryRemovalItem::query()
        ->where('sku_code', 'SKU-DEDUP-A')
        ->where('user_id', $user->id)
        ->firstOrFail();
    $item->update([
        'receive_status' => 'received',
        'received_quantity' => 2,
        'received_at' => now(),
    ]);

    $csv2 = implode("\n", [
        'order-id,sku,disposition,requested-quantity,shipped-quantity,fnsku',
        'RO-DEDUP-1,SKU-DEDUP-A,Sellable,5,4,X001-UPDATED',
        '',
    ]);
    $file2 = UploadedFile::fake()->createWithContent('removal2.csv', $csv2);
    $second = $this->post('/api/inventory/removals/import', [
        'file' => $file2,
        'source' => 'amazon',
    ], ['Accept' => 'application/json']);

    $second->assertOk()
        ->assertJsonPath('summary.items_created', 0)
        ->assertJsonPath('summary.items_updated', 1);

    $items = InventoryRemovalItem::query()
        ->where('sku_code', 'SKU-DEDUP-A')
        ->where('user_id', $user->id)
        ->get();

    expect($items)->toHaveCount(1)
        ->and((int) $items->first()->shipped_quantity)->toBe(4)
        ->and((string) $items->first()->fnsku)->toBe('X001-UPDATED')
        ->and((string) $items->first()->receive_status)->toBe('received')
        ->and((int) $items->first()->received_quantity)->toBe(2);

    expect(InventoryRemovalOrder::query()
        ->where('removal_order_id', 'RO-DEDUP-1')
        ->where('user_id', $user->id)
        ->count())->toBe(1);
});

it('upgrades blank-disposition sibling instead of creating a second item', function () {
    $user = User::factory()->create();
    $this->actingAs($user);

    $order = InventoryRemovalOrder::query()->create([
        'user_id' => $user->id,
        'source' => 'amazon',
        'removal_order_id' => 'RO-MERGE-1',
        'order_status' => 'Pending',
    ]);

    InventoryRemovalItem::query()->create([
        'user_id' => $user->id,
        'inventory_removal_order_id' => $order->id,
        'sku_code' => 'SKU-MERGE-A',
        'disposition' => null,
        'requested_quantity' => 2,
        'shipped_quantity' => 0,
        'receive_status' => 'pending',
        'received_quantity' => 0,
    ]);

    $csv = implode("\n", [
        'order-id,sku,disposition,requested-quantity,shipped-quantity',
        'RO-MERGE-1,SKU-MERGE-A,Sellable,2,2',
        '',
    ]);
    $file = UploadedFile::fake()->createWithContent('merge.csv', $csv);
    $this->post('/api/inventory/removals/import', [
        'file' => $file,
        'source' => 'amazon',
    ], ['Accept' => 'application/json'])
        ->assertOk()
        ->assertJsonPath('summary.items_created', 0)
        ->assertJsonPath('summary.items_updated', 1);

    $items = InventoryRemovalItem::query()
        ->where('inventory_removal_order_id', $order->id)
        ->where('sku_code', 'SKU-MERGE-A')
        ->get();

    expect($items)->toHaveCount(1)
        ->and((string) $items->first()->disposition)->toBe('Sellable')
        ->and((int) $items->first()->shipped_quantity)->toBe(2);
});
