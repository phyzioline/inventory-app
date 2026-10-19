<?php

use App\Application\Services\ChannelStockResolver;
use App\Application\Services\MarketplaceImportService;
use App\Domain\Models\Wms\Channel;
use App\Domain\Models\Wms\InventoryLocation;
use App\Domain\Models\Wms\InventoryOffer;
use App\Domain\Models\Wms\InventoryOrder;
use App\Domain\Models\Wms\MasterProduct;
use App\Domain\Models\Wms\Sku;
use App\Domain\Models\Wms\SkuInventory;
use App\Models\User;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Auth;
use Illuminate\Validation\ValidationException;

/**
 * Jumia listings use the same seller SKUs as Amazon. Orders must resolve by Jumia SKU on the
 * Jumia channels only, so a Jumia sale can never create an Amazon order or move Amazon stock.
 */
const JUMIA_HEADER = 'Seller Sku,Jumia Sku,Created At,Order Number,Unit Price,Paid Price,Shipment Type,Status';

function jumiaCsv(array $rows, string $header = JUMIA_HEADER): UploadedFile
{
    $lines = [$header];
    foreach ($rows as $r) {
        $lines[] = implode(',', $r);
    }
    $tmp = tempnam(sys_get_temp_dir(), 'jumia_test_').'.csv';
    file_put_contents($tmp, implode("\n", $lines));

    return new UploadedFile($tmp, 'orders_export.csv', 'text/csv', null, true);
}

function jumiaListing(User $user, Channel $channel, MasterProduct $master, string $code, ?string $marketplaceId = null): Sku
{
    $offer = InventoryOffer::factory()->create(['master_product_id' => $master->id, 'user_id' => $user->id]);

    return Sku::factory()->create([
        'offer_id' => $offer->id,
        'user_id' => $user->id,
        'channel_id' => $channel->id,
        'sku' => $code,
        'marketplace_id' => $marketplaceId,
    ]);
}

function jumiaStock(User $user, Sku $sku, InventoryLocation $location, int $qty): void
{
    SkuInventory::factory()->create([
        'sku_id' => $sku->id,
        'location_id' => $location->id,
        'quantity' => $qty,
        'user_id' => $user->id,
    ]);
}

function qtyAt(Sku $sku, InventoryLocation $location): int
{
    return (int) SkuInventory::query()->where('sku_id', $sku->id)->where('location_id', $location->id)->value('quantity');
}

function seedJumiaFixture(User $user): array
{
    $mk = fn (array $a) => Channel::factory()->create(array_merge(['user_id' => $user->id, 'is_active' => true], $a));
    $store = $mk(['name' => 'Main Store', 'slug' => 'main-store', 'type' => 'store']);
    $amazonMerchant = $mk(['name' => 'Amazon Merchant', 'slug' => 'amazon-merchant', 'type' => 'amazon_merchant']);
    $amazonFba = $mk(['name' => 'Amazon FBA', 'slug' => 'amazon-fba', 'type' => 'amazon_fba']);
    $jumiaFbj = $mk(['name' => 'جوميا', 'slug' => 'jumia', 'type' => 'jumia_fbn']);
    $jumiaDrop = $mk(['name' => 'جوميا تاجر', 'slug' => 'jumia-merchant', 'type' => 'jumia_merchant']);

    $loc = fn (Channel $c) => InventoryLocation::factory()->create(['channel_id' => $c->id, 'user_id' => $user->id, 'is_active' => true]);
    $storeLoc = $loc($store);
    $fbaLoc = $loc($amazonFba);
    $jumiaLoc = $loc($jumiaFbj);

    $gun = MasterProduct::factory()->create(['user_id' => $user->id]);
    $massager = MasterProduct::factory()->create(['user_id' => $user->id]);
    $bed = MasterProduct::factory()->create(['user_id' => $user->id]);

    // Amazon listings with the SAME seller SKUs Jumia uses.
    $amazonGun = jumiaListing($user, $amazonMerchant, $gun, 'XI-4M43-SSV5');
    $amazonMassager = jumiaListing($user, $amazonFba, $massager, 'KN-3WY7-0LWJ');
    jumiaStock($user, $amazonMassager, $fbaLoc, 10);
    $storeGun = jumiaListing($user, $store, $gun, 'PHY-GUN');
    jumiaStock($user, $storeGun, $storeLoc, 7);
    $storeBed = jumiaListing($user, $store, $bed, 'PHY-BED');
    jumiaStock($user, $storeBed, $storeLoc, 2);

    // Jumia FBJ listings registered with the JUM- prefix (auto-linked by seller SKU on first import).
    $jumGun = jumiaListing($user, $jumiaFbj, $gun, 'JUM-XI-4M43-SSV5');
    jumiaStock($user, $jumGun, $jumiaLoc, 3);
    $jumMassager = jumiaListing($user, $jumiaFbj, $massager, 'JUM-KN-3WY7-0LWJ');
    jumiaStock($user, $jumMassager, $jumiaLoc, 3);

    // Dropshipping listing already linked by Jumia SKU; deducts from المحل.
    jumiaListing($user, $jumiaDrop, $bed, 'JUMD-BED', 'GE810SE2BVZMHNAFAMZ-214884307');

    return compact(
        'store', 'amazonMerchant', 'amazonFba', 'jumiaFbj', 'jumiaDrop',
        'storeLoc', 'fbaLoc', 'jumiaLoc',
        'amazonGun', 'amazonMassager', 'storeGun', 'storeBed', 'jumGun', 'jumMassager'
    );
}

