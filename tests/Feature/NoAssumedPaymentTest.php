<?php

use App\Application\Services\ChannelStockResolver;
use App\Application\Services\PurchaseImportService;
use App\Application\Support\TenantContext;
use App\Domain\Models\Wms\Channel;
use App\Domain\Models\Wms\InventoryLocation;
use App\Domain\Models\Wms\InventoryOffer;
use App\Domain\Models\Wms\InventoryOrder;
use App\Domain\Models\Wms\MasterProduct;
use App\Domain\Models\Wms\Payment;
use App\Domain\Models\Wms\PurchaseBatch;
use App\Domain\Models\Wms\Receipt;
use App\Domain\Models\Wms\Sku;
use App\Domain\Models\Wms\SkuInventory;
use App\Domain\Models\Wms\Supplier;
use App\Domain\Models\Wms\Vendor;
use App\Models\User;

/**
 * Money is "paid" only when the user enters the amount. Choosing cash, toggling the payment
 * method, editing lines or receiving goods must never fill in or post a paid amount.
 */
beforeEach(function () {
    TenantContext::flush();
    TenantContext::clearOverride();
    ChannelStockResolver::clearCache();
});

function seedNoAssumedPaymentVendor(User $user): array
{
    $vendor = Vendor::query()->create([
        'name' => 'مورد اختبار',
        'is_active' => true,
        'current_balance' => 0,
        'user_id' => $user->id,
    ]);
    $supplier = Supplier::query()->create([
        'name' => 'مورد اختبار',
        'balance' => 0,
        'user_id' => $user->id,
    ]);

    return [$vendor, $supplier];
}

function seedNoAssumedPaymentBatch(User $user, Vendor $vendor, float $total, string $paymentLine): PurchaseBatch
{
    return PurchaseBatch::query()->create([
        'batch_number' => 'PB-NAP-'.uniqid(),
        'user_id' => $user->id,
        'vendor_id' => $vendor->id,
        'supplier_name_raw' => $vendor->name,
        'invoice_number' => 'PUR-NAP-'.uniqid(),
        'invoice_date' => now()->toDateString(),
        'grand_total' => $total,
        'subtotal' => $total,
        'status' => 'received',
        'notes' => $paymentLine,
    ]);
}

it('keeps a cash purchase invoice with nothing paid fully open on the supplier statement', function () {
    $user = User::factory()->create();
    $this->actingAs($user);
    [$vendor, $supplier] = seedNoAssumedPaymentVendor($user);

    seedNoAssumedPaymentBatch($user, $vendor, 7250, '[PAYMENT] type=cash; paid=0.00; remaining=7250.00; status=pending');

    $response = $this->getJson('/api/inventory/suppliers/'.$supplier->id.'/account-summary')->assertOk();

    expect((float) $response->json('summary.total_paid'))->toBe(0.0)
        ->and((float) $response->json('summary.outstanding'))->toBe(7250.0)
        ->and((float) $response->json('invoices.0.paid'))->toBe(0.0)
        ->and((float) $response->json('invoices.0.remaining'))->toBe(7250.0);
});

it('posts a treasury payment for the entered cash amount only, and nothing when paid is zero', function () {
    $user = User::factory()->create();
    $this->actingAs($user);
    Receipt::query()->create([
        'receipt_number' => 'RCPT-NAP-1',
        'type' => 'capital',
        'amount' => 100000,
        'receipt_date' => now()->toDateString(),
        'user_id' => $user->id,
    ]);
    [$vendor] = seedNoAssumedPaymentVendor($user);
    $service = app(PurchaseImportService::class);

    $unpaid = seedNoAssumedPaymentBatch($user, $vendor, 1000, '[PAYMENT] type=cash; paid=0.00; remaining=1000.00; status=pending');
    $partial = seedNoAssumedPaymentBatch($user, $vendor, 1000, '[PAYMENT] type=cash; paid=300.00; remaining=700.00; status=partially_paid');

    $service->syncAutoCashPurchasePayment($unpaid);
    $service->syncAutoCashPurchasePayment($partial);

    expect(Payment::query()->where('notes', 'like', '%AUTO_PURCHASE_BATCH:'.$unpaid->id.'%')->exists())->toBeFalse();
    expect((float) Payment::query()->where('notes', 'like', '%AUTO_PURCHASE_BATCH:'.$partial->id.'%')->sum('amount'))->toBe(300.0)
        ->and($service->computeOpenPayableFromBatch($unpaid))->toBe(1000.0)
        ->and($service->computeOpenPayableFromBatch($partial))->toBe(700.0);
});

