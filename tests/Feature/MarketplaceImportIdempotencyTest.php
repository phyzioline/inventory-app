<?php

uses(Tests\TestCase::class, Illuminate\Foundation\Testing\RefreshDatabase::class);

use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Auth;
use App\Models\User;
use App\Application\Services\MarketplaceImportService;
use App\Domain\Models\Wms\Channel;
use App\Domain\Models\Wms\InventoryLocation;
use App\Domain\Models\Wms\InventoryOffer;
use App\Domain\Models\Wms\InventoryOrder;
use App\Domain\Models\Wms\InventoryOrderItem;
use App\Domain\Models\Wms\InventoryTransaction;
use App\Domain\Models\Wms\MasterProduct;
use App\Domain\Models\Wms\Sku;
use App\Domain\Models\Wms\SkuInventory;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeCsvFile(array $rows, string $header = "amazon-order-id\tmerchant-sku\tquantity-purchased\titem-price\tfulfillment-channel"): UploadedFile
{
    $lines = [$header];
    foreach ($rows as $r) {
        $lines[] = implode("\t", $r);
    }
    $content = implode("\n", $lines);
    $tmp = tempnam(sys_get_temp_dir(), 'inv_test_').'.txt';
    file_put_contents($tmp, $content);

    return new UploadedFile($tmp, 'orders.txt', 'text/plain', null, true);
}

function setupInventoryFixture(User $user): array
{
    $channel = Channel::factory()->create([
        'user_id' => $user->id,
        'name' => 'Amazon Merchant',
        'slug' => 'amazon-merchant',
        'type' => 'merchant',
        'is_active' => true,
    ]);

    $storeChannel = Channel::factory()->create([
        'user_id' => $user->id,
        'name' => 'Main Store',
        'slug' => 'main-store',
        'type' => 'store',
        'is_active' => true,
    ]);

    $location = InventoryLocation::factory()->create([
        'channel_id' => $storeChannel->id,
        'user_id' => $user->id,
        'is_active' => true,
    ]);

    $sku = Sku::factory()->create([
        'user_id' => $user->id,
        'sku' => 'ASIN-TEST-001',
        'marketplace_id' => 'ASIN-TEST-001',
        'channel_id' => $channel->id,
    ]);

    SkuInventory::factory()->create([
        'sku_id' => $sku->id,
        'location_id' => $location->id,
        'quantity' => 50,
        'user_id' => $user->id,
    ]);

    return compact('channel', 'storeChannel', 'location', 'sku');
}

// ─────────────────────────────────────────────────────────────────────────────
// Bug #1 — SKU drift: historical import must NOT double-deduct when sku_id changed
// ─────────────────────────────────────────────────────────────────────────────

describe('SKU drift idempotency', function () {

    it('recognises an existing order item by sku_code after sku_id is reassigned', function () {
        $user = User::factory()->create();
        Auth::login($user);

        ['channel' => $channel, 'location' => $location, 'sku' => $sku] = setupInventoryFixture($user);

        // Step 1: import Day-1 sheet — order 111-AAAAAA-1111111 with SKU ASIN-TEST-001 (sku_id = old)
        $day1 = makeCsvFile([
            ['111-AAAAAA-1111111', 'ASIN-TEST-001', '2', '50.00', 'MERCHANT'],
        ]);
        $service = app(MarketplaceImportService::class);
        $result1 = $service->import($day1, $channel->id, true);

        expect($result1['imported'])->toBe(1);
        expect(SkuInventory::where('sku_id', $sku->id)->where('location_id', $location->id)->value('quantity'))->toBe(48);
        expect(InventoryTransaction::where('reference_type', 'ImportedOrder')->where('type', 'OUT')->count())->toBe(1);

        // Step 2: simulate SKU re-mapping — create a new SKU row for the same external code.
        $newSku = Sku::factory()->create([
            'user_id' => $user->id,
            'sku' => 'ASIN-TEST-001',        // same external code, different DB row
            'marketplace_id' => 'ASIN-TEST-001',
            'channel_id' => $channel->id,
        ]);
        // Point some stock at the new SKU too (in case resolver picks it).
        SkuInventory::factory()->create([
            'sku_id' => $newSku->id,
            'location_id' => $location->id,
            'quantity' => 10,
            'user_id' => $user->id,
        ]);

        // Step 3: re-import the SAME historical sheet.
        $historical = makeCsvFile([
            ['111-AAAAAA-1111111', 'ASIN-TEST-001', '2', '50.00', 'MERCHANT'],
        ]);

        $result2 = $service->import($historical, $channel->id, true);

        // Must be skipped — no new deduction for an already-imported order.
        expect($result2['imported'] + $result2['skipped'])->toBe(1);
        expect(InventoryTransaction::where('reference_type', 'ImportedOrder')->where('type', 'OUT')->count())
            ->toBe(1, 'No second OUT transaction should be created');

        // Total stock across both SKUs must not have changed.
        $totalStock = SkuInventory::whereIn('sku_id', [$sku->id, $newSku->id])
            ->where('location_id', $location->id)
            ->sum('quantity');
        expect($totalStock)->toBe(58, 'Stock must be 48+10 = 58 — no double deduction');
    });

});