function jumiaSheetRows(string $order342Status = 'Delivered'): array
{
    $gun = ['XI-4M43-SSV5', 'GE810SE36MSGDNAFAMZ-214870994'];
    $massager = ['KN-3WY7-0LWJ', 'GE810SE2KOBNXNAFAMZ-214877026'];

    return [
        [...$gun, '2026-10-11 17:58:29', '358624881', '990.00', '563.53', 'Fulfillment by Jumia', 'Delivered'],
        [...$massager, '2026-10-15 12:12:28', '392425881', '499.00', '487.26', 'Fulfillment by Jumia', 'Failed'],
        [...$massager, '2026-10-17 13:04:07', '342129781', '499.00', '484.72', 'Fulfillment by Jumia', $order342Status],
        ['GT-1ZQX-1YZ0', 'GE810SE2BVZMHNAFAMZ-214884307', '2026-10-04 11:00:06', '391721681', '9999.00', '9999.00', 'Dropshipping', 'Delivered'],
        // One order, two units of the same product (export has one row per unit).
        [...$gun, '2026-10-12 10:00:00', '900000001', '990.00', '990.00', 'Fulfillment by Jumia', 'Delivered'],
        [...$gun, '2026-10-12 10:00:00', '900000001', '990.00', '990.00', 'Fulfillment by Jumia', 'Delivered'],
    ];
}

beforeEach(function () {
    ChannelStockResolver::clearCache();
});

it('imports Jumia orders on Jumia channels only, even when uploaded from an Amazon channel', function () {
    $user = User::factory()->create();
    Auth::login($user);
    $f = seedJumiaFixture($user);

    $service = app(MarketplaceImportService::class);
    $service->import(jumiaCsv(jumiaSheetRows()), (int) $f['amazonMerchant']->id, true);

    $order = fn (string $id) => InventoryOrder::query()->where('platform_order_id', $id)->with('items')->first();

    expect($order('358624881')->channel_id)->toBe($f['jumiaFbj']->id)
        ->and((float) $order('358624881')->total_amount)->toEqual(990.0)
        ->and($order('358624881')->status)->toBe('delivered');

    expect($order('392425881')->status)->toBe('rejected')
        ->and((float) $order('392425881')->total_amount)->toEqual(0.0)
        ->and($order('392425881')->items)->toHaveCount(0);

    expect((int) $order('900000001')->items->first()->quantity)->toBe(2)
        ->and((float) $order('900000001')->total_amount)->toEqual(1980.0);

    expect($order('391721681')->channel_id)->toBe($f['jumiaDrop']->id);

    // Jumia warehouse: gun 3 − 1 − 2 = 0, massager 3 − 1 = 2 (failed delivery not deducted).
    expect(qtyAt($f['jumGun'], $f['jumiaLoc']))->toBe(0)
        ->and(qtyAt($f['jumMassager'], $f['jumiaLoc']))->toBe(2);

    // Dropshipping deducts from المحل; Amazon stock untouched.
    expect(qtyAt($f['storeBed'], $f['storeLoc']))->toBe(1)
        ->and(qtyAt($f['storeGun'], $f['storeLoc']))->toBe(7)
        ->and(qtyAt($f['amazonMassager'], $f['fbaLoc']))->toBe(10);

    expect(InventoryOrder::query()->whereIn('channel_id', [$f['amazonMerchant']->id, $f['amazonFba']->id])->count())->toBe(0);

    // JUM- listings learned their Jumia SKU.
    expect($f['jumGun']->fresh()->marketplace_id)->toBe('GE810SE36MSGDNAFAMZ-214870994')
        ->and($f['jumMassager']->fresh()->marketplace_id)->toBe('GE810SE2KOBNXNAFAMZ-214877026');
});

it('is idempotent on re-upload and returns stock when a delivered unit later fails', function () {
    $user = User::factory()->create();
    Auth::login($user);
    $f = seedJumiaFixture($user);
    $service = app(MarketplaceImportService::class);

    $service->import(jumiaCsv(jumiaSheetRows()), (int) $f['jumiaFbj']->id, true);
    $service->import(jumiaCsv(jumiaSheetRows()), (int) $f['jumiaFbj']->id, true);

    expect(qtyAt($f['jumGun'], $f['jumiaLoc']))->toBe(0)
        ->and(qtyAt($f['jumMassager'], $f['jumiaLoc']))->toBe(2)
        ->and(qtyAt($f['storeBed'], $f['storeLoc']))->toBe(1)
        ->and(InventoryOrder::query()->count())->toBe(5);

    $service->import(jumiaCsv(jumiaSheetRows('Failed')), (int) $f['jumiaFbj']->id, true);

    $order = InventoryOrder::query()->where('platform_order_id', '342129781')->first();
    expect($order->status)->toBe('rejected')
        ->and((float) $order->total_amount)->toEqual(0.0)
        ->and(qtyAt($f['jumMassager'], $f['jumiaLoc']))->toBe(3);
});

