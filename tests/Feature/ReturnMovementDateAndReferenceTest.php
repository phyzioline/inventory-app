<?php

use App\Models\User;
use App\Domain\Models\Wms\Channel;
use App\Domain\Models\Wms\InventoryLocation;
use App\Domain\Models\Wms\InventoryOffer;
use App\Domain\Models\Wms\InventoryOrder;
use App\Domain\Models\Wms\InventoryOrderItem;
use App\Domain\Models\Wms\InventoryReturn;
use App\Domain\Models\Wms\InventoryTransaction;
use App\Domain\Models\Wms\MasterProduct;
use App\Domain\Models\Wms\Sku;
use App\Domain\Models\Wms\SkuInventory;

describe('Return-restock stock movements carry the real return date and order reference', function () {
    it('backdates the IN transaction to return_date instead of processing time, and exposes the order number on the sku tracker', function () {
        $user = User::factory()->create();
        $this->actingAs($user);

        $fbaChannel = Channel::query()->create([
            'name' => 'Amazon FBA Test',
            'slug' => 'amazon-fba-'.uniqid(),
            'type' => 'fba',
            'is_active' => true,
        ]);
        $fbaChannel->update(['user_id' => $user->id]);

        $location = InventoryLocation::query()->create([
            'name' => 'FBA FC',
            'type' => 'fba',
            'channel_id' => $fbaChannel->id,
            'is_active' => true,
        ]);
        $location->update(['user_id' => $user->id]);

        $master = MasterProduct::query()->create([
            'internal_name' => 'FBA Return Date Product',
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
            'sku' => 'FBA-RETDATE-'.uniqid(),
            'channel_id' => $fbaChannel->id,
            'cost_price' => 0,
            'selling_price' => 0,
            'is_active' => true,
        ]);
        $sku->update(['user_id' => $user->id]);

        SkuInventory::query()->create([
            'sku_id' => $sku->id,
            'location_id' => $location->id,
            'quantity' => 0,
            'reserved' => 0,
            'user_id' => $user->id,
        ]);

        $order = InventoryOrder::query()->create([
            'platform_order_id' => 'FBA-DATE-'.uniqid(),
            'channel_id' => $fbaChannel->id,
            'status' => 'shipped',
            'order_date' => now(),
            'total_amount' => 50,
        ]);
        $order->update(['user_id' => $user->id]);

        InventoryOrderItem::query()->create([
            'inventory_order_id' => $order->id,
            'sku_id' => $sku->id,
            'sku_code' => $sku->sku,
            'product_name' => 'FBA Test Product',
            'quantity' => 1,
            'unit_price' => 50,
            'total_price' => 50,
            'user_id' => $user->id,
        ]);

        $realReturnDate = now()->subDays(10)->startOfDay()->addHours(9);

        $return = InventoryReturn::query()->create([
            'inventory_order_id' => $order->id,
            'sku_code' => $sku->sku,
            'status' => 'approved',
            'return_status' => 'return_requested',
            'inventory_status' => 'on_hold',
            'reason' => 'FBA return',
            'disposition' => 'sellable',
            'return_quantity' => 1,
            'return_date' => $realReturnDate,
            'user_id' => $user->id,
        ]);

        // Sheet is processed "now" — the transaction date must reflect return_date, not this moment.
        $processedAt = now();
        expect($return->processReturn())->toBeTrue();

        $tx = InventoryTransaction::query()
            ->where('reference_type', 'Return')
            ->where('reference_id', $return->id)
            ->first();

        expect($tx)->not->toBeNull()
            ->and($tx->created_at->diffInSeconds($realReturnDate))->toBeLessThan(2)
            ->and($tx->created_at->diffInSeconds($processedAt))->toBeGreaterThan(60);

        $response = $this->getJson('/api/inventory/transactions/sku-tracker?sku_id='.$sku->id);
        $response->assertOk();

        $movements = collect($response->json('movements'));
        $returnMovement = $movements->firstWhere('reference_type', 'Return');

        expect($returnMovement)->not->toBeNull()
            ->and($returnMovement['order_number'])->toBe($order->platform_order_id)
            ->and($returnMovement['movement_kind'])->toBe('return_in');
    });
});