// ─────────────────────────────────────────────────────────────────────────────
// Bug #2 — Daily import then full-month historical import must be idempotent
// ─────────────────────────────────────────────────────────────────────────────

describe('Historical import idempotency', function () {

    it('importing the same 30 orders twice leaves stock unchanged', function () {
        $user = User::factory()->create();
        Auth::login($user);

        ['channel' => $channel, 'location' => $location, 'sku' => $sku] = setupInventoryFixture($user);

        $orderRows = [];
        for ($i = 1; $i <= 30; $i++) {
            $orderRows[] = [sprintf('111-%06d-1111111', $i), 'ASIN-TEST-001', '1', '25.00', 'MERCHANT'];
        }

        // Daily imports: 3 batches of 10.
        foreach (array_chunk($orderRows, 10) as $batch) {
            $file = makeCsvFile($batch);
            $service = app(MarketplaceImportService::class);
            $service->import($file, $channel->id, true);
        }

        $stockAfterDaily = SkuInventory::where('sku_id', $sku->id)->value('quantity');
        $txCountAfterDaily = InventoryTransaction::where('reference_type', 'ImportedOrder')->where('type', 'OUT')->count();

        expect($stockAfterDaily)->toBe(20, '30 units deducted from 50 initial');
        expect($txCountAfterDaily)->toBe(30);

        // Historical import: all 30 orders in one sheet.
        $historicalFile = makeCsvFile($orderRows);
        $service = app(MarketplaceImportService::class);
        $resultH = $service->import($historicalFile, $channel->id, true);

        $stockAfterHistorical = SkuInventory::where('sku_id', $sku->id)->value('quantity');
        $txCountAfterHistorical = InventoryTransaction::where('reference_type', 'ImportedOrder')->where('type', 'OUT')->count();

        expect($stockAfterHistorical)->toBe($stockAfterDaily, 'Stock must not change on re-import');
        expect($txCountAfterHistorical)->toBe($txCountAfterDaily, 'No new OUT transactions on re-import');
        expect($resultH['skipped'])->toBe(30);
        expect($resultH['imported'])->toBe(0);
    });

    it('can import new orders on top of previously imported historical data', function () {
        $user = User::factory()->create();
        Auth::login($user);

        ['channel' => $channel, 'location' => $location, 'sku' => $sku] = setupInventoryFixture($user);

        // First import: orders 1-20.
        $firstBatch = [];
        for ($i = 1; $i <= 20; $i++) {
            $firstBatch[] = [sprintf('111-%06d-2222222', $i), 'ASIN-TEST-001', '1', '25.00', 'MERCHANT'];
        }
        $service = app(MarketplaceImportService::class);
        $service->import(makeCsvFile($firstBatch), $channel->id, true);

        $stockAfterFirst = SkuInventory::where('sku_id', $sku->id)->value('quantity');
        expect($stockAfterFirst)->toBe(30);

        // Historical import: orders 1-25 (20 existing + 5 new).
        $historicalBatch = $firstBatch;
        for ($i = 21; $i <= 25; $i++) {
            $historicalBatch[] = [sprintf('111-%06d-2222222', $i), 'ASIN-TEST-001', '1', '25.00', 'MERCHANT'];
        }

        $resultH = $service->import(makeCsvFile($historicalBatch), $channel->id, true);

        $stockAfterHistorical = SkuInventory::where('sku_id', $sku->id)->value('quantity');
        expect($stockAfterHistorical)->toBe(25, '5 new orders deducted, not 25');
        expect($resultH['imported'])->toBe(5);
        expect($resultH['skipped'])->toBe(20);
    });

});