it('keeps the entered paid amount when only the purchase payment method changes', function () {
    $user = User::factory()->create();
    $this->actingAs($user);
    [$vendor] = seedNoAssumedPaymentVendor($user);

    $batch = seedNoAssumedPaymentBatch($user, $vendor, 2000, '[PAYMENT] type=credit; paid=250.00; remaining=1750.00; status=partially_paid');
    $batch->update(['status' => 'draft']);

    $this->postJson('/api/inventory/purchases/smart-import/batches/'.$batch->id.'/payment-meta', [
        'payment_type' => 'cash',
    ])->assertOk();

    $notes = (string) $batch->refresh()->notes;
    expect($notes)->toContain('type=cash')
        ->and($notes)->toContain('paid=250.00')
        ->and($notes)->toContain('remaining=1750.00');

    $this->postJson('/api/inventory/purchases/smart-import/batches/'.$batch->id.'/payment-meta', [
        'payment_type' => 'credit',
    ])->assertOk();

    expect((string) $batch->refresh()->notes)->toContain('paid=250.00');
});

function seedNoAssumedPaymentShop(User $user, float $unitPrice): array
{
    $channel = Channel::query()->create([
        'name' => 'Phyzioline Main Store',
        'slug' => 'main-store-'.uniqid(),
        'type' => 'store',
        'is_active' => true,
    ]);
    $channel->update(['user_id' => $user->id]);

    $location = InventoryLocation::query()->create([
        'name' => 'Shop Floor',
        'type' => 'store',
        'channel_id' => $channel->id,
        'is_active' => true,
    ]);
    $location->update(['user_id' => $user->id]);

    $master = MasterProduct::query()->create([
        'internal_name' => 'No Assumed Payment Product',
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
        'sku' => 'PHY-'.uniqid(),
        'channel_id' => $channel->id,
        'cost_price' => 0,
        'selling_price' => $unitPrice,
        'is_active' => true,
    ]);
    $sku->update(['user_id' => $user->id]);

    SkuInventory::query()->create([
        'sku_id' => $sku->id,
        'location_id' => $location->id,
        'quantity' => 10,
        'reserved' => 0,
        'user_id' => $user->id,
    ]);

    return compact('channel', 'location', 'master', 'sku');
}

it('creates a cash sale with nothing paid when no paid amount is entered', function () {
    $user = User::factory()->create();
    $this->actingAs($user);
    $shop = seedNoAssumedPaymentShop($user, 150.0);

    $response = $this->postJson('/api/inventory/orders', [
        'order_number' => 'SHOP-NAP-'.uniqid(),
        'warehouse_id' => $shop['location']->id,
        'marketplace_source' => 'direct',
        'payment_type' => 'cash',
        'total_amount' => 300,
        'items' => [['product_id' => $shop['master']->id, 'quantity' => 2, 'unit_price' => 150]],
    ]);

    $response->assertCreated();
    $order = InventoryOrder::query()->findOrFail($response->json('order.id'));

    expect((float) $order->paid_amount)->toBe(0.0)
        ->and((float) $order->remaining_amount)->toBe(300.0)
        ->and(Receipt::query()->where('reference_id', $order->id)->exists())->toBeFalse();
});

it('rejects a sale whose entered paid amount exceeds the total', function () {
    $user = User::factory()->create();
    $this->actingAs($user);
    $shop = seedNoAssumedPaymentShop($user, 150.0);

    $this->postJson('/api/inventory/orders', [
        'order_number' => 'SHOP-NAP-'.uniqid(),
        'warehouse_id' => $shop['location']->id,
        'marketplace_source' => 'direct',
        'payment_type' => 'cash',
        'paid_amount' => 500,
        'total_amount' => 150,
        'items' => [['product_id' => $shop['master']->id, 'quantity' => 1, 'unit_price' => 150]],
    ])->assertStatus(422);

    expect(InventoryOrder::query()->count())->toBe(0);
});

