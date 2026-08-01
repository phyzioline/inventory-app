<?php

use App\Domain\Models\Wms\Channel;
use App\Domain\Models\Wms\InventoryLocation;
use App\Domain\Models\Wms\InventoryOffer;
use App\Domain\Models\Wms\InventoryTransaction;
use App\Domain\Models\Wms\MasterProduct;
use App\Domain\Models\Wms\Sku;
use App\Domain\Models\Wms\SkuInventory;
use App\Models\User;
use Illuminate\Http\UploadedFile;

describe('FBA shipment transfer fixes', function () {
    function seedFbaTransferFixture(): array
    {
        $user = User::factory()->create();
        test()->actingAs($user);

        $shopChannel = Channel::query()->create([
            'name' => 'المحل',
            'slug' => 'shop-'.uniqid(),
            'type' => 'store',
            'is_active' => true,
        ]);
        $shopChannel->update(['user_id' => $user->id]);

        $merchantChannel = Channel::query()->create([
            'name' => 'Amazon Merchant',
            'slug' => 'merchant-'.uniqid(),
            'type' => 'merchant',
            'is_active' => true,
        ]);
        $merchantChannel->update(['user_id' => $user->id]);

        $fbaChannel = Channel::query()->create([
            'name' => 'Amazon FBA',
            'slug' => 'fba-'.uniqid(),
            'type' => 'fba',
            'is_active' => true,
        ]);
        $fbaChannel->update(['user_id' => $user->id]);

        $shopLoc = InventoryLocation::query()->create([
            'name' => 'Shop WH',
            'type' => 'store',
            'channel_id' => $shopChannel->id,
            'is_active' => true,
        ]);
        $shopLoc->update(['user_id' => $user->id]);

        $fbaLoc = InventoryLocation::query()->create([
            'name' => 'FBA WH',
            'type' => 'amazon_fba',
            'channel_id' => $fbaChannel->id,
            'is_active' => true,
        ]);
        $fbaLoc->update(['user_id' => $user->id]);

        $master = MasterProduct::query()->create([
            'internal_name' => 'FBA Fix Product',
            'is_active' => true,
        ]);
        $master->update(['user_id' => $user->id]);

        $offer = InventoryOffer::query()->create([
            'master_product_id' => $master->id,
            'name' => 'Single',
            'type' => 'single',
        ]);
        $offer->update(['user_id' => $user->id]);

        $msku = 'TEST-MSKU-'.uniqid();

        $shopSku = Sku::query()->create([
            'offer_id' => $offer->id,
            'sku' => 'SHOP-'.$msku,
            'marketplace_id' => $msku,
            'channel_id' => $shopChannel->id,
            'cost_price' => 0,
            'selling_price' => 0,
            'is_active' => true,
        ]);
        $shopSku->update(['user_id' => $user->id]);

        $merchantSku = Sku::query()->create([
            'offer_id' => $offer->id,
            'sku' => 'MERCH-'.$msku,
            'marketplace_id' => $msku,
            'channel_id' => $merchantChannel->id,
            'cost_price' => 0,
            'selling_price' => 0,
            'is_active' => true,
        ]);
        $merchantSku->update(['user_id' => $user->id]);

        $fbaSku = Sku::query()->create([
            'offer_id' => $offer->id,
            'sku' => $msku,
            'marketplace_id' => $msku,
            'channel_id' => $fbaChannel->id,
            'cost_price' => 0,
            'selling_price' => 0,
            'is_active' => true,
        ]);
        $fbaSku->update(['user_id' => $user->id]);

        // Phantom merchant stock at the shop location — must NOT be preferred as source.
        SkuInventory::query()->create([
            'sku_id' => $merchantSku->id,
            'location_id' => $shopLoc->id,
            'quantity' => 50,
            'reserved' => 0,
            'user_id' => $user->id,
        ]);
        SkuInventory::query()->create([
            'sku_id' => $shopSku->id,
            'location_id' => $shopLoc->id,
            'quantity' => 20,
            'reserved' => 0,
            'user_id' => $user->id,
        ]);
        SkuInventory::query()->create([
            'sku_id' => $fbaSku->id,
            'location_id' => $fbaLoc->id,
            'quantity' => 0,
            'reserved' => 0,
            'user_id' => $user->id,
        ]);

        return compact(
            'user',
            'shopChannel',
            'merchantChannel',
            'fbaChannel',
            'shopLoc',
            'fbaLoc',
            'shopSku',
            'merchantSku',
            'fbaSku',
            'msku'
        );
    }

    function makeShipmentTsv(string $shipmentId, string $msku, int $qty): UploadedFile
    {
        $content = implode("\n", [
            "Shipment ID\t{$shipmentId}",
            "Name\tTest Shipment",
            "Ship To\tCAI6",
            "Total units\t{$qty}",
            "MSKU\tTitle\tASIN\tFNSKU\tQuantity",
            "{$msku}\tWidget\tB00TEST\tX00TEST\t{$qty}",
            '',
        ]);

        return UploadedFile::fake()->createWithContent("{$shipmentId}.tsv", $content);
    }

    it('prefers source-channel shop SKU over merchant SKU sitting in the same location', function () {
        $fx = seedFbaTransferFixture();
        $shipmentId = 'FBA'.strtoupper(substr(uniqid(), -8));

        $response = $this->post('/api/inventory/transfers/fba-shipment/upload', [
            'file' => makeShipmentTsv($shipmentId, $fx['msku'], 5),
            'source_location_id' => $fx['shopLoc']->id,
            'destination_location_id' => $fx['fbaLoc']->id,
        ]);

        $response->assertOk();
        $matched = $response->json('matched_items');
        expect($matched)->toHaveCount(1);
        expect((int) $matched[0]['sku_id'])->toBe((int) $fx['shopSku']->id);
        expect($matched[0]['system_sku'])->toBe($fx['shopSku']->sku);
        expect($response->json('prior_transfer.exists'))->toBeFalse();
    });

    it('reports prior_transfer when shipment was already transferred and blocks a second batch', function () {
        $fx = seedFbaTransferFixture();
        $shipmentId = 'FBA'.strtoupper(substr(uniqid(), -8));

        $first = $this->postJson('/api/inventory/transactions/transfer-batch', [
            'from_location_id' => $fx['shopLoc']->id,
            'to_location_id' => $fx['fbaLoc']->id,
            'notes' => "FBA Shipment {$shipmentId} | Units 3 | FC CAI6",
            'items' => [
                [
                    'client_transfer_id' => "fba:{$shipmentId}:{$fx['msku']}",
                    'sku_id' => $fx['shopSku']->id,
                    'to_sku_id' => $fx['fbaSku']->id,
                    'quantity' => 3,
                    'file_quantity' => 5,
                ],
            ],
        ]);
        $first->assertCreated();

        $out = InventoryTransaction::query()
            ->where('reference_type', "transfer_out:fba:{$shipmentId}:{$fx['msku']}")
            ->first();
        expect($out)->not->toBeNull();
        expect($out->notes)->toContain('SheetQty:5');

        $analyze = $this->post('/api/inventory/transfers/fba-shipment/upload', [
            'file' => makeShipmentTsv($shipmentId, $fx['msku'], 5),
            'source_location_id' => $fx['shopLoc']->id,
            'destination_location_id' => $fx['fbaLoc']->id,
        ]);
        $analyze->assertOk();
        expect($analyze->json('prior_transfer.exists'))->toBeTrue();
        expect((int) $analyze->json('prior_transfer.total_units'))->toBe(3);
        expect((int) $analyze->json('prior_transfer.line_count'))->toBe(1);

        // Different quantity so idempotency does not short-circuit — must hard-block.
        $second = $this->postJson('/api/inventory/transactions/transfer-batch', [
            'from_location_id' => $fx['shopLoc']->id,
            'to_location_id' => $fx['fbaLoc']->id,
            'notes' => "FBA Shipment {$shipmentId} | Units 4 | FC CAI6",
            'items' => [
                [
                    'client_transfer_id' => "fba:{$shipmentId}:{$fx['msku']}",
                    'sku_id' => $fx['shopSku']->id,
                    'to_sku_id' => $fx['fbaSku']->id,
                    'quantity' => 4,
                    'file_quantity' => 5,
                ],
            ],
        ]);
        $second->assertStatus(422);
        expect($second->json('error'))->toBe('fba_shipment_already_transferred');
        expect($second->json('prior_transfer.exists'))->toBeTrue();
    });

    it('stores SheetQty in OUT notes so sheet vs transferred diff can be reconstructed', function () {
        $fx = seedFbaTransferFixture();
        $shipmentId = 'FBA'.strtoupper(substr(uniqid(), -8));

        $response = $this->postJson('/api/inventory/transactions/transfer-batch', [
            'from_location_id' => $fx['shopLoc']->id,
            'to_location_id' => $fx['fbaLoc']->id,
            'notes' => "FBA Shipment {$shipmentId} | Units 2",
            'items' => [
                [
                    'client_transfer_id' => "fba:{$shipmentId}:{$fx['msku']}",
                    'sku_id' => $fx['shopSku']->id,
                    'to_sku_id' => $fx['fbaSku']->id,
                    'quantity' => 2,
                    'file_quantity' => 7,
                ],
            ],
        ]);
        $response->assertCreated();

        $out = InventoryTransaction::query()
            ->where('type', 'TRANSFER')
            ->where('reference_type', "transfer_out:fba:{$shipmentId}:{$fx['msku']}")
            ->first();

        expect($out)->not->toBeNull();
        expect($out->notes)->toMatch('/SheetQty\s*:\s*7/i');
        expect((int) $out->quantity)->toBe(2);
    });
});