// ─────────────────────────────────────────────────────────────────────────────
// Bug #3 — Preview must not overcount merchant channel phantom stock
// ─────────────────────────────────────────────────────────────────────────────

describe('Preview stock consistency', function () {

    it('preview and import agree on available stock for merchant orders', function () {
        $user = User::factory()->create();
        Auth::login($user);

        ['channel' => $channel, 'location' => $location, 'sku' => $sku] = setupInventoryFixture($user);

        // Introduce phantom merchant-channel stock (old data artifact).
        $merchantLocation = InventoryLocation::factory()->create([
            'channel_id' => $channel->id,
            'user_id' => $user->id,
            'is_active' => true,
        ]);
        SkuInventory::factory()->create([
            'sku_id' => $sku->id,
            'location_id' => $merchantLocation->id,
            'quantity' => 100,   // phantom; should NOT count toward fulfillment
            'user_id' => $user->id,
        ]);

        // Store stock = 50 (from setupInventoryFixture), order qty = 60 — should be a shortage.
        $file = makeCsvFile([
            ['222-BBBBBB-2222222', 'ASIN-TEST-001', '60', '25.00', 'MERCHANT'],
        ]);

        $service = app(MarketplaceImportService::class);
        $preview = $service->preview($file, $channel->id, true);

        // Preview must report a shortage (only 50 units in store, not 50+100=150).
        expect($preview['import_blocked'])->toBeTrue();
        expect($preview['stock_shortage_count'])->toBeGreaterThan(0);
    });

    it('preview does not double-count one shared store SKU across two sibling listing SKUs', function () {
        $user = User::factory()->create();
        Auth::login($user);

        $channel = Channel::factory()->create([
            'user_id' => $user->id,
            'name' => 'Amazon Merchant',
            'slug' => 'amazon-merchant',
            'type' => 'merchant',
            'is_active' => true,
        ]);
        $storeChannel = Channel::factory()->create([
            'user_id' => $user->id,
            'name' => 'Main Store',
            'slug' => 'main-store',
            'type' => 'store',
            'is_active' => true,
        ]);
        $storeLocation = InventoryLocation::factory()->create([
            'channel_id' => $storeChannel->id,
            'user_id' => $user->id,
            'is_active' => true,
        ]);

        $masterProduct = MasterProduct::factory()->create(['user_id' => $user->id]);

        $storeOffer = InventoryOffer::factory()->create(['master_product_id' => $masterProduct->id, 'user_id' => $user->id]);
        $storeSku = Sku::factory()->create([
            'offer_id' => $storeOffer->id,
            'channel_id' => $storeChannel->id,
            'sku' => 'STORE-SHARED-001',
            'user_id' => $user->id,
        ]);
        SkuInventory::factory()->create([
            'sku_id' => $storeSku->id,
            'location_id' => $storeLocation->id,
            'quantity' => 10, // one shared physical bucket
            'user_id' => $user->id,
        ]);

        // Two sibling listings for the SAME master product, on the same merchant channel.
        $amzOffer = InventoryOffer::factory()->create(['master_product_id' => $masterProduct->id, 'user_id' => $user->id]);
        Sku::factory()->create([
            'offer_id' => $amzOffer->id,
            'channel_id' => $channel->id,
            'sku' => 'AMZ-SIBLING-001',
            'marketplace_id' => 'AMZ-SIBLING-001',
            'user_id' => $user->id,
        ]);
        $noonOffer = InventoryOffer::factory()->create(['master_product_id' => $masterProduct->id, 'user_id' => $user->id]);
        Sku::factory()->create([
            'offer_id' => $noonOffer->id,
            'channel_id' => $channel->id,
            'sku' => 'NOON-SIBLING-001',
            'marketplace_id' => 'NOON-SIBLING-001',
            'user_id' => $user->id,
        ]);

        // 6 + 6 = 12 requested against 10 shared units — must be a shortage.
        $file = makeCsvFile([
            ['700-AAAAAA-0000001', 'AMZ-SIBLING-001', '6', '25.00', 'MERCHANT'],
            ['700-AAAAAA-0000002', 'NOON-SIBLING-001', '6', '25.00', 'MERCHANT'],
        ]);

        $service = app(MarketplaceImportService::class);
        $preview = $service->preview($file, $channel->id, true);

        // Pre-fix, each sibling listing independently saw the full 10 units and both
        // reported fulfillable — a false-clean preview. Post-fix they share one pool.
        expect($preview['import_blocked'])->toBeTrue('combined 12 requested > 10 shared store units');
        expect($preview['stock_shortage_count'])->toBeGreaterThan(0);
    });

});

