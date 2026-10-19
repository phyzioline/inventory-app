<?php

use App\Application\Services\InventoryReturnMutationService;
use App\Application\Support\TenantContext;
use App\Domain\Models\Wms\Channel;
use App\Domain\Models\Wms\Customer;
use App\Domain\Models\Wms\InventoryAuditLog;
use App\Domain\Models\Wms\InventoryOrder;
use App\Domain\Models\Wms\InventoryReturn;
use App\Domain\Models\Wms\Payment;
use App\Domain\Models\Wms\PurchaseBatch;
use App\Domain\Models\Wms\PurchaseReturn;
use App\Domain\Models\Wms\Receipt;
use App\Domain\Models\Wms\Supplier;
use App\Domain\Models\Wms\Vendor;
use App\Models\User;

/**
 * Supplier payments fill the oldest invoices first (derived, never stored), and a cash refund for a
 * return uses up the credit that return gave — on both the supplier and the customer side.
 */
beforeEach(function () {
    TenantContext::flush();
    TenantContext::clearOverride();
});

function seedAllocSupplier(User $user, string $name): array
{
    $vendor = Vendor::query()->create(['name' => $name, 'is_active' => true, 'current_balance' => 0, 'user_id' => $user->id]);
    $supplier = Supplier::query()->create(['name' => $name, 'balance' => 0, 'user_id' => $user->id]);

    return [$vendor, $supplier];
}

function seedAllocInvoice(User $user, Vendor $vendor, string $date, float $total): PurchaseBatch
{
    return PurchaseBatch::query()->create([
        'batch_number' => 'PB-AL-'.uniqid(),
        'user_id' => $user->id,
        'vendor_id' => $vendor->id,
        'supplier_name_raw' => $vendor->name,
        'invoice_number' => 'PUR-AL-'.uniqid(),
        'invoice_date' => $date,
        'grand_total' => $total,
        'subtotal' => $total,
        'status' => 'received',
        'notes' => '[PAYMENT] type=credit; paid=0.00; remaining='.number_format($total, 2, '.', '').'; status=confirmed',
    ]);
}

it('fills the oldest supplier invoices first with an on-account payment, without changing the totals', function () {
    $user = User::factory()->create();
    $this->actingAs($user);
    [$vendor, $supplier] = seedAllocSupplier($user, 'مورد كوباية');

    $old = seedAllocInvoice($user, $vendor, '2026-01-10', 1000);
    $mid = seedAllocInvoice($user, $vendor, '2026-02-10', 1000);
    $new = seedAllocInvoice($user, $vendor, '2026-03-10', 1000);
    Payment::query()->create([
        'payment_number' => 'PAY-AL-1',
        'payee_type' => Supplier::class,
        'payee_id' => $supplier->id,
        'payee_name' => $supplier->name,
        'amount' => 1500,
        'payment_method' => 'cash',
        'payment_date' => '2026-03-15',
        'status' => 'completed',
        'user_id' => $user->id,
    ]);

    $res = $this->getJson('/api/inventory/suppliers/'.$supplier->id.'/account-summary')->assertOk()->json();
    $byId = collect($res['invoices'])->keyBy('id');

    expect((float) $res['summary']['total_paid'])->toBe(1500.0)
        ->and((float) $res['summary']['outstanding'])->toBe(1500.0)
        ->and($byId[$old->id]['status'])->toBe('paid')
        ->and((float) $byId[$mid->id]['paid'])->toBe(500.0)
        ->and($byId[$mid->id]['status'])->toBe('partially_paid')
        ->and((float) $byId[$new->id]['remaining'])->toBe(1000.0)
        ->and((float) collect($res['invoices'])->sum('remaining'))->toBe(1500.0);

    // The purchase-invoice list shows the same allocation.
    $list = collect($this->getJson('/api/inventory/purchases/smart-import/batches?per_page=50')->assertOk()->json('data'))->keyBy('id');
    expect((float) $list[$old->id]['allocated_remaining'])->toBe(0.0)
        ->and((float) $list[$mid->id]['allocated_paid'])->toBe(500.0)
        ->and($list[$new->id]['allocated_status'])->toBe('confirmed');
});

