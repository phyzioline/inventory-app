<?php

use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Auth;
use App\Models\User;
use App\Application\Services\AmazonRemovalIntakeService;
use App\Application\Services\MarketplaceImportService;
use App\Domain\Models\Wms\Channel;
use App\Domain\Models\Wms\InventoryLocation;
use App\Domain\Models\Wms\InventoryOrder;
use App\Domain\Models\Wms\InventoryRemovalItem;
use App\Domain\Models\Wms\InventoryRemovalOrder;
use App\Domain\Models\Wms\InventoryTransaction;
use App\Domain\Models\Wms\Sku;
use App\Domain\Models\Wms\SkuInventory;

function makeAmazonOrdersSheet(array $rows, string $header = "amazon-order-id\tmerchant-sku\tquantity-purchased\titem-price\tfulfillment-channel"): UploadedFile
{
    $lines = [$header];
    foreach ($rows as $r) {
        $lines[] = implode("\t", $r);
    }
    $tmp = tempnam(sys_get_temp_dir(), 'inv_s02_').'.txt';
    file_put_contents($tmp, implode("\n", $lines));

    return new UploadedFile($tmp, 'orders.txt', 'text/plain', null, true);
}

function seedFbaImportFixture(User $user, int $fbaQty = 0): array
{
    $channel = Channel::factory()->create([
        'user_id' => $user->id,
        'name' => 'Amazon FBA',
        'slug' => 'amazon-fba-'.uniqid(),
        'type' => 'amazon_fba',
        'is_active' => true,
    ]);
    $location = InventoryLocation::factory()->create([
        'channel_id' => $channel->id,
        'user_id' => $user->id,
        'is_active' => true,
        'type' => 'Amazon_FBA',
        'name' => 'FBA WH',
    ]);
    $sku = Sku::factory()->create([
        'user_id' => $user->id,
        'sku' => 'P0-NGEG-IJT2',
        'marketplace_id' => 'P0-NGEG-IJT2',
        'channel_id' => $channel->id,
    ]);
    SkuInventory::factory()->create([
        'sku_id' => $sku->id,
        'location_id' => $location->id,
        'quantity' => $fbaQty,
        'user_id' => $user->id,
    ]);

    return compact('channel', 'location', 'sku');
}

beforeEach(function () {
    \App\Application\Services\ChannelStockResolver::clearCache();
});