// ─────────────────────────────────────────────────────────────────────────────
// Durable stock-deduction status on InventoryOrderItem (a failed deduction must not
// vanish once the import modal closes — it has to be findable later).
// ─────────────────────────────────────────────────────────────────────────────

describe('Stock deduction status is recorded durably', function () {

    it('marks a new line "deducted" when stock covers it and "shortage" when it does not', function () {
        $user = User::factory()->create();
        Auth::login($user);

        $channel = Channel::factory()->create([
            'user_id' => $user->id,
            'name' => 'FBA Channel',
            'slug' => 'fba-'.uniqid(),
            'type' => 'fba',
            'is_active' => true,
        ]);
        $location = InventoryLocation::factory()->create([
            'channel_id' => $channel->id,
            'user_id' => $user->id,
            'is_active' => true,
        ]);

        $plentifulSku = Sku::factory()->create([
            'user_id' => $user->id,
            'sku' => 'PLENTY-001',
            'marketplace_id' => 'PLENTY-001',
            'channel_id' => $channel->id,
        ]);
        SkuInventory::factory()->create([
            'sku_id' => $plentifulSku->id,
            'location_id' => $location->id,
            'quantity' => 10,
            'user_id' => $user->id,
        ]);

        $scarceSku = Sku::factory()->create([
            'user_id' => $user->id,
            'sku' => 'SCARCE-001',
            'marketplace_id' => 'SCARCE-001',
            'channel_id' => $channel->id,
        ]);
        SkuInventory::factory()->create([
            'sku_id' => $scarceSku->id,
            'location_id' => $location->id,
            'quantity' => 2,
            'user_id' => $user->id,
        ]);

        $file = makeCsvFile([
            ['800-AAAAAA-0000001', 'PLENTY-001', '5', '25.00', 'AFN'],
            ['800-BBBBBB-0000002', 'SCARCE-001', '10', '25.00', 'AFN'],
        ]);

        $service = app(MarketplaceImportService::class);
        $service->import($file, $channel->id, true);

        $deductedItem = InventoryOrderItem::where('sku_id', $plentifulSku->id)->first();
        $shortageItem = InventoryOrderItem::where('sku_id', $scarceSku->id)->first();

        expect($deductedItem)->not->toBeNull()
            ->and($deductedItem->stock_deduction_status)->toBe('deducted')
            ->and($deductedItem->stock_shortage_reason)->toBeNull();

        expect($shortageItem)->not->toBeNull()
            ->and($shortageItem->stock_deduction_status)->toBe('shortage')
            ->and($shortageItem->stock_shortage_reason)->not->toBeEmpty();

        expect((int) SkuInventory::where('sku_id', $plentifulSku->id)->value('quantity'))->toBe(5);
        expect((int) SkuInventory::where('sku_id', $scarceSku->id)->value('quantity'))->toBe(2, 'shortage must not touch stock');
    });

    it('retro-tags a legacy item with no prior deduction on re-import (backfill path)', function () {
        $user = User::factory()->create();
        Auth::login($user);

        $channel = Channel::factory()->create([
            'user_id' => $user->id,
            'name' => 'FBA Channel',
            'slug' => 'fba-'.uniqid(),
            'type' => 'fba',
            'is_active' => true,
        ]);
        $location = InventoryLocation::factory()->create([
            'channel_id' => $channel->id,
            'user_id' => $user->id,
            'is_active' => true,
        ]);
        $sku = Sku::factory()->create([
            'user_id' => $user->id,
            'sku' => 'LEGACY-001',
            'marketplace_id' => 'LEGACY-001',
            'channel_id' => $channel->id,
        ]);
        SkuInventory::factory()->create([
            'sku_id' => $sku->id,
            'location_id' => $location->id,
            'quantity' => 10,
            'user_id' => $user->id,
        ]);

        $order = InventoryOrder::factory()->create([
            'user_id' => $user->id,
            'channel_id' => $channel->id,
            'platform_order_id' => '900-LEGACY-0000001',
        ]);
        InventoryOrderItem::factory()->create([
            'inventory_order_id' => $order->id,
            'sku_id' => $sku->id,
            'sku_code' => 'LEGACY-001',
            'quantity' => 3,
            'unit_price' => 25.00,
        ]);
        // No InventoryTransaction OUT recorded — matches a historical pre-fix import.

        $file = makeCsvFile([
            ['900-LEGACY-0000001', 'LEGACY-001', '3', '25.00', 'AFN'],
        ]);
        $service = app(MarketplaceImportService::class);
        $service->import($file, $channel->id, true);

        $item = InventoryOrderItem::where('inventory_order_id', $order->id)->where('sku_id', $sku->id)->first();
        expect($item->stock_deduction_status)->toBe('deducted');
        expect((int) SkuInventory::where('sku_id', $sku->id)->value('quantity'))->toBe(7);
    });

});