it('does not reduce what you owe a supplier for a return they refunded in cash', function () {
    $user = User::factory()->create();
    $this->actingAs($user);
    [$vendor, $supplier] = seedAllocSupplier($user, 'مورد مرتجع');
    $batch = seedAllocInvoice($user, $vendor, '2026-01-10', 1000);

    $credit = PurchaseReturn::query()->create([
        'user_id' => $user->id, 'purchase_batch_id' => $batch->id, 'vendor_id' => $vendor->id,
        'return_number' => 'PR-AL-1', 'return_date' => '2026-01-20', 'refund_method' => 'credit_note',
        'subtotal' => 300, 'tax_amount' => 0, 'grand_total' => 300, 'currency' => 'EGP',
    ]);
    $cash = PurchaseReturn::query()->create([
        'user_id' => $user->id, 'purchase_batch_id' => $batch->id, 'vendor_id' => $vendor->id,
        'return_number' => 'PR-AL-2', 'return_date' => '2026-01-25', 'refund_method' => 'cash',
        'subtotal' => 200, 'tax_amount' => 0, 'grand_total' => 200, 'currency' => 'EGP',
    ]);
    Receipt::query()->create([
        'type' => 'supplier_refund', 'category' => 'general', 'amount' => 200, 'receipt_date' => '2026-01-25',
        'payment_method' => 'cash', 'reference_type' => PurchaseReturn::class, 'reference_id' => $cash->id,
        'external_reference' => 'PR-AL-2', 'user_id' => $user->id,
    ]);

    $res = $this->getJson('/api/inventory/suppliers/'.$supplier->id.'/account-summary')->assertOk()->json();

    // 1000 − 300 credit note; the 200 return was paid back in cash, so it does not reduce the debt.
    expect((float) $res['summary']['outstanding'])->toBe(700.0)
        ->and((float) collect($res['ledger'])->last()['balance'])->toBe(700.0)
        ->and(collect($res['ledger'])->where('source', 'supplier_refund')->count())->toBe(1);
});

function seedAllocCustomerOrder(User $user, float $total, float $paid, float $remaining): array
{
    $channel = Channel::query()->create(['name' => 'Shop', 'slug' => 'shop-'.uniqid(), 'type' => 'store', 'is_active' => true]);
    $channel->update(['user_id' => $user->id]);
    $customer = Customer::query()->create(['name' => 'عميل مرتجع', 'is_active' => true]);
    $customer->update(['user_id' => $user->id]);
    $order = InventoryOrder::query()->create([
        'platform_order_id' => 'SHOP-AL-'.uniqid(),
        'channel_id' => $channel->id,
        'customer_id' => $customer->id,
        'customer_name' => $customer->name,
        'status' => 'shipped',
        'order_date' => now(),
        'currency' => 'EGP',
        'total_amount' => $total,
        'paid_amount' => $paid,
        'remaining_amount' => $remaining,
    ]);
    $order->update(['user_id' => $user->id]);

    return [$customer, $order];
}

it('does not show a customer as owed money for a return already refunded in cash', function () {
    $user = User::factory()->create();
    $this->actingAs($user);
    // Paid in full, then 300 returned: processReturn lowers remaining by the credit (to −300).
    [$customer, $order] = seedAllocCustomerOrder($user, 1000, 1000, -300);
    $return = InventoryReturn::query()->create([
        'inventory_order_id' => $order->id, 'status' => 'completed', 'refund_amount' => 300,
        'refund_method' => 'cash', 'user_id' => $user->id,
    ]);
    Payment::query()->create([
        'payment_number' => 'PAY-AL-R1', 'payee_type' => Customer::class, 'payee_id' => $customer->id,
        'payee_name' => $customer->name, 'amount' => 300, 'payment_method' => 'cash',
        'payment_date' => now()->toDateString(), 'reference_type' => InventoryReturn::class,
        'reference_id' => $return->id, 'status' => 'completed', 'user_id' => $user->id,
    ]);

    $statement = $this->getJson('/api/inventory/customers/'.$customer->id.'/account-summary')->assertOk()->json();
    $list = $this->getJson('/api/inventory/customers/paginated-with-summary?search='.urlencode($customer->name))->assertOk()->json();

    expect((float) $statement['summary']['outstanding'])->toBe(0.0)
        ->and((float) collect($statement['ledger'])->last()['balance'])->toBe(0.0)
        ->and((float) $list['data'][0]['summary']['outstanding'])->toBe(0.0);
});

