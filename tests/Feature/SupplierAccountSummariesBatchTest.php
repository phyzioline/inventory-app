<?php

use App\Application\Support\TenantContext;
use App\Domain\Models\Wms\Channel;
use App\Domain\Models\Wms\Customer;
use App\Domain\Models\Wms\InventoryOrder;
use App\Domain\Models\Wms\PurchaseBatch;
use App\Domain\Models\Wms\Supplier;
use App\Domain\Models\Wms\Vendor;
use App\Models\User;

/**
 * GET suppliers/account-summaries replaces one request per supplier on the suppliers
 * table (132 requests in minutes, 2026-11-23). Every figure must equal the
 * per-supplier account-summary `summary` block, including linked-customer netting.
 */
beforeEach(function () {
    TenantContext::flush();
    TenantContext::clearOverride();
});

function batchSupplierWithInvoice(User $user, string $name, float $total, float $paid): Supplier
{
    $vendor = Vendor::query()->create(['name' => $name, 'is_active' => true, 'current_balance' => 0, 'user_id' => $user->id]);
    $supplier = Supplier::query()->create(['name' => $name, 'balance' => $total - $paid, 'user_id' => $user->id]);
    PurchaseBatch::query()->create([
        'batch_number' => 'PB-B-'.uniqid(),
        'user_id' => $user->id,
        'vendor_id' => $vendor->id,
        'supplier_name_raw' => $name,
        'invoice_number' => 'PUR-'.uniqid(),
        'invoice_date' => '2026-01-10',
        'grand_total' => $total,
        'subtotal' => $total,
        'status' => 'received',
        'notes' => sprintf('[PAYMENT] type=credit; paid=%.2f; remaining=%.2f; status=confirmed', $paid, $total - $paid),
    ]);

    return $supplier;
}

it('returns the same summary for every supplier as the per-supplier endpoint', function () {
    $user = User::factory()->create();
    $this->actingAs($user);

    $plain = batchSupplierWithInvoice($user, 'Plain Supplier', 5000, 1200);
    $linkedSupplier = batchSupplierWithInvoice($user, 'Linked Shop', 11900, 0);
    $customer = Customer::query()->create(['name' => 'Linked Shop', 'is_active' => true, 'user_id' => $user->id]);
    $channel = Channel::query()->create(['name' => 'Shop', 'slug' => 'shop-'.uniqid(), 'type' => 'store', 'is_active' => true]);
    $channel->update(['user_id' => $user->id]);
    InventoryOrder::query()->create([
        'user_id' => $user->id, 'channel_id' => $channel->id, 'customer_id' => $customer->id,
        'customer_name' => 'Linked Shop', 'platform_order_id' => 'SO-'.uniqid(), 'order_date' => '2026-02-01',
        'total_amount' => 29000, 'paid_amount' => 0, 'remaining_amount' => 29000, 'status' => 'pending', 'currency' => 'EGP',
    ]);
    $this->postJson('/api/inventory/suppliers/'.$linkedSupplier->id.'/link-customer', ['customer_id' => $customer->id])->assertOk();

    foreach ([[], ['start_date' => '2026-01-01', 'end_date' => '2026-01-31']] as $range) {
        $qs = $range ? '?'.http_build_query($range) : '';
        $batch = $this->getJson('/api/inventory/suppliers/account-summaries'.$qs)->assertOk()->json('summaries');

        expect(array_map('intval', array_keys($batch)))->toEqualCanonicalizing([(int) $plain->id, (int) $linkedSupplier->id]);
        foreach ([$plain, $linkedSupplier] as $supplier) {
            $single = $this->getJson('/api/inventory/suppliers/'.$supplier->id.'/account-summary'.$qs)->assertOk()->json('summary');
            expect($batch[(string) $supplier->id])->toBe($single);
        }
    }

    expect((float) $this->getJson('/api/inventory/suppliers/account-summaries')->json('summaries.'.$plain->id.'.outstanding'))->toBe(5000.0) // paid= in invoice notes is not a payment (no assumed payment)
        ->and($this->getJson('/api/inventory/suppliers/account-summaries')->json('summaries.'.$linkedSupplier->id))->toHaveKey('net_position');
});

it('does not return another account\'s suppliers', function () {
    $owner = User::factory()->create();
    $this->actingAs($owner);
    $mine = batchSupplierWithInvoice($owner, 'Mine', 100, 0);

    $other = User::factory()->create();
    TenantContext::flush();
    $this->actingAs($other);
    batchSupplierWithInvoice($other, 'Theirs', 100, 0);

    TenantContext::flush();
    $this->actingAs($owner);
    $ids = array_map('intval', array_keys($this->getJson('/api/inventory/suppliers/account-summaries')->assertOk()->json('summaries')));
    expect($ids)->toBe([(int) $mine->id]);
});