// ─────────────────────────────────────────────────────────────────────────────
// Rollback must remove new order lines, not just reverse stock, when the import
// added a line to a PRE-EXISTING order rather than creating a new order.
// ─────────────────────────────────────────────────────────────────────────────

describe('Rollback removes new items on pre-existing orders', function () {

    it('deletes a new line added to a pre-existing order and leaves earlier lines untouched', function () {
        $user = User::factory()->create();
        Auth::login($user);

        $channel = Channel::factory()->create([
            'user_id' => $user->id,
            'name' => 'FBA Channel',
            'slug' => 'fba-'.uniqid(),
            'type' => 'fba',
            'is_active' => true,
        ]);
        $location = InventoryLocation::factory()->create([
            'channel_id' => $channel->id,
            'user_id' => $user->id,
            'is_active' => true,
        ]);

        $skuOne = Sku::factory()->create([
            'user_id' => $user->id,
            'sku' => 'ROLLBACK-ONE',
            'marketplace_id' => 'ROLLBACK-ONE',
            'channel_id' => $channel->id,
        ]);
        SkuInventory::factory()->create([
            'sku_id' => $skuOne->id,
            'location_id' => $location->id,
            'quantity' => 10,
            'user_id' => $user->id,
        ]);
        $skuTwo = Sku::factory()->create([
            'user_id' => $user->id,
            'sku' => 'ROLLBACK-TWO',
            'marketplace_id' => 'ROLLBACK-TWO',
            'channel_id' => $channel->id,
        ]);
        SkuInventory::factory()->create([
            'sku_id' => $skuTwo->id,
            'location_id' => $location->id,
            'quantity' => 10,
            'user_id' => $user->id,
        ]);

        $service = app(MarketplaceImportService::class);

        // Import 1: creates the order with one line (ROLLBACK-ONE). This is a batch on its own —
        // its snapshot is overwritten by import 2 below, which is expected: rollback only ever
        // targets the LAST batch, and import 2's batch is what we exercise here.
        $service->import(makeCsvFile([
            ['950-ROLLBACK-0000001', 'ROLLBACK-ONE', '2', '25.00', 'AFN'],
        ]), $channel->id, true);

        $order = InventoryOrder::where('platform_order_id', '950-ROLLBACK-0000001')->firstOrFail();
        $originalItemId = InventoryOrderItem::where('inventory_order_id', $order->id)->where('sku_id', $skuOne->id)->value('id');

        // Import 2: adds a NEW line (ROLLBACK-TWO) to the now pre-existing order.
        $service->import(makeCsvFile([
            ['950-ROLLBACK-0000001', 'ROLLBACK-TWO', '4', '25.00', 'AFN'],
        ]), $channel->id, true);

        $addedItemId = InventoryOrderItem::where('inventory_order_id', $order->id)->where('sku_id', $skuTwo->id)->value('id');
        expect($addedItemId)->not->toBeNull();
        expect((int) SkuInventory::where('sku_id', $skuTwo->id)->value('quantity'))->toBe(6);

        $result = $service->rollbackLastStockDeductionBatch();

        expect($result['items_deleted'])->toBeGreaterThanOrEqual(1);
        expect(InventoryOrderItem::find($addedItemId))->toBeNull('the line added in the rolled-back batch must be gone');
        expect(InventoryOrderItem::find($originalItemId))->not->toBeNull('a line from an earlier, different batch must be untouched');
        expect((int) SkuInventory::where('sku_id', $skuTwo->id)->value('quantity'))->toBe(10, 'stock for the rolled-back line must be restored');
        expect(InventoryOrder::find($order->id))->not->toBeNull('the pre-existing order itself must survive rollback');
    });

});