it('cancels a customer refund payment that no longer applies instead of deleting it', function () {
    $user = User::factory()->create();
    $this->actingAs($user);
    [$customer, $order] = seedAllocCustomerOrder($user, 1000, 1000, -300);
    $return = InventoryReturn::query()->create([
        'inventory_order_id' => $order->id, 'status' => 'completed', 'refund_amount' => 300,
        'refund_method' => 'cash', 'user_id' => $user->id,
    ]);
    $payment = Payment::query()->create([
        'payment_number' => 'PAY-AL-R2', 'payee_type' => Customer::class, 'payee_id' => $customer->id,
        'payee_name' => $customer->name, 'amount' => 300, 'payment_method' => 'cash',
        'payment_date' => now()->toDateString(), 'reference_type' => InventoryReturn::class,
        'reference_id' => $return->id, 'status' => 'completed', 'user_id' => $user->id,
    ]);

    $return->update(['refund_method' => 'credit_note']);
    app(InventoryReturnMutationService::class)->syncCustomerRefundPayment($return->refresh());

    expect(Payment::query()->find($payment->id)?->status)->toBe('cancelled')
        ->and(InventoryAuditLog::query()->where('action', 'returns.refund_payment_cancelled')->count())->toBe(1);
});

it('shows a credit-note return on the invoice it was made against before filling the oldest invoices', function () {
    $user = User::factory()->create();
    $this->actingAs($user);
    [$vendor, $supplier] = seedAllocSupplier($user, 'مورد مرتجع فاتورة');

    $old = seedAllocInvoice($user, $vendor, '2026-01-10', 1000);
    $new = seedAllocInvoice($user, $vendor, '2026-02-10', 1000);
    PurchaseReturn::query()->create([
        'user_id' => $user->id, 'purchase_batch_id' => $new->id, 'vendor_id' => $vendor->id,
        'return_number' => 'PR-AL-3', 'return_date' => '2026-02-15', 'refund_method' => 'credit_note',
        'subtotal' => 300, 'tax_amount' => 0, 'grand_total' => 300, 'currency' => 'EGP',
    ]);
    Payment::query()->create([
        'payment_number' => 'PAY-AL-3', 'payee_type' => Supplier::class, 'payee_id' => $supplier->id,
        'payee_name' => $supplier->name, 'amount' => 1200, 'payment_method' => 'cash',
        'payment_date' => '2026-02-20', 'status' => 'completed', 'user_id' => $user->id,
    ]);

    $res = $this->getJson('/api/inventory/suppliers/'.$supplier->id.'/account-summary')->assertOk()->json();
    $byId = collect($res['invoices'])->keyBy('id');

    // 2000 − 300 return − 1200 paid = 500, all of it on the newer invoice, which also shows its return.
    expect((float) $res['summary']['outstanding'])->toBe(500.0)
        ->and((float) $byId[$old->id]['remaining'])->toBe(0.0)
        ->and((float) $byId[$old->id]['returned'])->toBe(0.0)
        ->and((float) $byId[$new->id]['returned'])->toBe(300.0)
        ->and((float) $byId[$new->id]['paid'])->toBe(200.0)
        ->and((float) $byId[$new->id]['remaining'])->toBe(500.0);
});