it('blocks an unlinked Jumia SKU instead of falling back to the Amazon listing', function () {
    $user = User::factory()->create();
    Auth::login($user);
    $f = seedJumiaFixture($user);
    jumiaListing($user, $f['amazonMerchant'], MasterProduct::factory()->create(['user_id' => $user->id]), 'T1-FFSS-A7W5');

    $service = app(MarketplaceImportService::class);
    $file = jumiaCsv([
        ['T1-FFSS-A7W5', 'GE810SE2F9A25NAFAMZ-214876935', '2026-10-01 10:00:00', '367153299', '830.00', '830.00', 'Fulfillment by Jumia', 'Delivered'],
    ]);

    $preview = $service->preview($file, (int) $f['jumiaFbj']->id, true);
    expect($preview['import_blocked'])->toBeTrue()
        ->and($preview['rows'][0]['status'])->toBe('error');

    expect(fn () => $service->import($file, (int) $f['jumiaFbj']->id, true))->toThrow(ValidationException::class);
    expect(InventoryOrder::query()->count())->toBe(0);
});

it('rejects a Jumia account statement uploaded as an orders sheet', function () {
    $user = User::factory()->create();
    Auth::login($user);
    $f = seedJumiaFixture($user);

    $file = jumiaCsv(
        [['2026-10-13 13:22:31', 'Commission', 'T1', 'XI-4M43-SSV5', 'GE810SE36MSGDNAFAMZ-214870994', '-128.70', '358624881']],
        'Transaction Date,Transaction Type,Transaction Number,Seller SKU,Jumia SKU,Amount,Order No.'
    );

    expect(fn () => app(MarketplaceImportService::class)->preview($file, (int) $f['jumiaFbj']->id, true))
        ->toThrow(ValidationException::class);
});

it('records orders before the channel stock tracking start as history (no stock movement either way)', function () {
    $user = User::factory()->create();
    Auth::login($user);
    $f = seedJumiaFixture($user);
    $f['jumiaFbj']->update(['stock_tracking_starts_at' => '2026-10-11 00:00:00']);
    $service = app(MarketplaceImportService::class);

    $rows = fn (string $oldStatus) => [
        ['XI-4M43-SSV5', 'GE810SE36MSGDNAFAMZ-214870994', '2026-10-04 09:00:00', '381315681', '990.00', '990.00', 'Fulfillment by Jumia', $oldStatus],
        ['XI-4M43-SSV5', 'GE810SE36MSGDNAFAMZ-214870994', '2026-10-11 17:58:29', '358624881', '990.00', '563.53', 'Fulfillment by Jumia', 'Delivered'],
    ];

    $preview = $service->preview(jumiaCsv($rows('Delivered')), (int) $f['jumiaFbj']->id, true);
    expect($preview['import_blocked'])->toBeFalse();

    $service->import(jumiaCsv($rows('Delivered')), (int) $f['jumiaFbj']->id, true);
    expect(qtyAt($f['jumGun'], $f['jumiaLoc']))->toBe(2) // only the 10-11 sale
        ->and((float) InventoryOrder::query()->where('platform_order_id', '381315681')->value('total_amount'))->toEqual(990.0);

    // History order later fails → nothing was deducted, so nothing is restocked.
    $service->import(jumiaCsv($rows('Failed')), (int) $f['jumiaFbj']->id, true);
    expect(qtyAt($f['jumGun'], $f['jumiaLoc']))->toBe(2);
});

it('restocks a cancelled dropshipping line back to the shop it was deducted from', function () {
    $user = User::factory()->create();
    Auth::login($user);
    $f = seedJumiaFixture($user);
    $service = app(MarketplaceImportService::class);
    $row = fn (string $status) => [[
        'GT-1ZQX-1YZ0', 'GE810SE2BVZMHNAFAMZ-214884307', '2026-10-04 11:00:06', '391721681', '9999.00', '9999.00', 'Dropshipping', $status,
    ]];

    $service->import(jumiaCsv($row('Shipped')), (int) $f['jumiaFbj']->id, true);
    expect(qtyAt($f['storeBed'], $f['storeLoc']))->toBe(1);

    $service->import(jumiaCsv($row('Canceled')), (int) $f['jumiaFbj']->id, true);
    expect(qtyAt($f['storeBed'], $f['storeLoc']))->toBe(2)
        ->and(InventoryOrder::query()->where('platform_order_id', '391721681')->value('status'))->toBe('cancelled');
});