// ─────────────────────────────────────────────────────────────────────────────
// Order recognition — amazon vs merchant id columns + ASIN column
// ─────────────────────────────────────────────────────────────────────────────

function makeAmazonOrderFile(array $rows, string $header = "amazon-order-id\tmerchant-order-id\tmerchant-sku\tquantity-purchased\titem-price\tfulfillment-channel"): UploadedFile
{
    $lines = [$header];
    foreach ($rows as $r) {
        $lines[] = implode("\t", $r);
    }
    $content = implode("\n", $lines);
    $tmp = tempnam(sys_get_temp_dir(), 'inv_amz_').'.txt';
    file_put_contents($tmp, $content);

    return new UploadedFile($tmp, 'orders.txt', 'text/plain', null, true);
}

describe('Order id column recognition', function () {

    it('re-import finds order when row contains amazon-order-id even if primary pick differs', function () {
        $user = User::factory()->create();
        Auth::login($user);

        ['channel' => $channel, 'sku' => $sku] = setupInventoryFixture($user);

        $amazonId = '111-AAAAAA-1111111';
        $merchantId = 'MERCH-ALT-999';

        $service = app(MarketplaceImportService::class);
        $service->import(makeAmazonOrderFile([
            [$amazonId, $merchantId, 'ASIN-TEST-001', '1', '25.00', 'MERCHANT'],
        ]), $channel->id, true);

        // Monthly-style row: merchant-order-id listed first in file but amazon-order-id still present on the row.
        $reimport = makeAmazonOrderFile([
            [$amazonId, $merchantId, 'ASIN-TEST-001', '1', '25.00', 'MERCHANT'],
        ]);

        $preview = $service->preview($reimport, $channel->id, true);

        expect($preview['summary']['duplicates'])->toBe(1)
            ->and($preview['summary']['new_orders'])->toBe(0)
            ->and($preview['import_blocked'])->toBeFalse();
    });

    it('resolves product via asin column when merchant-sku column is empty', function () {
        $user = User::factory()->create();
        Auth::login($user);

        ['channel' => $channel] = setupInventoryFixture($user);

        Sku::factory()->create([
            'user_id' => $user->id,
            'sku' => 'INTERNAL-ONLY-SKU',
            'marketplace_id' => 'B0ASIN1234',
            'channel_id' => $channel->id,
        ]);

        $header = "amazon-order-id\tasin\tquantity-purchased\titem-price\tfulfillment-channel";
        $file = makeAmazonOrderFile([
            ['444-DDDDDD-4444444', 'B0ASIN1234', '1', '30.00', 'MERCHANT'],
        ], $header);

        $service = app(MarketplaceImportService::class);
        $preview = $service->preview($file, $channel->id, true);

        expect($preview['summary']['errors'])->toBe(0)
            ->and($preview['summary']['new_orders'])->toBe(1);
    });

});

// ─────────────────────────────────────────────────────────────────────────────
// Order date — purchase-date from sheet (not upload time)
// ─────────────────────────────────────────────────────────────────────────────

describe('Order import date parsing', function () {

    it('preview exposes purchase-date from sheet column, not today when column present', function () {
        $user = User::factory()->create();
        Auth::login($user);

        ['channel' => $channel] = setupInventoryFixture($user);

        $header = "amazon-order-id\tmerchant-sku\tquantity-purchased\titem-price\tfulfillment-channel\tpurchase-date";
        $file = makeCsvFile([
            ['555-EEEEEE-5555555', 'ASIN-TEST-001', '1', '25.00', 'MERCHANT', '2024-03-15T10:30:00+00:00'],
        ], $header);

        $service = app(MarketplaceImportService::class);
        $preview = $service->preview($file, $channel->id, true);

        $row = $preview['rows'][0] ?? null;
        expect($row)->not->toBeNull()
            ->and($row['uploaded_data']['order_date'] ?? null)->toContain('2024-03-15');
    });

    it('preview leaves order_date empty when purchase-date column is missing', function () {
        $user = User::factory()->create();
        Auth::login($user);

        ['channel' => $channel] = setupInventoryFixture($user);

        $file = makeCsvFile([
            ['666-FFFFFF-6666666', 'ASIN-TEST-001', '1', '25.00', 'MERCHANT'],
        ]);

        $service = app(MarketplaceImportService::class);
        $preview = $service->preview($file, $channel->id, true);

        $row = $preview['rows'][0] ?? null;
        expect($row)->not->toBeNull()
            ->and($row['uploaded_data']['order_date'] ?? null)->toBeNull();
    });

});