it('keeps the stored paid amount when a cash sale is edited', function () {
    $user = User::factory()->create();
    $this->actingAs($user);
    $shop = seedNoAssumedPaymentShop($user, 150.0);

    $created = $this->postJson('/api/inventory/orders', [
        'order_number' => 'SHOP-NAP-'.uniqid(),
        'warehouse_id' => $shop['location']->id,
        'marketplace_source' => 'direct',
        'payment_type' => 'credit',
        'paid_amount' => 50,
        'total_amount' => 150,
        'items' => [['product_id' => $shop['master']->id, 'quantity' => 1, 'unit_price' => 150]],
    ])->assertCreated();
    $orderId = (int) $created->json('order.id');
    $itemId = (int) $created->json('order.items.0.id');

    $this->putJson('/api/inventory/orders/'.$orderId, [
        'payment_type' => 'cash',
        'items' => [['id' => $itemId, 'sku_id' => $shop['sku']->id, 'quantity' => 2, 'unit_price' => 150]],
    ])->assertOk();

    $order = InventoryOrder::query()->findOrFail($orderId);
    expect((float) $order->total_amount)->toBe(300.0)
        ->and((float) $order->paid_amount)->toBe(50.0)
        ->and((float) $order->remaining_amount)->toBe(250.0)
        ->and((float) Receipt::query()->sum('amount'))->toBe(50.0);
});

it('voids assumed full cash payments and keeps only the entered amount, with an audit trail', function () {
    $user = User::factory()->create();
    $this->actingAs($user);
    [$vendor] = seedNoAssumedPaymentVendor($user);

    $unpaid = seedNoAssumedPaymentBatch($user, $vendor, 1000, '[PAYMENT] type=cash; paid=0.00; remaining=1000.00; status=pending');
    $partial = seedNoAssumedPaymentBatch($user, $vendor, 1000, '[PAYMENT] type=cash; paid=300.00; remaining=700.00; status=partially_paid');
    $paid = seedNoAssumedPaymentBatch($user, $vendor, 500, '[PAYMENT] type=cash; paid=500.00; remaining=0.00; status=paid');
    foreach ([[$unpaid, 1000], [$partial, 1000], [$paid, 500]] as [$batch, $amount]) {
        Payment::query()->create([
            'payment_number' => 'PAY-NAP-'.$batch->id,
            'payee_type' => Vendor::class,
            'payee_id' => $vendor->id,
            'payee_name' => $vendor->name,
            'amount' => $amount,
            'payment_method' => 'Cash',
            'payment_date' => now()->toDateString(),
            'reference_type' => PurchaseBatch::class,
            'reference_id' => $batch->id,
            'status' => 'completed',
            'notes' => 'AUTO_PURCHASE_BATCH:'.$batch->id.' '.$batch->invoice_number,
            'user_id' => $user->id,
        ]);
    }

    $this->artisan('inventory:void-assumed-purchase-payments', ['--user' => $user->id])->assertSuccessful();
    expect((float) Payment::query()->where('status', 'completed')->sum('amount'))->toBe(2500.0);

    $this->artisan('inventory:void-assumed-purchase-payments', ['--user' => $user->id, '--apply' => true])->assertSuccessful();

    $completedFor = fn (PurchaseBatch $b) => (float) Payment::query()->where('status', 'completed')
        ->where('notes', 'like', '%AUTO_PURCHASE_BATCH:'.$b->id.' %')->sum('amount');
    expect($completedFor($unpaid))->toBe(0.0)
        ->and($completedFor($partial))->toBe(300.0)
        ->and($completedFor($paid))->toBe(500.0)
        ->and(Payment::query()->where('status', 'cancelled')->count())->toBe(2)
        ->and(\App\Domain\Models\Wms\InventoryAuditLog::query()
            ->where('action', \App\Application\Services\AssumedPurchasePaymentCorrectionService::AUDIT_ACTION)->count())->toBe(2);

    $this->artisan('inventory:void-assumed-purchase-payments', ['--user' => $user->id, '--apply' => true])
        ->expectsOutput('No automatic purchase payments above the entered paid amount.')
        ->assertSuccessful();
});