describe('Amazon All Orders S02- rows are removals, not sales', function () {

    it('detects S02- ids and ignores regular marketplace order ids', function () {
        $svc = app(AmazonRemovalIntakeService::class);

        expect($svc->isAllOrdersRemovalShipmentId('S02-2711328-6273850'))->toBeTrue()
            ->and($svc->isAllOrdersRemovalShipmentId('s02-2711328-6273850'))->toBeTrue()
            ->and($svc->isAllOrdersRemovalShipmentId('405-0284745-0197436'))->toBeFalse()
            ->and($svc->isAllOrdersRemovalShipmentId('S01-2711328-6273850'))->toBeFalse()
            ->and($svc->isAllOrdersRemovalShipmentId('260827V60'))->toBeFalse();
    });

    it('preview classifies S02- as removal and does not block on FBA shortage', function () {
        $user = User::factory()->create();
        Auth::login($user);
        ['channel' => $channel] = seedFbaImportFixture($user, 0);

        $file = makeAmazonOrdersSheet([
            ['S02-2711328-6273850', 'P0-NGEG-IJT2', '1', '0.00', 'AFN'],
        ]);
        $preview = app(MarketplaceImportService::class)->preview($file, $channel->id, true);

        expect($preview['import_blocked'])->toBeFalse()
            ->and($preview['summary']['removals'])->toBe(1)
            ->and($preview['summary']['new_orders'])->toBe(0)
            ->and($preview['summary']['will_import'])->toBe(1)
            ->and($preview['blocking_shortage_count'])->toBe(0)
            ->and($preview['rows'][0]['status'])->toBe('removal')
            ->and($preview['rows'][0]['stock_preview'])->toBeNull();
    });

    it('confirm creates a pending removal and does not deduct FBA stock or create a sales order', function () {
        $user = User::factory()->create();
        Auth::login($user);
        ['channel' => $channel, 'location' => $location, 'sku' => $sku] = seedFbaImportFixture($user, 4);

        $file = makeAmazonOrdersSheet([
            ['S02-2711328-6273850', 'P0-NGEG-IJT2', '1', '0.00', 'AFN'],
        ]);
        $result = app(MarketplaceImportService::class)->import($file, $channel->id, true);

        expect($result['imported'])->toBe(1)
            ->and($result['removals_imported'])->toBe(1)
            ->and(InventoryOrder::query()->count())->toBe(0)
            ->and(InventoryTransaction::query()->where('type', 'OUT')->count())->toBe(0)
            ->and((int) SkuInventory::query()->where('sku_id', $sku->id)->where('location_id', $location->id)->value('quantity'))->toBe(4);

        $removal = InventoryRemovalOrder::query()->where('removal_order_id', 'S02-2711328-6273850')->first();
        expect($removal)->not->toBeNull()
            ->and($removal->order_type)->toBe('Return')
            ->and($removal->order_source)->toBe(AmazonRemovalIntakeService::ALL_ORDERS_SOURCE_LABEL);

        $item = InventoryRemovalItem::query()->where('inventory_removal_order_id', $removal->id)->first();
        expect($item)->not->toBeNull()
            ->and($item->sku_code)->toBe('P0-NGEG-IJT2')
            ->and((int) $item->requested_quantity)->toBe(1)
            ->and($item->receive_status)->toBe('pending');
    });

    it('re-import of the same S02- row is idempotent', function () {
        $user = User::factory()->create();
        Auth::login($user);
        ['channel' => $channel] = seedFbaImportFixture($user, 4);

        $file1 = makeAmazonOrdersSheet([
            ['S02-2711328-6273850', 'P0-NGEG-IJT2', '1', '0.00', 'AFN'],
        ]);
        $file2 = makeAmazonOrdersSheet([
            ['S02-2711328-6273850', 'P0-NGEG-IJT2', '1', '0.00', 'AFN'],
        ]);
        $svc = app(MarketplaceImportService::class);
        $svc->import($file1, $channel->id, true);
        $second = $svc->import($file2, $channel->id, true);

        expect($second['imported'])->toBe(0)
            ->and($second['skipped'])->toBe(1)
            ->and($second['removals_imported'])->toBe(0)
            ->and(InventoryRemovalOrder::query()->count())->toBe(1)
            ->and(InventoryRemovalItem::query()->count())->toBe(1)
            ->and(InventoryOrder::query()->count())->toBe(0);
    });

    it('still imports a regular Amazon order as a sale that deducts FBA stock', function () {
        $user = User::factory()->create();
        Auth::login($user);
        ['channel' => $channel, 'location' => $location, 'sku' => $sku] = seedFbaImportFixture($user, 4);

        $file = makeAmazonOrdersSheet([
            ['405-0284745-0197436', 'P0-NGEG-IJT2', '1', '1200.00', 'AFN'],
        ]);
        $result = app(MarketplaceImportService::class)->import($file, $channel->id, true);

        expect($result['imported'])->toBe(1)
            ->and($result['removals_imported'])->toBe(0)
            ->and(InventoryOrder::query()->where('platform_order_id', '405-0284745-0197436')->count())->toBe(1)
            ->and(InventoryRemovalOrder::query()->count())->toBe(0)
            ->and((int) SkuInventory::query()->where('sku_id', $sku->id)->where('location_id', $location->id)->value('quantity'))->toBe(3);
    });

    it('cancelled S02- rows are skipped', function () {
        $user = User::factory()->create();
        Auth::login($user);
        ['channel' => $channel] = seedFbaImportFixture($user, 4);

        $header = "amazon-order-id\tmerchant-sku\tquantity-purchased\titem-price\tfulfillment-channel\torder-status";
        $file = makeAmazonOrdersSheet([
            ['S02-9999999-1111111', 'P0-NGEG-IJT2', '1', '0.00', 'AFN', 'Cancelled'],
        ], $header);
        $result = app(MarketplaceImportService::class)->import($file, $channel->id, true);

        expect($result['imported'])->toBe(0)
            ->and(InventoryRemovalOrder::query()->count())->toBe(0)
            ->and(InventoryOrder::query()->count())->toBe(0);
    });

    it('official removal CSV adopts the pending S02- sibling instead of creating a second receive row', function () {
        $user = User::factory()->create();
        Auth::login($user);

        $intake = app(AmazonRemovalIntakeService::class);
        $created = $intake->upsertPendingFromAllOrdersRow(
            (int) $user->id,
            'S02-2711328-6273850',
            'P0-NGEG-IJT2',
            1,
            '2026-08-27 11:13:20',
            'EGP'
        );
        $adopted = $intake->adoptS02Sibling(
            (int) $user->id,
            '260827V60',
            'P0-NGEG-IJT2',
            1,
            '2026-08-27 11:13:20'
        );

        expect($adopted)->not->toBeNull()
            ->and($adopted->id)->toBe($created['order']->id)
            ->and($adopted->removal_order_id)->toBe('260827V60')
            ->and(InventoryRemovalOrder::query()->count())->toBe(1)
            ->and(InventoryRemovalItem::query()->where('receive_status', 'pending')->count())->toBe(1);
    });
});