// ─────────────────────────────────────────────────────────────────────────────
// Regression — hasPriorImportedOrderDeduction must find deductions by sku_code
// ─────────────────────────────────────────────────────────────────────────────

describe('hasPriorImportedOrderDeduction', function () {

    it('returns true when OUT transaction exists for original sku_id (different from current resolved id)', function () {
        $user = User::factory()->create();
        Auth::login($user);

        ['channel' => $channel, 'location' => $location, 'sku' => $sku] = setupInventoryFixture($user);

        // Create an order + item with old sku_id = $sku->id.
        $order = InventoryOrder::factory()->create([
            'user_id' => $user->id,
            'channel_id' => $channel->id,
            'platform_order_id' => '333-CCCCCC-3333333',
        ]);
        InventoryOrderItem::factory()->create([
            'inventory_order_id' => $order->id,
            'sku_id' => $sku->id,
            'sku_code' => 'ASIN-TEST-001',
            'quantity' => 3,
        ]);

        // Create the OUT transaction for old sku_id.
        InventoryTransaction::factory()->create([
            'sku_id' => $sku->id,
            'location_id' => $location->id,
            'type' => 'OUT',
            'quantity' => 3,
            'reference_type' => 'ImportedOrder',
            'reference_id' => (string) $order->id,
            'user_id' => $user->id,
        ]);

        // Create a NEW sku_id for the same external code (simulates re-mapping).
        $newSku = Sku::factory()->create([
            'user_id' => $user->id,
            'sku' => 'ASIN-TEST-001',
            'marketplace_id' => 'ASIN-TEST-001',
            'channel_id' => $channel->id,
        ]);

        // Call the service via reflection to test the private method.
        $service = app(MarketplaceImportService::class);
        $ref = new ReflectionClass($service);
        $method = $ref->getMethod('hasPriorImportedOrderDeduction');
        $method->setAccessible(true);

        // With new sku_id alone → old behaviour would return false.
        // With sku_code hint → must return true.
        $withCode = $method->invoke($service, (int) $order->id, (int) $newSku->id, 'ASIN-TEST-001');
        expect($withCode)->toBeTrue('should find OUT via sku_code lookup');
    });

});

// ─────────────────────────────────────────────────────────────────────────────
// Preview truncation — blocking rows beyond PREVIEW_ROWS_LIMIT must appear
// ─────────────────────────────────────────────────────────────────────────────

describe('Preview row sampling', function () {

    it('includes blocking stock-shortage rows past the preview row limit', function () {
        $user = User::factory()->create();
        Auth::login($user);

        ['channel' => $channel] = setupInventoryFixture($user);

        $service = app(MarketplaceImportService::class);
        $service->import(makeCsvFile([
            ['111-AAAAAA-1111111', 'ASIN-TEST-001', '1', '25.00', 'MERCHANT'],
        ]), $channel->id, true);

        $duplicateLine = ['111-AAAAAA-1111111', 'ASIN-TEST-001', '1', '25.00', 'MERCHANT'];
        $shortageLine = ['999-ZZZZZZ-9999999', 'ASIN-TEST-001', '60', '25.00', 'MERCHANT'];

        $lines = [];
        for ($i = 0; $i < 2000; $i++) {
            $lines[] = $duplicateLine;
        }
        $lines[] = $shortageLine;

        $preview = $service->preview(makeCsvFile($lines), $channel->id, true);

        expect($preview['truncated'])->toBeTrue()
            ->and($preview['preview_issue_row_count'])->toBe(1)
            ->and($preview['blocking_shortage_count'])->toBe(1)
            ->and($preview['rows_shown'])->toBe(2001);

        $issueRow = collect($preview['rows'])->first(
            fn (array $row) => ($row['uploaded_data']['order_number'] ?? '') === '999-ZZZZZZ-9999999'
        );
        expect($issueRow)->not->toBeNull()
            ->and($issueRow['row_number'])->toBe(2001)
            ->and($issueRow['stock_preview']['shortage'] ?? false)->toBeTrue();
    });

});