it('records owner-confirmed cash invoices as paid in full for the named supplier only, voiding nothing', function () {
    $user = User::factory()->create();
    $this->actingAs($user);
    [$vendor] = seedNoAssumedPaymentVendor($user);
    $other = Vendor::query()->create(['name' => 'مورد آخر', 'is_active' => true, 'current_balance' => 0, 'user_id' => $user->id]);

    $unpaid = seedNoAssumedPaymentBatch($user, $vendor, 1000, "شحنة أبريل\n[PAYMENT] type=cash; paid=0.00; remaining=1000.00; status=pending");
    $over = seedNoAssumedPaymentBatch($user, $vendor, 800, '[PAYMENT] type=cash; paid=0.00; remaining=800.00; status=pending');
    $otherBatch = seedNoAssumedPaymentBatch($user, $other, 600, '[PAYMENT] type=cash; paid=0.00; remaining=600.00; status=pending');
    foreach ([[$unpaid, $vendor, 1000], [$over, $vendor, 900], [$otherBatch, $other, 600]] as [$batch, $payee, $amount]) {
        Payment::query()->create([
            'payment_number' => 'PAY-NAP-'.$batch->id,
            'payee_type' => Vendor::class,
            'payee_id' => $payee->id,
            'payee_name' => $payee->name,
            'amount' => $amount,
            'payment_method' => 'Cash',
            'payment_date' => now()->toDateString(),
            'reference_type' => PurchaseBatch::class,
            'reference_id' => $batch->id,
            'status' => 'completed',
            'notes' => 'AUTO_PURCHASE_BATCH:'.$batch->id.' '.$batch->invoice_number,
            'user_id' => $user->id,
        ]);
    }

    $this->artisan('inventory:void-assumed-purchase-payments', ['--user' => $user->id, '--paid-in-full' => true])
        ->assertFailed();

    $args = ['--user' => $user->id, '--supplier' => [$vendor->name], '--paid-in-full' => true];
    $this->artisan('inventory:void-assumed-purchase-payments', $args)->assertSuccessful();
    expect(noAssumedPaymentNotesPaid($unpaid->refresh()))->toBe(0.0);

    $this->artisan('inventory:void-assumed-purchase-payments', $args + ['--apply' => true])->assertSuccessful();

    expect(noAssumedPaymentNotesPaid($unpaid->refresh()))->toBe(1000.0)
        ->and($unpaid->notes)->toStartWith('شحنة أبريل')
        ->and(noAssumedPaymentNotesPaid($over->refresh()))->toBe(800.0)
        ->and(noAssumedPaymentNotesPaid($otherBatch->refresh()))->toBe(0.0)
        ->and(Payment::query()->where('status', 'cancelled')->count())->toBe(0)
        ->and((float) Payment::query()->where('status', 'completed')->sum('amount'))->toBe(2500.0)
        ->and(\App\Domain\Models\Wms\InventoryAuditLog::query()
            ->where('action', \App\Application\Services\AssumedPurchasePaymentCorrectionService::AUDIT_ACTION_PAID_IN_FULL)->count())->toBe(2);

    // Owner-confirmed invoices, including the one paid above its total (900 on 800), are never listed again;
    // the other supplier's invoice still is.
    $service = app(\App\Application\Services\AssumedPurchasePaymentCorrectionService::class);
    expect($service->findExcess($user->id, [$vendor->name]))->toHaveCount(0)
        ->and($service->findExcess($user->id)->pluck('batch_id')->all())->toBe([(int) $otherBatch->id]);
});

function noAssumedPaymentNotesPaid(PurchaseBatch $batch): float
{
    return \App\Domain\ValueObjects\PurchasePaymentMeta::fromNotes($batch->notes)
        ->paidAgainst((float) $batch->grand_total);
}
